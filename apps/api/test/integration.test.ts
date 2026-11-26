// MEYON -> Builder: AI screen suggestions for MEYON's prompt preparation (integration key, tenant-scoped base demo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeProvider, Generator, MemoryStore, defaultConfig, type CompletionRequest } from '@demo/generator';
import { buildServer } from '../src/server.ts';
import { MemoryDemoStore } from '../src/demos/store.ts';

const KEY = 'meyon-integration-key-0123456789abcdefghij';
const kapiko = JSON.parse(readFileSync(new URL('../../../packages/schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const seen: unknown[] = [];
const provider = new FakeProvider((req: CompletionRequest) => { const input = JSON.parse(req.input); seen.push(input.existingScreens);
  return { journey: 'Home -> apply -> done', gaps: ['Interest rate?'], screens: [{ title: 'Home', purpose: 'Entry.', details: ['Promo', 'Balance'], criteria: [] }, { title: 'Apply', purpose: 'Apply.', details: ['Amount', 'Tenure'], criteria: [input.acceptanceCriteria[0].id] }] }; });

test('MEYON can ask for screen suggestions with the integration key; a base demo is only read within the same tenant', async () => {
  const store = new MemoryDemoStore();
  const app = await buildServer({ generator: new Generator(new MemoryStore(), provider, defaultConfig), accessToken: 'uat', origins: [], model: 'fake', demoStore: store, integrationKey: KEY });
  const ws = await store.ensureWorkspace({ kind: 'meyon', name: 'Bank A', external_ref: 'tenant-a' });
  const other = await store.ensureWorkspace({ kind: 'meyon', name: 'Bank B', external_ref: 'tenant-b' });
  const mine = await store.createDemo({ workspace_id: ws.id, name: 'App', channel: 'mobile', project_ref: 'P1', draft: kapiko, created_by: 'x' });
  const theirs = await store.createDemo({ workspace_id: other.id, name: 'Other', channel: 'mobile', project_ref: 'P9', draft: kapiko, created_by: 'x' });
  const body = (baseDemoId: string | null) => ({ tenantId: 'tenant-a', channel: 'mobile', project: { name: 'Bank A' }, story: { id: 'REQ-1:US-001', title: 'Apply for a loan' },
    criteria: [{ id: 'REQ-1:US-001:AC-001', text: 'The customer chooses amount and tenure' }], baseDemoId });
  const post = (payload: unknown, auth = 'Bearer ' + KEY) => app.inject({ method: 'POST', url: '/api/v2/integration/suggest-screens', headers: { authorization: auth }, payload: payload as any });
  assert.equal((await post(body(null), 'Bearer wrong')).statusCode, 401);
  assert.equal((await post({ tenantId: 'tenant-a' })).statusCode, 422);
  const ok = await post(body(mine.id));
  assert.equal(ok.statusCode, 200, ok.body);
  const r = JSON.parse(ok.body);
  assert.match(r.text, /1\. \*\*Home:\*\*/); assert.match(r.text, /Demonstrates AC1/);
  assert.ok((seen.at(-1) as string[]).length > 5, 'the tenant\'s own base demo informs the suggestion');
  await post(body(theirs.id));
  assert.deepEqual(seen.at(-1), [], 'another tenant\'s demo is never read');
  const none = await buildServer({ generator: new Generator(new MemoryStore(), provider, defaultConfig), accessToken: 'uat', origins: [], model: 'fake' });
  assert.equal((await none.inject({ method: 'POST', url: '/api/v2/integration/suggest-screens', headers: { authorization: 'Bearer ' + KEY }, payload: body(null) as any })).statusCode, 401, 'no key configured: refused');
});
