// Requirement traceability: approved acceptance criteria -> planned screens -> trace on generated screens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiScreenSchema, errorsOnly, validateDocument, type DemoDocument } from '@demo/schema';
import { FakeProvider, Generator, MemoryStore, defaultConfig, type CompletionRequest, type JobRow, type Requirement } from '../src/index.ts';

const kapikoDoc: DemoDocument = JSON.parse(readFileSync(new URL('../../schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const cfg = { ...defaultConfig, retryDelaysMs: [1, 1] };
const requirements: Requirement[] = [{ story: 'US-014', title: 'Update monthly income', criteria: [
  { id: 'US-014:ac-1', text: 'The customer enters the new monthly salary and uploads a salary certificate' },
  { id: 'US-014:ac-2', text: 'The customer reviews the income details before submitting' },
  { id: 'US-014:ac-3', text: 'Quantum entanglement telemetry dashboard for orbital stations' },
  { id: 'US-014:ac-4', text: 'A criterion the planner forgets' },
] }];
const plan = (req: CompletionRequest) => {
  const input = JSON.parse(req.input);
  assert.deepEqual(input.acceptanceCriteria.map((c: any) => c.id), ['US-014:ac-1', 'US-014:ac-2', 'US-014:ac-3', 'US-014:ac-4'], 'the planner sees every approved criterion with its id');
  const screen = (id: string, criteria: string[], links: string[] = []) => ({ id, title: kapikoDoc.screens.find(s => s.id === id)!.title, purpose: 'Purpose', archetype: 'custom', collection: null, template: null, links, shell: 'default', mustInclude: [], criteria });
  return { theme: { primary: '#000000', secondary: '#111111', accent: '#222222' }, sampleFacts: [], shellKind: 'tabs', menu: [{ label: 'Home', icon: 'home', screen: 'income-update' }], collections: [],
    screens: [screen('income-update', ['US-014:ac-1', 'US-014:ac-3', 'US-INVENTED:ac-9'], ['income-verification-review']), screen('income-verification-review', ['US-014:ac-2'], ['income-update'])] };
};
/** Kapiko screens, with links to screens outside this two-screen plan pointed at the other planned screen. */
const fixtureScreen = (id: string) => JSON.parse(JSON.stringify(kapikoDoc.screens.find(s => s.id === id)!).replace(/"screen":"([a-z0-9-]+)"/g, (m, t) => ['income-update', 'income-verification-review'].includes(t) ? m : '"screen":"' + (id === 'income-update' ? 'income-verification-review' : 'income-update') + '"'));
async function waitFor(gen: Generator, id: string, statuses: string[]): Promise<JobRow> {
  for (const end = Date.now() + 5000; ;) { const j = (await gen.store.getJob(id))!; if (statuses.includes(j.status)) return j; if (Date.now() > end) throw Error('Timed out in ' + j.status); await new Promise(r => setTimeout(r, 5)); }
}

test('approved criteria are planned onto screens and recorded as traceability with honest confidence', async () => {
  const provider = new FakeProvider(req => req.purpose === 'plan' ? plan(req) : fixtureScreen(JSON.parse(req.input).screen.id));
  const gen = new Generator(new MemoryStore(), provider, cfg);
  const job = await gen.startPlan({ name: 'Income', channel: 'mobile', requirements }, 'Update monthly income: enter salary, upload certificate, review, submit.');
  const planned = await waitFor(gen, job.id, ['awaiting_plan_approval', 'failed']);
  assert.equal(planned.status, 'awaiting_plan_approval', JSON.stringify(planned.error));
  assert.deepEqual(planned.plan.screens[0].criteria, ['US-014:ac-1', 'US-014:ac-3'], 'unknown ids are dropped');
  assert.ok(planned.plan.notes.some((n: string) => n.includes('US-014:ac-4') && n.includes('not demonstrated')), 'unplanned criterion is reported');
  // A client cannot replace the approved requirements while approving an edited plan.
  await gen.approvePlan(job.id, { ...planned.plan, requirements: [{ story: 'US-666', criteria: [{ id: 'US-666:x', text: 'forged' }] }], screens: planned.plan.screens.map((s: any) => ({ ...s, criteria: [...s.criteria, 'US-666:x'] })) });
  const done = await waitFor(gen, job.id, ['completed', 'completed_with_warnings', 'failed']);
  const doc = done.document as DemoDocument;
  assert.deepEqual(errorsOnly(validateDocument(doc)), []);
  assert.equal(done.status, 'completed', JSON.stringify(done.warnings));
  assert.deepEqual(done.plan.requirements, requirements, 'stored plan keeps the approved requirements');
  const update = doc.screens.find(s => s.id === 'income-update')!.trace!;
  assert.ok(update.some(t => t.story === 'US-014' && t.criteria.includes('US-014:ac-1') && t.confidence === 'high' && t.source === 'generated'), JSON.stringify(update));
  assert.ok(update.some(t => t.criteria.includes('US-014:ac-3') && t.confidence === 'low'), 'planned but not visible is low, never high');
  assert.ok(!JSON.stringify(doc).includes('US-666'), 'forged criterion never reaches the document');
  assert.ok(doc.screens.find(s => s.id === 'income-verification-review')!.trace!.some(t => t.criteria.includes('US-014:ac-2')));
});

test('without requirements nothing changes: no trace, no criteria in the plan schema', async () => {
  const provider = new FakeProvider(req => {
    if (req.purpose !== 'plan') return fixtureScreen(JSON.parse(req.input).screen.id);
    assert.ok(!JSON.stringify(req.schema).includes('"criteria"'));
    const p = plan({ ...req, input: JSON.stringify({ acceptanceCriteria: requirements[0].criteria }) });
    for (const s of p.screens) delete (s as any).criteria;
    return p;
  });
  const gen = new Generator(new MemoryStore(), provider, cfg);
  const job = await gen.startPlan({ name: 'Income', channel: 'mobile' }, 'Update monthly income: enter salary, upload certificate, review, submit.');
  await waitFor(gen, job.id, ['awaiting_plan_approval']);
  await gen.approvePlan(job.id);
  const done = await waitFor(gen, job.id, ['completed', 'completed_with_warnings', 'failed']);
  assert.ok((done.document as DemoDocument).screens.every(s => s.trace === undefined));
});

test('the AI screen schema never asks the model for traceability', () => {
  assert.ok(!JSON.stringify(aiScreenSchema({ channel: 'mobile', screenIds: ['a'], collectionIds: [] })).includes('"trace"'));
});
