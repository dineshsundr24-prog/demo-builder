import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeProvider, Generator, MemoryStore, defaultConfig, type CompletionRequest } from '@demo/generator';
import { buildServer } from '../src/server.ts';

const brief = readFileSync(new URL('../../../packages/generator/fixtures/kapiko-brief.md', import.meta.url), 'utf8');
const kapiko = JSON.parse(readFileSync(new URL('../../../packages/schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const provider = () => new FakeProvider((req: CompletionRequest) => {
  const input = JSON.parse(req.input);
  if (req.purpose === 'plan') return { theme: { primary: '#000000', secondary: '#111111', accent: '#222222' }, sampleFacts: [], shellKind: 'tabs', menu: [{ label: 'Home', icon: 'home', screen: 'dashboard' }],
    collections: [{ id: 'service-requests', label: 'Requests', key: 'ref', fields: [{ id: 'ref', label: 'Ref' }, { id: 'type', label: 'Type' }, { id: 'status', label: 'Status' }, { id: 'date', label: 'Date' }], rows: [['A', 'B', 'C', 'D'], ['E', 'F', 'G', 'H']] }],
    screens: input.screenList.map((s: any) => ({ id: s.id, title: s.title, purpose: 'p', template: null, links: [], shell: 'default' })) };
  return kapiko.screens.find((s: any) => s.id === input.screen.id);
});
const TOKEN = 'test-token-123';
async function server() {
  return buildServer({ generator: new Generator(new MemoryStore(), provider(), { ...defaultConfig, retryDelaysMs: [1] }), accessToken: TOKEN, origins: ['http://localhost:5173'], model: 'fake' });
}
const auth = { 'x-builder-access': TOKEN };
async function until(app: any, id: string, statuses: string[]) {
  for (let i = 0; i < 500; i++) { const r = (await app.inject({ url: '/api/v2/jobs/' + id, headers: auth })).json(); if (statuses.includes(r.job.status)) return r; await new Promise(r => setTimeout(r, 5)); }
  throw Error('timeout');
}

test('status is public; job routes require the access token', async () => {
  const app = await server();
  const s = await app.inject({ url: '/api/v2/status' });
  assert.equal(s.statusCode, 200);
  assert.equal(s.json().store, 'memory');
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/jobs', payload: {} })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/jobs', headers: { 'x-builder-access': 'wrong' }, payload: {} })).statusCode, 401);
});

test('create -> plan -> approve -> document, over HTTP', async () => {
  const app = await server();
  const created = await app.inject({ method: 'POST', url: '/api/v2/jobs', headers: auth, payload: { request: { name: 'Kapiko', channel: 'mobile' }, brief } });
  assert.equal(created.statusCode, 202);
  const id = created.json().id;
  const planned = await until(app, id, ['awaiting_plan_approval']);
  assert.equal(planned.job.plan.screens.length, 12);
  assert.equal(planned.screens.length, 12);
  assert.equal((await app.inject({ url: '/api/v2/jobs/' + id + '/document', headers: auth })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/jobs/' + id + '/approve', headers: auth, payload: {} })).statusCode, 200);
  const done = await until(app, id, ['completed', 'completed_with_warnings', 'failed']);
  assert.equal(done.job.status, 'completed');
  const doc = (await app.inject({ url: '/api/v2/jobs/' + id + '/document', headers: auth })).json();
  assert.equal(doc.screens.length, 12);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v2/jobs/' + id + '/approve', headers: auth, payload: {} })).statusCode, 409, 'cannot approve twice');
});

test('bad input and unknown jobs return clear errors', async () => {
  const app = await server();
  const bad = await app.inject({ method: 'POST', url: '/api/v2/jobs', headers: auth, payload: { request: { name: 'x', channel: 'watch' }, brief } });
  assert.equal(bad.statusCode, 400); assert.equal(bad.json().category, 'bad_request');
  const missing = await app.inject({ url: '/api/v2/jobs/00000000-0000-0000-0000-000000000000', headers: auth });
  assert.equal(missing.statusCode, 404);
});

test('malformed ids never reach storage; storage errors do not leak database details', async () => {
  const app = await server();
  for (const id of ['not-a-uuid', "x'or'1'='1", '..%2F..%2Fetc', 'abc&select=*']) {
    const r = await app.inject({ url: '/api/v2/jobs/' + encodeURIComponent(id), headers: auth });
    assert.equal(r.statusCode, 404, id);
  }
  const { StoreError, MemoryStore: MS } = await import('@demo/generator');
  class Broken extends MS { async getJob(): Promise<never> { throw new StoreError('Supabase GET generation_jobs failed (500): PGRST205 secret table detail', 500); } }
  const broken = await buildServer({ generator: new Generator(new Broken(), provider(), defaultConfig), accessToken: TOKEN, origins: [], model: 'fake' });
  const r = await broken.inject({ url: '/api/v2/jobs/00000000-0000-0000-0000-000000000000', headers: auth });
  assert.equal(r.statusCode, 503);
  assert.ok(!r.body.includes('PGRST') && !r.body.includes('generation_jobs') && r.json().error.includes('reference err_'));
});
