// EXTEND (A3) through the API: plan against the exact baseline, apply approved items in the background, save a new
// version (published versions untouched), and the base-changed choices (refresh, fork).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeProvider, Generator, MemoryStore, defaultConfig, type CompletionRequest } from '@demo/generator';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.ts';
import { MemoryDemoStore } from '../src/demos/store.ts';
import { httpMeyonClient } from '../src/launch/meyon.ts';
import { contentHash } from '../src/demos/routes.ts';

const KEY = 'test-integration-key-0123456789abcdefghij', SECRET = 'test-session-secret-0123456789abcdefghij';
const kapiko = JSON.parse(readFileSync(new URL('../../../packages/schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const provider = new FakeProvider((req: CompletionRequest) => {
  const input = JSON.parse(req.input);
  if (req.schemaName === 'change_plan') return { summary: 'Add loan application steps.', gaps: [],
    changes: [{ action: 'add', screen: null, title: 'Loan Calculator', description: 'Amount, tenure and instalment.', details: ['Amount slider'], criteria: input.acceptanceCriteria.slice(0, 2).map((c: any) => c.id), openFrom: 'dashboard', addToMenu: false },
      { action: 'modify', screen: 'dashboard', title: 'Dashboard', description: 'Add a personal loan shortcut', details: [], criteria: [input.acceptanceCriteria[0].id], openFrom: null, addToMenu: false },
      { action: 'remove_candidate', screen: 'face-verification', title: 'Face Verification', description: 'Not part of the loan journey', details: [], criteria: [], openFrom: null, addToMenu: false }] };
  if (req.schemaName === 'screen_edit') return { reply: 'Added a loan shortcut.', operations: [{ op: 'replace', target: input.components[0].id, node: { ...input.components[0], children: undefined, text: 'Good morning · Personal loan up to AED 500,000' } }] };
  if (req.purpose === 'plan' && input.existing === undefined && input.screens && input.requirement) // add-screen plan
    return { title: 'Loan Calculator', archetype: 'form', purpose: 'Amount and tenure', mustInclude: ['loan amount'], openFrom: 'dashboard', entryLabel: 'Loan', entryIcon: 'credit-card', leadsTo: ['dashboard'], collection: null, newCollection: null, sampleFacts: [] };
  if (req.schemaName?.startsWith('content_')) return { intro: 'Choose your loan.', current: null, sections: [{ title: 'Loan', fields: [{ label: 'Loan amount', kind: 'currency', required: true }] }], primaryLabel: 'Continue', next: 'dashboard', cancel: null };
  if (req.purpose === 'plan') return { theme: { primary: '#000000', secondary: '#111111', accent: '#222222' }, sampleFacts: [], shellKind: 'tabs', menu: [], collections: [],
    screens: kapiko.screens.slice(0, 2).map((s: any) => ({ id: s.id, title: s.title, purpose: 'p', archetype: 'custom', collection: null, template: null, links: [], shell: 'default', mustInclude: [], criteria: [] })) };
  return structuredClone(kapiko.screens.find((s: any) => s.id === input.screen?.id) ?? kapiko.screens[0]);
});

async function setup() {
  const store = new MemoryDemoStore();
  let app!: FastifyInstance;
  const viaInject: typeof fetch = async (url, init) => { const r = await app.inject({ method: (init?.method ?? 'GET') as any, url: String(url).replace(/^https?:\/\/[^/]+/, ''), headers: init?.headers as any, payload: init?.body as any }); return new Response(r.body, { status: r.statusCode, headers: { 'content-type': 'application/json' } }); };
  app = await buildServer({ generator: new Generator(new MemoryStore(), provider, { ...defaultConfig, retryDelaysMs: [1] }), accessToken: 'uat-token', origins: [], model: 'fake', demoStore: store,
    verifyUser: async t => (t === 'owner-token' ? { id: 'owner-1', email: 'owner@example.invalid' } : null), sessionSecret: SECRET, meyon: httpMeyonClient('http://builder/sim/meyon', KEY, viaInject), meyonSimulator: { integrationKey: KEY } });
  const call = async (method: string, url: string, auth?: string, body?: unknown) => {
    const r = await app.inject({ method: method as any, url, headers: auth ? { authorization: 'Bearer ' + auth } : {}, ...(body !== undefined ? { payload: body as any } : {}) });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  const launch = async (body: Record<string, unknown>) => {
    const g = await call('POST', '/sim/meyon/grants', 'owner-token', body);
    const ex = await call('POST', '/api/v2/launch/exchange', undefined, { code: g.body.code });
    assert.equal(ex.status, 200, JSON.stringify(ex.body));
    const conf = await call('POST', '/api/v2/launches/' + ex.body.launchId + '/confirm', ex.body.session);
    assert.equal(conf.status, 200, JSON.stringify(conf.body));
    return { session: ex.body.session as string, launchId: ex.body.launchId as string, conf: conf.body };
  };
  // A baseline demo of the simulated tenant with version 1.
  const first = await launch({ storyId: 'US-103' });
  const demo = (await call('POST', '/api/v2/demos', first.session, { document: kapiko })).body.demo;
  await call('POST', '/api/v2/demos/' + demo.id + '/versions', first.session, { expectedRevision: 1, note: 'baseline' });
  return { app, store, call, launch, baseId: demo.id as string };
}
const waitTask = async (call: Awaited<ReturnType<typeof setup>>['call'], session: string, id: string) => {
  for (const end = Date.now() + 8000; ;) { const t = (await call('GET', '/api/v2/extend-tasks/' + id, session)).body; if (t.status !== 'running') return t; if (Date.now() > end) throw Error('task stuck: ' + JSON.stringify(t)); await new Promise(r => setTimeout(r, 10)); }
};

test('Extend: plan against the exact baseline, apply approved changes, new version with traceability; removals only when chosen', async () => {
  const { call, launch, baseId, store } = await setup();
  const ext = await launch({ storyId: 'US-101', mode: 'extend', baseDemoId: baseId, baseVersion: 1 });
  assert.equal(ext.conf.demoId, baseId);
  const p = await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/plan', ext.session, {});
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.base.version, 1); assert.equal(p.body.base.changedSince, false);
  assert.deepEqual(p.body.plan.items.map((i: any) => i.kind), ['add', 'modify', 'remove']);
  assert.ok(p.body.plan.unchanged.length > 5);
  const approved = p.body.plan.items.filter((i: any) => i.kind !== 'remove').map((i: any) => i.key);
  const a = await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/apply', ext.session, { planId: p.body.planId, approved });
  assert.equal(a.status, 202, JSON.stringify(a.body));
  const t = await waitTask(call, ext.session, a.body.taskId);
  assert.equal(t.status, 'done', JSON.stringify(t));
  assert.equal(t.result.journey.passed, true, JSON.stringify(t.result.journey));
  assert.equal(t.result.version, 2); assert.equal(t.result.demoId, baseId);
  const v1 = await store.getVersion(baseId, 1), v2 = await store.getVersion(baseId, 2);
  assert.ok(!(v1!.document as any).screens.some((s: any) => s.title === 'Loan Calculator'), 'version 1 is unchanged');
  const doc2 = v2!.document as any;
  assert.ok(doc2.screens.some((s: any) => s.title === 'Loan Calculator'));
  assert.ok(doc2.screens.some((s: any) => s.id === 'face-verification'), 'the unticked removal was not applied');
  assert.equal((v2!.metadata as any).extend.story, 'US-101');
  assert.ok(Object.keys((v2!.metadata as any).trace['US-101']).length >= 2, 'coverage of the new story is recorded');
  // The same plan cannot be applied twice on top of itself: the demo has moved on.
  const again = await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/apply', ext.session, { planId: p.body.planId, approved });
  assert.equal(again.status, 409); assert.equal(again.body.category, 'base_changed'); assert.equal(again.body.latestVersion, 2);
});

test('when the base changed: Fork applies to a new demo from the planned version; Refresh plans on the latest version', async () => {
  const { call, launch, baseId, store } = await setup();
  const ext = await launch({ storyId: 'US-101', mode: 'extend', baseDemoId: baseId, baseVersion: 1 });
  const p = await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/plan', ext.session, {});
  // Someone saves version 2 meanwhile.
  const d = await store.getDemo(baseId);
  await store.saveDraft(baseId, d!.draft_revision, { ...kapiko, name: 'Changed elsewhere' }, d!.created_by!);
  const d2 = await store.getDemo(baseId);
  await store.saveVersion(baseId, d!.created_by!, d2!.draft_revision, contentHash(d2!.draft), 'other change', {});
  const keys = p.body.plan.items.filter((i: any) => i.kind === 'add').map((i: any) => i.key);
  const conflict = await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/apply', ext.session, { planId: p.body.planId, approved: keys });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.category, 'base_changed');
  const fork = await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/apply', ext.session, { planId: p.body.planId, approved: keys, mode: 'fork' });
  const t = await waitTask(call, ext.session, fork.body.taskId);
  assert.equal(t.status, 'done', JSON.stringify(t)); assert.equal(t.result.forked, true); assert.notEqual(t.result.demoId, baseId);
  assert.equal((await store.getDemo(baseId))!.latest_version, 2, 'the original demo is untouched by the fork');
  const forked = await store.getDemo(t.result.demoId);
  assert.equal(forked!.latest_version, 1); assert.ok(!forked!.is_primary, 'a fork never takes over the primary baseline');
  const refreshed = await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/plan', ext.session, { base: 'latest' });
  assert.equal(refreshed.body.base.version, 2); assert.equal(refreshed.body.base.changedSince, false);
});

test('Extend is only for confirmed Extend launches of the same project; plans and tasks belong to their session', async () => {
  const { call, launch, baseId } = await setup();
  const create = await launch({ storyId: 'US-103' });
  assert.equal((await call('POST', '/api/v2/launches/' + create.launchId + '/extend/plan', create.session, {})).status, 409, 'a Create launch cannot extend');
  const ext = await launch({ storyId: 'US-101', mode: 'extend', baseDemoId: baseId, baseVersion: 1 });
  assert.equal((await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/plan', 'owner-token', {})).status, 404, 'a standalone user cannot use a tenant launch');
  const p = await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/plan', ext.session, {});
  const bad = await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/apply', ext.session, { planId: 'not-a-plan', approved: ['c1'] });
  assert.equal(bad.status, 410);
  assert.equal((await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/apply', ext.session, { planId: p.body.planId, approved: ['nope'] })).status, 422);
  const a = await call('POST', '/api/v2/launches/' + ext.launchId + '/extend/apply', ext.session, { planId: p.body.planId, approved: ['c1'] });
  assert.equal((await call('GET', '/api/v2/extend-tasks/' + a.body.taskId, 'owner-token')).status, 404, 'another principal cannot read the task');
  await waitTask(call, ext.session, a.body.taskId);
});
