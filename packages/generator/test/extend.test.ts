// EXTEND (A3): change plan against the exact baseline, apply approved items only, traceability and journey check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { errorsOnly, flowEdges, validateDocument, type DemoDocument } from '@demo/schema';
import { FakeProvider, Generator, MemoryStore, defaultConfig, journeyCheck, type CompletionRequest } from '../src/index.ts';

const kapiko: DemoDocument = JSON.parse(readFileSync(new URL('../../schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
// The baseline already demonstrates another story on the dashboard (changing it affects that story too).
const base: DemoDocument = { ...kapiko, screens: kapiko.screens.map(s => (s.id === 'dashboard' ? { ...s, trace: [{ story: 'US-090', criteria: ['US-090:ac-1'], confidence: 'high', source: 'generated' }] } : s)) };
const criteria = [{ id: 'US-103:ac-1', text: 'The customer sees each card with its masked number and status' }, { id: 'US-103:ac-2', text: 'The customer can freeze an active card after confirming' }, { id: 'US-103:ac-3', text: 'Quarterly travel insurance statement upload' }];
const story = { id: 'US-103', title: 'Freeze and unfreeze a debit card', version: 1 };

const changePlan = {
  summary: 'Add card management and an entry point on the dashboard.',
  changes: [
    { action: 'add', screen: null, title: 'Card Management', description: 'Cards with masked numbers and status; freeze or unfreeze after confirming.', details: ['Card visual', 'Freeze toggle'], criteria: ['US-103:ac-1', 'US-103:ac-2'], openFrom: 'dashboard', addToMenu: false },
    { action: 'add', screen: null, title: 'Dashboard', description: 'duplicate of an existing title', details: [], criteria: [], openFrom: null, addToMenu: false },
    { action: 'modify', screen: 'dashboard', title: 'Dashboard', description: 'Add a "Cards" quick action', details: [], criteria: ['US-103:ac-1'], openFrom: null, addToMenu: false },
    { action: 'remove_candidate', screen: 'face-verification', title: 'Face Verification', description: 'Not needed for card controls', details: [], criteria: [], openFrom: null, addToMenu: false },
    { action: 'modify', screen: 'dashboard', title: 'Dashboard', description: 'second change to the same screen is ignored', details: [], criteria: [], openFrom: null, addToMenu: false },
  ],
  gaps: ['Can a frozen card still receive refunds?'],
};
const addPlan = { title: 'Card Management', archetype: 'form', purpose: 'Freeze card and see status.', mustInclude: ['freeze card'], openFrom: 'dashboard', entryLabel: 'Cards', entryIcon: 'credit-card', leadsTo: ['dashboard'], collection: null, newCollection: null, sampleFacts: [] };
const formContent = { intro: 'Your debit card ending 3456 is active.', current: null, sections: [{ title: 'Card controls', fields: [{ label: 'Freeze card', kind: 'toggle', required: false }] }], primaryLabel: 'Save', next: 'dashboard', cancel: null };

function fake() {
  return new FakeProvider((req: CompletionRequest) => {
    if (req.schemaName === 'change_plan') return changePlan;
    if (req.schemaName === 'screen_edit') { const input = JSON.parse(req.input); return { reply: 'Added a Cards shortcut.', operations: [{ op: 'replace', target: input.components[0].id, node: { ...input.components[0], children: undefined, text: 'Good morning, Ahmed · Cards and accounts' } }] }; }
    return req.purpose === 'plan' ? addPlan : formContent;
  });
}

test('the change plan lists new, changed, unchanged and possibly obsolete screens, and warns about shared screens', async () => {
  const gen = new Generator(new MemoryStore(), fake(), defaultConfig);
  const { plan, costUsd } = await gen.planExtension(base, { story, criteria });
  assert.ok(costUsd > 0);
  assert.deepEqual(plan.items.map(i => i.kind + ':' + i.title), ['add:Card Management', 'modify:Dashboard', 'remove:Face Verification'], 'duplicates and existing titles are dropped');
  assert.deepEqual(plan.items.find(i => i.kind === 'modify')!.kind === 'modify' && (plan.items.find(i => i.kind === 'modify') as any).sharedWith, ['US-090']);
  assert.equal(plan.unchanged.length, base.screens.length - 2);
  assert.deepEqual(plan.navigation, ['"Dashboard" gets a link to "Card Management"']);
  assert.deepEqual(plan.uncovered, ['US-103:ac-3'], 'criteria nothing addresses are reported');
  assert.deepEqual(plan.gaps, ['Can a frozen card still receive refunds?']);
});

test('applying changes only the approved items, never removes unless chosen, traces the story and passes the journey check', async () => {
  const gen = new Generator(new MemoryStore(), fake(), defaultConfig);
  const { plan } = await gen.planExtension(base, { story, criteria });
  const keys = plan.items.filter(i => i.kind !== 'remove').map(i => i.key); // the removal is not ticked
  const steps: string[] = [];
  const r = await gen.applyExtension(base, plan, keys, criteria, (_d, _t, label) => steps.push(label));
  const doc = r.document;
  assert.ok(doc.screens.some(s => s.title === 'Card Management'), 'new screen added with the approved title');
  assert.ok(doc.screens.some(s => s.id === 'face-verification'), 'unticked removal is not applied');
  assert.ok(flowEdges(doc).some(e => e.from === 'dashboard' && e.to === doc.screens.find(s => s.title === 'Card Management')!.id), 'opens from the dashboard');
  const card = doc.screens.find(s => s.title === 'Card Management')!;
  assert.deepEqual(card.trace!.flatMap(t => t.criteria).sort(), ['US-103:ac-1', 'US-103:ac-2']);
  const dash = doc.screens.find(s => s.id === 'dashboard')!;
  assert.ok(dash.trace!.some(t => t.story === 'US-090'), 'the other story keeps its link');
  assert.ok(dash.trace!.some(t => t.story === 'US-103'));
  assert.equal(r.journey.passed, true, JSON.stringify(r.journey));
  assert.ok(r.journey.reachableAfter > r.journey.reachableBefore);
  assert.deepEqual(errorsOnly(validateDocument(doc)), []);
  assert.ok(steps.at(-1) === 'Checking every journey' && steps[0].startsWith('Adding'), 'new screens first: ' + steps.join(' / '));
  assert.ok(r.costUsd > 0);
  assert.equal(base.screens.some(s => s.title === 'Card Management'), false, 'the baseline document is untouched');
  // Ticking the removal removes it.
  const r2 = await gen.applyExtension(base, plan, plan.items.map(i => i.key), criteria);
  assert.ok(!r2.document.screens.some(s => s.id === 'face-verification'));
});

test('the journey check fails when a change makes existing screens unreachable', () => {
  const broken: DemoDocument = { ...kapiko, shell: { ...kapiko.shell, items: [] }, screens: kapiko.screens.map(s => ({ ...s, children: s.id === 'welcome' ? [] : s.children })) };
  const j = journeyCheck(kapiko, broken, []);
  assert.equal(j.passed, false);
  assert.ok(j.lostScreens.length > 0);
});

test('nothing to apply is refused', async () => {
  const gen = new Generator(new MemoryStore(), fake(), defaultConfig);
  const { plan } = await gen.planExtension(base, { story, criteria });
  await assert.rejects(gen.applyExtension(base, plan, [], criteria), /Choose at least one change/);
});
