// Sync events to MEYON (A4): outbox, signed delivery, retries, idempotency, and what MEYON (simulated) receives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeProvider, Generator, MemoryStore, defaultConfig } from '@demo/generator';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.ts';
import { MemoryDemoStore } from '../src/demos/store.ts';
import { httpMeyonClient } from '../src/launch/meyon.ts';
import { signEvent, verifyEvent, keyId } from '../src/sync/events.ts';

const KEY = 'test-integration-key-0123456789abcdefghij', SECRET = 'test-session-secret-0123456789abcdefghij';
const EV1 = 'event-secret-one-0123456789abcdefghijklmn', EV2 = 'event-secret-two-0123456789abcdefghijklmn';
const kapiko = JSON.parse(readFileSync(new URL('../../../packages/schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const withTrace = { ...kapiko, screens: kapiko.screens.map((s: any, i: number) => (i === 1 ? { ...s, trace: [{ story: 'US-103', criteria: ['US-103:ac-1', 'US-103:ac-2'], confidence: 'high', source: 'generated' }] } : s)) };

async function setup(o: { sinkStatus?: () => number } = {}) {
  const store = new MemoryDemoStore();
  let app!: FastifyInstance;
  const sent: { headers: Record<string, string>; body: string }[] = [];
  const viaInject: typeof fetch = async (url, init) => {
    if (String(url).includes('/events')) sent.push({ headers: init?.headers as Record<string, string>, body: String(init?.body) });
    if (o.sinkStatus && String(url).includes('/events')) { const s = o.sinkStatus(); if (s !== 200) return new Response('{"error":"down"}', { status: s }); }
    const r = await app.inject({ method: (init?.method ?? 'GET') as any, url: String(url).replace(/^https?:\/\/[^/]+/, ''), headers: init?.headers as any, payload: init?.body as any });
    return new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } });
  };
  app = await buildServer({ generator: new Generator(new MemoryStore(), new FakeProvider(() => ({})), defaultConfig), accessToken: 'uat-token', origins: [], model: 'fake', demoStore: store,
    verifyUser: async t => (t === 'owner-token' ? { id: 'owner-1', email: 'owner@example.invalid' } : null), sessionSecret: SECRET, meyon: httpMeyonClient('http://b/sim/meyon', KEY, viaInject),
    meyonSimulator: { integrationKey: KEY, eventSecrets: [EV2, EV1] }, sync: { url: 'http://b/sim/meyon/demo-builder/v1/events', secrets: [EV1], intervalMs: 0, fetcher: viaInject } });
  const call = async (method: string, url: string, auth?: string, body?: unknown) => {
    const r = await app.inject({ method: method as any, url, headers: auth ? { authorization: 'Bearer ' + auth } : {}, ...(body !== undefined ? { payload: body as any } : {}) });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  const launch = async () => {
    const g = await call('POST', '/sim/meyon/grants', 'owner-token', { storyId: 'US-103' });
    const ex = await call('POST', '/api/v2/launch/exchange', undefined, { code: g.body.code });
    return { session: ex.body.session as string, launchId: ex.body.launchId as string };
  };
  return { app, store, call, launch, sent };
}

test('a MEYON demo\'s life is reported to MEYON: signed, once each, with coverage and never the published link', async () => {
  const { app, store, call, launch, sent } = await setup();
  const { session, launchId } = await launch();
  await call('POST', '/api/v2/launches/' + launchId + '/cancel', session);
  const l2 = await launch();
  const d = (await call('POST', '/api/v2/demos', l2.session, { document: withTrace })).body.demo;
  await call('POST', '/api/v2/demos/' + d.id + '/versions', l2.session, { expectedRevision: 1, note: 'first' });
  const pub = await call('POST', '/api/v2/demos/' + d.id + '/versions/1/publish', l2.session);
  const detail = await call('GET', '/api/v2/demos/' + d.id, l2.session);
  await call('POST', '/api/v2/demos/' + d.id + '/publications/' + detail.body.publications[0].id + '/revoke', l2.session);

  const r = await app.sync.deliverDue();
  assert.deepEqual(r, { delivered: 5, failed: 0 });
  assert.deepEqual([...(store as MemoryDemoStore).events.values()].map(e => e.type), ['launch.cancelled', 'demo.created', 'demo.version_saved', 'demo.published', 'demo.publication_revoked']);
  assert.ok([...(store as MemoryDemoStore).events.values()].every(e => e.delivered_at), 'all marked delivered');
  for (const s of sent) assert.ok(verifyEvent([EV1], s.headers['x-demo-builder-signature'], s.body), 'signed with the first secret');
  assert.equal(sent[0].headers['x-demo-builder-key'], keyId(EV1));
  const all = sent.map(s => s.body).join('\n');
  assert.ok(!all.includes(pub.body.token), 'the published link token is never sent');
  assert.ok(!all.includes('"children"'), 'no document content');
  const version = JSON.parse(sent[2].body);
  assert.equal(version.type, 'demo.version_saved'); assert.equal(version.tenant.id, 'sim-tenant');
  assert.deepEqual(Object.keys(version.version.coverage['US-103']).sort(), ['US-103:ac-1', 'US-103:ac-2']);
  assert.equal(version.launch.story, 'US-103'); assert.equal(version.launch.grantId.startsWith('sim-'), true);

  const seen = await call('GET', '/sim/meyon/events', 'owner-token');
  assert.equal(seen.body.events.length, 5);
  assert.deepEqual(seen.body.events.find((e: any) => e.type === 'demo.version_saved').coverage, { 'US-103': 2 });
  assert.equal((await app.sync.deliverDue()).delivered, 0, 'nothing is sent twice');
});

test('standalone demos produce no events', async () => {
  const { app, call, store } = await setup();
  const d = (await call('POST', '/api/v2/demos', 'owner-token', { document: kapiko })).body.demo;
  await call('POST', '/api/v2/demos/' + d.id + '/versions', 'owner-token', { expectedRevision: 1 });
  assert.equal((store as MemoryDemoStore).events.size, 0);
  assert.deepEqual(await app.sync.deliverDue(), { delivered: 0, failed: 0 });
});

test('undelivered events are retried with backoff until MEYON accepts them; a repeat is treated as delivered', async () => {
  let status = 503;
  const { app, store, launch, call } = await setup({ sinkStatus: () => status });
  const l = await launch();
  await call('POST', '/api/v2/launches/' + l.launchId + '/cancel', l.session);
  assert.deepEqual(await app.sync.deliverDue(), { delivered: 0, failed: 1 });
  const e = [...(store as MemoryDemoStore).events.values()][0];
  assert.equal(e.attempts, 1); assert.match(e.last_error!, /HTTP 503/);
  assert.ok(Date.parse(e.next_attempt_at) > Date.now() + 10_000, 'backs off before retrying');
  assert.deepEqual(await app.sync.deliverDue(), { delivered: 0, failed: 0 }, 'not due yet');
  e.next_attempt_at = new Date(Date.now() - 1000).toISOString(); (store as MemoryDemoStore).events.set(e.id, e);
  status = 200;
  assert.deepEqual(await app.sync.deliverDue(), { delivered: 1, failed: 0 });
  // MEYON already has it (e.g. our acknowledgement was lost): 409 counts as delivered.
  const body = JSON.stringify({ id: e.id, ...e.payload });
  const repeat = await app.inject({ method: 'POST', url: '/sim/meyon/demo-builder/v1/events', payload: body, headers: { 'content-type': 'application/json', 'x-demo-builder-event': e.id, ...signEvent(EV1, body) } });
  assert.equal(repeat.statusCode, 409, 'MEYON reports the repeat; the sender treats 409 as delivered');
  const unsigned = await call('POST', '/sim/meyon/demo-builder/v1/events', undefined, { id: 'x', type: 'demo.created' });
  assert.equal(unsigned.status, 401, 'unsigned events are refused');
});

test('signatures: any active secret during rotation, 5-minute window, tampering detected', () => {
  const body = JSON.stringify({ id: 'e1', type: 'demo.created' });
  const h = signEvent(EV2, body)['x-demo-builder-signature'];
  assert.ok(verifyEvent([EV1, EV2], h, body), 'old or new secret during rotation');
  assert.ok(!verifyEvent([EV1], h, body), 'unknown secret');
  assert.ok(!verifyEvent([EV2], h, body.replace('created', 'deleted')), 'tampered body');
  const old = signEvent(EV2, body, Math.floor(Date.now() / 1000) - 600)['x-demo-builder-signature'];
  assert.ok(!verifyEvent([EV2], old, body), 'replayed outside the window');
});
