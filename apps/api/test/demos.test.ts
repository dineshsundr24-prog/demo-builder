import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeProvider, Generator, MemoryStore, defaultConfig } from '@demo/generator';
import { buildServer } from '../src/server.ts';
import { MemoryDemoStore } from '../src/demos/store.ts';
import { issueSession } from '../src/demos/auth.ts';

const doc = JSON.parse(readFileSync(new URL('../../../packages/schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const portalDoc = JSON.parse(readFileSync(new URL('../../../packages/schema/fixtures/staff-portal.json', import.meta.url), 'utf8'));
const SECRET = 'x'.repeat(40);
const users: Record<string, { id: string; email: string }> = { 'tok-alice': { id: 'u-alice', email: 'alice@example.com' }, 'tok-bob': { id: 'u-bob', email: 'bob@example.com' } };

async function server() {
  const store = new MemoryDemoStore();
  const gen = new Generator(new MemoryStore(), new FakeProvider(() => ({})), defaultConfig);
  const app = await buildServer({ generator: gen, accessToken: 'uat-token', origins: [], model: 'fake', demoStore: store, sessionSecret: SECRET,
    verifyUser: async t => (users[t] ? { id: users[t].id, email: users[t].email } : null), publicBaseUrl: 'https://studio.example' });
  const call = async (method: string, url: string, as?: string, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (as === 'uat') headers['x-builder-access'] = 'uat-token'; else if (as) headers.authorization = 'Bearer ' + as;
    const r = await app.inject({ method: method as any, url, headers, ...(body !== undefined ? { payload: body as any } : {}) });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  return { app, store, call };
}

test('sign-in is required; the shared UAT token still works in its own workspace', async () => {
  const { call } = await server();
  assert.equal((await call('GET', '/api/v2/demos')).status, 401);
  assert.equal((await call('GET', '/api/v2/demos', 'tok-nobody')).status, 401);
  const me = await call('GET', '/api/v2/me', 'uat');
  assert.equal(me.status, 200);
  assert.equal(me.body.via, 'uat');
  assert.equal(me.body.workspaces[0].kind, 'uat');
  const alice = await call('GET', '/api/v2/me', 'tok-alice');
  assert.equal(alice.body.principal.email, 'alice@example.com');
  assert.equal(alice.body.workspaces[0].kind, 'personal');
  assert.equal(alice.body.workspaces[0].role, 'owner');
});

test('draft, immutable versions, optimistic concurrency', async () => {
  const { call } = await server();
  const created = await call('POST', '/api/v2/demos', 'tok-alice', { document: doc });
  assert.equal(created.status, 200);
  const id = created.body.demo.id;
  assert.equal(created.body.demo.isPrimary, true, 'first demo of a project + type is its primary baseline');
  assert.equal(created.body.demo.draftRevision, 1);
  const edited = { ...doc, name: 'Kapiko v2' };
  const saved = await call('PUT', `/api/v2/demos/${id}/draft`, 'tok-alice', { expectedRevision: 1, document: edited });
  assert.equal(saved.body.demo.draftRevision, 2);
  const stale = await call('PUT', `/api/v2/demos/${id}/draft`, 'tok-alice', { expectedRevision: 1, document: doc });
  assert.equal(stale.status, 409, 'a stale editor cannot overwrite newer work');
  const v1 = await call('POST', `/api/v2/demos/${id}/versions`, 'tok-alice', { expectedRevision: 2, note: 'First review' });
  assert.equal(v1.body.version.number, 1);
  assert.equal(v1.body.version.metadata.validation.errors, 0);
  await call('PUT', `/api/v2/demos/${id}/draft`, 'tok-alice', { expectedRevision: 2, document: { ...doc, name: 'Kapiko v3' } });
  const v2 = await call('POST', `/api/v2/demos/${id}/versions`, 'tok-alice', { expectedRevision: 3, note: 'Second' });
  assert.equal(v2.body.version.number, 2);
  const read1 = await call('GET', `/api/v2/demos/${id}/versions/1`, 'tok-alice');
  assert.equal(read1.body.document.name, 'Kapiko v2', 'version 1 keeps exactly what was saved');
  const full = await call('GET', `/api/v2/demos/${id}`, 'tok-alice');
  assert.deepEqual(full.body.versions.map((v: any) => v.number), [2, 1]);
  assert.equal(full.body.role, 'owner');
  // A portal document cannot be saved into a mobile demo.
  assert.equal((await call('PUT', `/api/v2/demos/${id}/draft`, 'tok-alice', { expectedRevision: 3, document: portalDoc })).status, 409);
  assert.equal((await call('PUT', `/api/v2/demos/${id}/draft`, 'tok-alice', { expectedRevision: 3, document: { nope: 1 } })).status, 422);
});

test('tenant isolation: other users cannot see, read, change or fork a demo', async () => {
  const { call } = await server();
  const id = (await call('POST', '/api/v2/demos', 'tok-alice', { document: doc })).body.demo.id;
  await call('POST', `/api/v2/demos/${id}/versions`, 'tok-alice', { expectedRevision: 1 });
  assert.equal((await call('GET', '/api/v2/demos', 'tok-bob')).body.demos.length, 0);
  for (const [m, u, b] of [['GET', `/api/v2/demos/${id}`], ['GET', `/api/v2/demos/${id}/versions/1`], ['PUT', `/api/v2/demos/${id}/draft`, { expectedRevision: 1, document: doc }],
    ['POST', `/api/v2/demos/${id}/versions`, { expectedRevision: 1 }], ['POST', `/api/v2/demos/${id}/fork`, { version: 1 }], ['POST', `/api/v2/demos/${id}/primary`], ['POST', `/api/v2/demos/${id}/versions/1/publish`]] as [string, string, unknown?][]) {
    assert.equal((await call(m, u, 'tok-bob', b)).status, 404, m + ' ' + u + ' must look like it does not exist');
  }
  assert.equal((await call('GET', `/api/v2/demos/${id}`, 'uat')).status, 404, 'the shared UAT token is not a back door');
});

test('published links are read-only, show one exact version and can be revoked', async () => {
  const { call } = await server();
  const id = (await call('POST', '/api/v2/demos', 'tok-alice', { document: doc })).body.demo.id;
  await call('POST', `/api/v2/demos/${id}/versions`, 'tok-alice', { expectedRevision: 1, note: 'Client review' });
  const pub = await call('POST', `/api/v2/demos/${id}/versions/1/publish`, 'tok-alice');
  assert.equal(pub.status, 200);
  assert.match(pub.body.url, /^https:\/\/studio\.example\/\?p=[A-Za-z0-9_-]{20,}$/);
  await call('PUT', `/api/v2/demos/${id}/draft`, 'tok-alice', { expectedRevision: 1, document: { ...doc, name: 'Changed later' } });
  const viewed = await call('GET', '/api/v2/public/' + pub.body.token);
  assert.equal(viewed.status, 200, 'no sign-in needed');
  assert.equal(viewed.body.version, 1);
  assert.equal(viewed.body.document.name, doc.name, 'later draft edits never leak into a published link');
  // Only the demo itself: no ids, notes, version metadata, workspace, requirements or editing links.
  assert.deepEqual(Object.keys(viewed.body).sort(), ['channel', 'document', 'name', 'publishedAt', 'version']);
  assert.ok(!/brief|requirement|metadata|workspace|principal|token_hash|demo_id/i.test(JSON.stringify(Object.keys(viewed.body))));
  assert.equal((await call('PUT', `/api/v2/demos/${id}/draft`, undefined, { expectedRevision: 2, document: doc })).status, 401, 'the public token grants nothing else');
  const list = await call('GET', `/api/v2/demos/${id}`, 'tok-alice');
  await call('POST', `/api/v2/demos/${id}/publications/${list.body.publications[0].id}/revoke`, 'tok-alice');
  assert.equal((await call('GET', '/api/v2/public/' + pub.body.token)).status, 404);
  assert.equal((await call('GET', '/api/v2/public/not-a-real-token-xxxxxxxxxx')).status, 404);
});

test('a version with validation errors cannot be published', async () => {
  const { call } = await server();
  const broken = structuredClone(doc);
  (broken.screens[0].children as any[]).push({ type: 'Button', id: 'dead-link', label: 'Go', variant: 'primary', actions: [{ type: 'navigate', screen: 'nowhere' }] });
  const id = (await call('POST', '/api/v2/demos', 'tok-alice', { document: broken })).body.demo.id;
  const v = await call('POST', `/api/v2/demos/${id}/versions`, 'tok-alice', { expectedRevision: 1 });
  assert.ok(v.body.version.metadata.validation.errors > 0);
  assert.equal((await call('POST', `/api/v2/demos/${id}/versions/1/publish`, 'tok-alice')).status, 409);
});

test('primary baselines: one per project + application type; forks are independent', async () => {
  const { call } = await server();
  const a = (await call('POST', '/api/v2/demos', 'tok-alice', { document: doc, name: 'App A' })).body.demo;
  const b = (await call('POST', '/api/v2/demos', 'tok-alice', { document: doc, name: 'App B' })).body.demo;
  const portal = (await call('POST', '/api/v2/demos', 'tok-alice', { document: portalDoc })).body.demo;
  assert.equal(a.isPrimary, true); assert.equal(b.isPrimary, false); assert.equal(portal.isPrimary, true, 'portal has its own primary');
  await call('POST', `/api/v2/demos/${b.id}/primary`, 'tok-alice');
  const list = (await call('GET', '/api/v2/demos', 'tok-alice')).body.demos;
  assert.deepEqual(list.filter((d: any) => d.channel === 'mobile' && d.isPrimary).map((d: any) => d.name), ['App B']);
  await call('POST', `/api/v2/demos/${a.id}/versions`, 'tok-alice', { expectedRevision: 1, note: 'base' });
  const fork = await call('POST', `/api/v2/demos/${a.id}/fork`, 'tok-alice', { version: 1, name: 'Experiment' });
  assert.equal(fork.body.demo.name, 'Experiment');
  assert.equal(fork.body.demo.isPrimary, false);
  assert.equal(fork.body.demo.latestVersion, 0);
  assert.ok(fork.body.demo.forkedFromVersionId);
  assert.equal((await call('POST', `/api/v2/demos/${a.id}/fork`, 'tok-alice', { version: 9 })).status, 409);
});

test('MEYON-style sessions are confined to one workspace, one project and their allowed actions', async () => {
  const { call, store } = await server();
  const ws = await store.ensureWorkspace({ kind: 'meyon', name: 'MEYON tenant', external_ref: 'tenant-1' });
  const p = await store.upsertPrincipal({ provider: 'meyon', subject: 'meyon:tenant-1:launch-user' });
  await store.addMember(ws.id, p.id, 'editor');
  const scoped = issueSession(SECRET, { subject: 'meyon:tenant-1:launch-user', scope: { workspaceId: ws.id, projectRef: 'proj-1', ops: ['read', 'create', 'edit', 'version', 'primary'] } });
  const created = await call('POST', '/api/v2/demos', scoped, { document: doc, projectRef: 'ignored-and-forced-to-proj-1' });
  assert.equal(created.status, 200);
  const id = created.body.demo.id;
  const own = await store.getDemo(id);
  assert.equal(own!.project_ref, 'proj-1', 'the session project is enforced');
  assert.equal((await call('POST', `/api/v2/demos/${id}/versions/1/publish`, scoped)).status, 403, 'publish not granted');
  // Same tenant, other project: invisible to this session.
  const other = await store.createDemo({ workspace_id: ws.id, name: 'Other project', channel: 'mobile', project_ref: 'proj-2', draft: doc, created_by: p.id });
  assert.equal((await call('GET', `/api/v2/demos/${other.id}`, scoped)).status, 404);
  assert.deepEqual((await call('GET', '/api/v2/demos', scoped)).body.demos.map((d: any) => d.id), [id]);
  // Tampered or expired sessions are rejected.
  assert.equal((await call('GET', '/api/v2/demos', scoped.slice(0, -2) + 'xx')).status, 401);
  const expired = issueSession(SECRET, { subject: 's', scope: { workspaceId: ws.id, projectRef: 'proj-1', ops: ['read'] }, ttlSeconds: -10 });
  assert.equal((await call('GET', '/api/v2/demos', expired)).status, 401);
  // A viewer role cannot edit even if the session lists the action.
  const viewer = await store.upsertPrincipal({ provider: 'meyon', subject: 'viewer-1' });
  await store.addMember(ws.id, viewer.id, 'viewer');
  const vs = issueSession(SECRET, { subject: 'viewer-1', scope: { workspaceId: ws.id, projectRef: 'proj-1', ops: ['read', 'edit'] } });
  assert.equal((await call('PUT', `/api/v2/demos/${id}/draft`, vs, { expectedRevision: 1, document: doc })).status, 403);
  assert.equal((await call('GET', `/api/v2/demos/${id}`, vs)).status, 200);
});

test('generation jobs are visible only to whoever started them', async () => {
  const { call } = await server();
  const job = await call('POST', '/api/v2/jobs', 'tok-alice', { request: { name: 'Alice app', channel: 'mobile' }, brief: 'A mobile banking app with a dashboard and transfers.' });
  assert.equal(job.status, 202);
  assert.equal((await call('GET', '/api/v2/jobs', 'tok-alice')).body.jobs.length, 1);
  assert.equal((await call('GET', '/api/v2/jobs', 'tok-bob')).body.jobs.length, 0);
  assert.equal((await call('GET', '/api/v2/jobs/' + job.body.id, 'tok-bob')).status, 404);
  assert.equal((await call('GET', '/api/v2/jobs/' + job.body.id, 'uat')).status, 404);
  assert.equal((await call('GET', '/api/v2/jobs/' + job.body.id, 'tok-alice')).status, 200);
});

test('with the legacy UAT token switched off, only signed-in users get in', async () => {
  const store = new MemoryDemoStore();
  const gen = new Generator(new MemoryStore(), new FakeProvider(() => ({})), defaultConfig);
  const app = await buildServer({ generator: gen, accessToken: 'uat-token', allowUatToken: false, origins: [], model: 'fake', demoStore: store, verifyUser: async t => (users[t] ? { id: users[t].id, email: users[t].email } : null) });
  const r = await app.inject({ method: 'GET', url: '/api/v2/demos', headers: { 'x-builder-access': 'uat-token' } });
  assert.equal(r.statusCode, 401);
  const jobs = await app.inject({ method: 'POST', url: '/api/v2/jobs', headers: { 'x-builder-access': 'uat-token' }, payload: { request: { name: 'x', channel: 'mobile' }, brief: 'A mobile banking app with transfers and bills.' } });
  assert.equal(jobs.statusCode, 401, 'paid generation also needs a signed-in user');
  assert.equal((await app.inject({ method: 'GET', url: '/api/v2/demos', headers: { authorization: 'Bearer tok-alice' } })).statusCode, 200);
});

test('Supabase tokens are verified locally: signature, issuer, audience, expiry, role; key rotation', async () => {
  const { generateKeyPairSync, sign } = await import('node:crypto');
  const { jwksVerifier } = await import('../src/demos/auth.ts');
  const URL_ = 'https://proj.supabase.co';
  const mk = () => { const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' }); return { privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid: 'k' + Math.random().toString(36).slice(2, 6), alg: 'ES256' } }; };
  let current = mk();
  let fetches = 0;
  const fetcher = (async () => { fetches++; return new Response(JSON.stringify({ keys: [current.jwk] })); }) as typeof fetch;
  const jwt = (claims: object, k = current) => {
    const h = Buffer.from(JSON.stringify({ alg: 'ES256', kid: k.jwk.kid, typ: 'JWT' })).toString('base64url');
    const b = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return h + '.' + b + '.' + sign('sha256', Buffer.from(h + '.' + b), { key: k.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  };
  const good = { iss: URL_ + '/auth/v1', aud: 'authenticated', role: 'authenticated', sub: 'user-1', email: 'u@example.com', exp: Math.floor(Date.now() / 1000) + 600 };
  const v = jwksVerifier(URL_, undefined, fetcher);
  assert.equal((await v(jwt(good)))?.id, 'user-1');
  assert.equal(await v(jwt({ ...good, exp: 1 })), null, 'expired');
  assert.equal(await v(jwt({ ...good, iss: 'https://other.supabase.co/auth/v1' })), null, 'other project');
  assert.equal(await v(jwt({ ...good, role: 'anon' })), null, 'anon key is not a user');
  assert.equal(await v(jwt({ ...good, role: 'service_role', sub: undefined })), null, 'service key is not a user');
  const t = jwt(good); assert.equal(await v(t.slice(0, -4) + 'AAAA'), null, 'tampered signature');
  const forged = mk(); forged.jwk.kid = current.jwk.kid;
  assert.equal(await v(jwt(good, forged)), null, 'signed with a different key');
  const before = fetches; current = mk(); // rotation: a new kid triggers one refresh
  assert.equal((await v(jwt(good)))?.id, 'user-1');
  assert.equal(fetches, before + 1);
  assert.equal(await v('not.a.jwt'), null);
});
