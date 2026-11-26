// Launches from MEYON (Phase A2), end to end against the simulated MEYON: grant -> exchange -> confirm -> generate ->
// save -> version with traceability -> publish; plus single use, expiry, replay, validation, scope and Extend checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeProvider, Generator, MemoryStore, defaultConfig, type CompletionRequest } from '@demo/generator';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { buildServer } from '../src/server.ts';
import { MemoryDemoStore } from '../src/demos/store.ts';
import { httpMeyonClient, type MeyonClient } from '../src/launch/meyon.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../packages/schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const KEY = 'test-integration-key-0123456789abcdefghij', SECRET = 'test-session-secret-0123456789abcdefghij';
const provider = new FakeProvider((req: CompletionRequest) => {
  const input = JSON.parse(req.input);
  if (req.purpose === 'plan') {
    const ac = (input.acceptanceCriteria ?? []).map((c: any) => c.id);
    return { theme: { primary: '#000000', secondary: '#111111', accent: '#222222' }, sampleFacts: [], shellKind: 'tabs', menu: [{ label: 'Apply', icon: 'home', screen: 'apply' }], collections: [],
      screens: [{ id: 'apply', title: 'Apply', purpose: 'Loan application', archetype: 'custom', collection: null, template: null, links: ['done'], shell: 'default', mustInclude: [], criteria: ac.slice(0, -1) },
        { id: 'done', title: 'Submitted', purpose: 'Reference number', archetype: 'custom', collection: null, template: null, links: ['apply'], shell: 'default', mustInclude: [], criteria: ac.slice(-1) }] };
  }
  const s = input.screen;
  return { id: s.id, title: s.title, shell: 'default', children: [{ type: 'Heading', id: 'h', text: s.title, level: '2' }, { type: 'Text', id: 't', text: 'Loan amount, tenure, monthly instalment, salary certificate upload, reference number and next steps' },
    { type: 'Button', id: 'go', label: 'Continue', variant: 'primary', actions: [{ type: 'navigate', screen: s.id === 'apply' ? 'done' : 'apply' }] }] };
});

async function setup(o: { meyon?: MeyonClient | 'sim' | 'none'; allowSharedToken?: boolean } = {}) {
  const store = new MemoryDemoStore();
  let app!: FastifyInstance;
  const viaInject: typeof fetch = async (url, init) => {
    const r = await app.inject({ method: (init?.method ?? 'GET') as any, url: String(url).replace(/^https?:\/\/[^/]+/, ''), headers: init?.headers as any, payload: init?.body as any });
    return new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } });
  };
  const meyon = o.meyon === 'none' ? undefined : o.meyon && o.meyon !== 'sim' ? o.meyon : httpMeyonClient('http://builder/sim/meyon', KEY, viaInject);
  app = await buildServer({ generator: new Generator(new MemoryStore(), provider, { ...defaultConfig, retryDelaysMs: [1] }), accessToken: 'uat-token', origins: [], model: 'fake', demoStore: store,
    verifyUser: async t => (t === 'owner-token' ? { id: 'owner-1', email: 'owner@example.invalid' } : null), sessionSecret: SECRET, meyon,
    meyonSimulator: { integrationKey: KEY, allowSharedToken: o.allowSharedToken }, publicBaseUrl: 'https://studio.example' });
  const call = async (method: string, url: string, auth?: string, body?: unknown) => {
    const headers: Record<string, string> = auth === 'uat' ? { 'x-builder-access': 'uat-token' } : auth ? { authorization: 'Bearer ' + auth } : {};
    const r = await app.inject({ method: method as any, url, headers, ...(body !== undefined ? { payload: body as any } : {}) });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  const grant = async (body: Record<string, unknown>) => { const r = await call('POST', '/sim/meyon/grants', 'owner-token', body); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.code as string; };
  const launch = async (body: Record<string, unknown>) => { const r = await call('POST', '/api/v2/launch/exchange', undefined, { code: await grant(body) }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body as { session: string; launchId: string }; };
  return { app, store, call, grant, launch };
}
const waitJob = async (call: Awaited<ReturnType<typeof setup>>['call'], session: string, id: string, statuses: string[]) => {
  for (const end = Date.now() + 5000; ;) { const j = (await call('GET', '/api/v2/jobs/' + id, session)).body.job; if (statuses.includes(j.status)) return j; if (Date.now() > end) throw Error('job stuck in ' + j.status); await new Promise(r => setTimeout(r, 5)); }
};

test('Create: launch, confirm, generate with traceability, save, version, publish without requirement references', async () => {
  const { call, launch, store } = await setup();
  const { session, launchId } = await launch({ storyId: 'US-101' });
  assert.match(session, /^bds\./);
  const view = (await call('GET', '/api/v2/launches/' + launchId, session)).body.launch;
  assert.equal(view.story.id, 'US-101'); assert.equal(view.mode, 'create'); assert.equal(view.actor.verified, false);
  assert.equal(view.approved.acceptanceCriteria.length, 5); assert.ok(view.suggestions.length > 0, 'suggestions are kept, separately');
  const me = (await call('GET', '/api/v2/me', session)).body;
  assert.equal(me.via, 'session'); assert.equal(me.scope.projectRef, 'PRJ-NEXA'); assert.equal(me.workspaces[0].kind, 'meyon'); assert.equal(me.principal.provider, 'meyon');

  const conf = await call('POST', '/api/v2/launches/' + launchId + '/confirm', session);
  assert.equal(conf.status, 200, JSON.stringify(conf.body)); assert.equal(conf.body.mode, 'create');
  const again = await call('POST', '/api/v2/launches/' + launchId + '/confirm', session);
  assert.equal(again.body.jobId, conf.body.jobId, 'a second confirm does not start a second generation'); assert.equal(again.body.already, true);
  const planned = await waitJob(call, session, conf.body.jobId, ['awaiting_plan_approval', 'failed']);
  assert.equal(planned.status, 'awaiting_plan_approval', JSON.stringify(planned.error));
  const plan = provider.calls.filter(c => c.purpose === 'plan').at(-1)!;
  assert.ok(plan.input.includes('Acceptance criteria (approved; each must be demonstrated)') && plan.input.includes('Optional AI suggestions (not approved requirements'), 'approved items and suggestions are labelled apart');
  assert.equal(plan.input.split('The customer uploads a salary certificate before submitting').length - 1, 2, 'criteria stated in the prompt are not repeated in the brief (once in the brief, once in the criteria list)');
  assert.equal((await call('POST', '/api/v2/jobs/' + conf.body.jobId + '/approve', session)).status, 200);
  const job = await waitJob(call, session, conf.body.jobId, ['completed', 'completed_with_warnings', 'failed']);
  assert.notEqual(job.status, 'failed', JSON.stringify(job.error));
  const doc = (await call('GET', '/api/v2/jobs/' + conf.body.jobId + '/document', session)).body;
  assert.ok(doc.screens.find((s: any) => s.id === 'apply').trace[0].story === 'US-101');
  assert.equal(doc.theme.primary, '#0B3D91', 'MEYON branding is applied');

  const saved = await call('POST', '/api/v2/demos', session, { document: doc, launchId });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.demo.projectRef, 'PRJ-NEXA'); assert.ok(saved.body.demo.isPrimary);
  assert.equal((await store.getLaunch(launchId))!.demo_id, saved.body.demo.id, 'the launch is linked to the demo it produced');
  const v = await call('POST', '/api/v2/demos/' + saved.body.demo.id + '/versions', session, { expectedRevision: 1, note: 'US-101' });
  const trace = v.body.version.metadata.trace['US-101'];
  assert.equal(Object.keys(trace).length, 5, 'every approved criterion is traced: ' + JSON.stringify(trace));
  const pub = await call('POST', '/api/v2/demos/' + saved.body.demo.id + '/versions/1/publish', session);
  const pubView = await call('GET', '/api/v2/public/' + pub.body.token);
  assert.ok(!JSON.stringify(pubView.body).includes('US-101'), 'published links never carry requirement references');
});

test('launch codes are single use, expire, and only MEYON with the integration key can consume them', async () => {
  const { call, grant } = await setup();
  const code = await grant({ storyId: 'US-103' });
  assert.equal((await call('POST', '/sim/meyon/demo-builder/v1/launch-grants/consume', 'wrong-key', { code })).status, 401, 'integration key required');
  assert.equal((await call('POST', '/api/v2/launch/exchange', undefined, { code })).status, 200);
  const second = await call('POST', '/api/v2/launch/exchange', undefined, { code });
  assert.equal(second.status, 410); assert.match(second.body.error, /expired or was already used/);
  const short = await grant({ storyId: 'US-103', expiresInSeconds: 1 });
  await new Promise(r => setTimeout(r, 1100));
  assert.equal((await call('POST', '/api/v2/launch/exchange', undefined, { code: short })).status, 410, 'expired grant');
  assert.equal((await call('POST', '/api/v2/launch/exchange', undefined, { code: 'short' })).status, 400);
  // Preparing launches is for signed-in users only (not the shared token, not a MEYON session).
  assert.equal((await call('POST', '/sim/meyon/grants', 'uat', { storyId: 'US-103' })).status, 403);
  assert.equal((await call('POST', '/sim/meyon/grants', undefined, { storyId: 'US-103' })).status, 401);
});

test('a replayed or invalid launch package is refused; no MEYON configured means no launches', async () => {
  const good = await (async () => { const s = await setup(); const code = await s.grant({ storyId: 'US-101' }); return (await s.call('POST', '/sim/meyon/demo-builder/v1/launch-grants/consume', KEY, { code })).body; })();
  const replay = await setup({ meyon: { consumeGrant: async () => ({ ok: true, package: good }) } });
  assert.equal((await replay.call('POST', '/api/v2/launch/exchange', undefined, { code: 'x'.repeat(43) })).status, 200);
  const r2 = await replay.call('POST', '/api/v2/launch/exchange', undefined, { code: 'y'.repeat(43) });
  assert.equal(r2.status, 409, 'the same package (grant id) is accepted once');
  const bad = await setup({ meyon: { consumeGrant: async () => ({ ok: true, package: { ...good, mode: 'extend', base: null } }) } });
  const r3 = await bad.call('POST', '/api/v2/launch/exchange', undefined, { code: 'z'.repeat(43) });
  assert.equal(r3.status, 422); assert.match(r3.body.error, /base/);
  const forged = await setup({ meyon: { consumeGrant: async () => ({ ok: true, package: { ...good, grantId: 'g2', approved: { ...good.approved, acceptanceCriteria: [] } } }) } });
  assert.equal((await forged.call('POST', '/api/v2/launch/exchange', undefined, { code: 'z'.repeat(43) })).status, 422, 'a launch needs approved criteria');
  const down = await setup({ meyon: { consumeGrant: async () => ({ ok: false, reason: 'unavailable' }) } });
  assert.equal((await down.call('POST', '/api/v2/launch/exchange', undefined, { code: 'z'.repeat(43) })).status, 502);
  const none = await setup({ meyon: 'none' });
  assert.equal((await none.call('POST', '/api/v2/launch/exchange', undefined, { code: 'z'.repeat(43) })).status, 503);
});

test('a MEYON session is confined to its tenant and project; others cannot see its launch', async () => {
  const { call, launch, store } = await setup();
  const own = await call('POST', '/api/v2/demos', 'owner-token', { document: fixture });
  const { session, launchId } = await launch({ storyId: 'US-103' });
  assert.equal((await call('GET', '/api/v2/demos/' + own.body.demo.id, session)).status, 404, 'cannot reach a personal demo');
  assert.ok(!(await call('GET', '/api/v2/demos', session)).body.demos.some((d: any) => d.id === own.body.demo.id));
  assert.equal((await call('GET', '/api/v2/launches/' + launchId, 'owner-token')).status, 404, 'a standalone user cannot read a tenant launch');
  assert.equal((await call('GET', '/api/v2/launches/' + launchId, 'uat')).status, 404);
  // Another project in the same tenant is out of reach too.
  const ws = (await call('GET', '/api/v2/me', session)).body.workspaces[0].id;
  const other = await store.createDemo({ workspace_id: ws, name: 'Other project', channel: 'mobile', project_ref: 'PRJ-OTHER', draft: own.body.document, created_by: (await call('GET', '/api/v2/me', session)).body.principal.id });
  assert.equal((await call('GET', '/api/v2/demos/' + other.id, session)).status, 404);
  const mine = await call('POST', '/api/v2/demos', session, { document: own.body.document, projectRef: 'PRJ-OTHER' });
  assert.equal(mine.body.demo.projectRef, 'PRJ-NEXA', 'a session cannot choose another project');
  assert.equal((await call('PATCH', '/api/v2/demos/' + mine.body.demo.id, session, { archived: true })).status, 403, 'sessions cannot archive');
  const tampered = session.replace(/\.([^.]+)\.([^.]+)$/, (_m, p, s) => '.' + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), prj: 'PRJ-OTHER' })).toString('base64url') + '.' + s);
  assert.equal((await call('GET', '/api/v2/me', tampered)).status, 401, 'a modified session is rejected');
});

test('cancel and confirm are mutually exclusive', async () => {
  const { call, launch } = await setup();
  const a = await launch({ storyId: 'US-103' });
  assert.equal((await call('POST', '/api/v2/launches/' + a.launchId + '/cancel', a.session)).body.status, 'cancelled');
  assert.equal((await call('POST', '/api/v2/launches/' + a.launchId + '/confirm', a.session)).status, 409);
  const b = await launch({ storyId: 'US-103' });
  const [x, y] = await Promise.all([call('POST', '/api/v2/launches/' + b.launchId + '/confirm', b.session), call('POST', '/api/v2/launches/' + b.launchId + '/confirm', b.session)]);
  const jobs = [x, y].filter(r => r.status === 200).map(r => r.body.jobId);
  assert.ok(jobs.length >= 1 && new Set(jobs).size === 1, 'a double click starts one generation: ' + JSON.stringify([x, y]));
  assert.equal((await call('POST', '/api/v2/launches/' + b.launchId + '/cancel', b.session)).status, 409);
});

test('Extend resolves the baseline by stable ids within the tenant, project and application type', async () => {
  const { call, launch } = await setup();
  const first = await launch({ storyId: 'US-103' });
  const base = (await call('POST', '/api/v2/demos', first.session, { document: fixture })).body.demo;
  await call('POST', '/api/v2/demos/' + base.id + '/versions', first.session, { expectedRevision: 1, note: 'baseline' });
  const baselines = (await call('GET', '/sim/meyon/baselines', 'owner-token')).body.baselines;
  assert.ok(baselines.some((b: any) => b.demoId === base.id && b.latestVersion === 1));

  const ext = await launch({ storyId: 'US-101', mode: 'extend', baseDemoId: base.id, baseVersion: 1 });
  const view = (await call('GET', '/api/v2/launches/' + ext.launchId, ext.session)).body.launch;
  assert.equal(view.base.check.ok, true); assert.equal(view.base.check.name, base.name);
  const conf = await call('POST', '/api/v2/launches/' + ext.launchId + '/confirm', ext.session);
  assert.equal(conf.status, 200); assert.equal(conf.body.demoId, base.id);
  assert.equal((await call('GET', '/api/v2/demos/' + base.id, ext.session)).status, 200, 'the baseline opens in the extend session');

  const own = (await call('POST', '/api/v2/demos', 'owner-token', { document: fixture })).body.demo;
  await call('POST', '/api/v2/demos/' + own.id + '/versions', 'owner-token', { expectedRevision: 1 });
  const foreign = await launch({ storyId: 'US-101', mode: 'extend', baseDemoId: own.id, baseVersion: 1 });
  assert.equal((await call('GET', '/api/v2/launches/' + foreign.launchId, foreign.session)).body.launch.base.check.ok, false, 'a demo of another tenant is never a baseline');
  assert.equal((await call('POST', '/api/v2/launches/' + foreign.launchId + '/confirm', foreign.session)).status, 409);
  const wrongType = await launch({ storyId: 'US-102', mode: 'extend', baseDemoId: base.id, baseVersion: 1 });
  assert.match((await call('GET', '/api/v2/launches/' + wrongType.launchId, wrongType.session)).body.launch.base.check.problem, /Mobile App/);
  const missing = await launch({ storyId: 'US-101', mode: 'extend', baseDemoId: base.id, baseVersion: 7 });
  assert.match((await call('GET', '/api/v2/launches/' + missing.launchId, missing.session)).body.launch.base.check.problem, /Version 7/);
});

test('launch exchanges have their own rate limit, separate from paid generation', async () => {
  const { call } = await setup();
  for (let i = 0; i < 20; i++) await call('POST', '/api/v2/launch/exchange', undefined, { code: 'short' });
  assert.equal((await call('POST', '/api/v2/launch/exchange', undefined, { code: 'short' })).status, 429, 'the 21st exchange in a minute is refused');
  assert.equal((await call('POST', '/api/v2/jobs', 'owner-token', { request: { name: 'X', channel: 'mobile' }, brief: 'A short brief about a banking app.' })).status, 202, 'generation is still allowed');
});
