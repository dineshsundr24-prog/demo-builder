import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDocument, errorsOnly, flowEdges, type DemoDocument } from '@demo/schema';
import { FakeProvider, Generator, MemoryStore, defaultConfig, linkFrom, describeChanges, type CompletionRequest } from '../src/index.ts';

const kapiko: DemoDocument = JSON.parse(readFileSync(new URL('../../schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const planJson = (over: object = {}) => ({ title: 'Card Management', archetype: 'form', purpose: 'Freeze card, change PIN and set a spending limit.', mustInclude: ['freeze card', 'spending limit'],
  openFrom: 'dashboard', entryLabel: 'Cards', entryIcon: 'credit-card', leadsTo: ['dashboard'], collection: null, newCollection: null, sampleFacts: [{ label: 'Customer', value: 'Ahmed Al Hammadi' }], ...over });
const formContent = { intro: 'Manage your debit card.', current: null, sections: [{ title: 'Card controls', fields: [{ label: 'Freeze card', kind: 'toggle', required: false }, { label: 'Daily spending limit', kind: 'currency', required: true }] }], primaryLabel: 'Save changes', next: 'dashboard', cancel: null };

function provider(plan = planJson(), content: unknown = formContent) {
  return new FakeProvider((req: CompletionRequest) => (req.purpose === 'plan' ? plan : content));
}

test('adds an AI-built screen after its entry screen, linked from it, and the document stays valid', async () => {
  const gen = new Generator(new MemoryStore(), provider(), defaultConfig);
  const out = await gen.addScreen(kapiko, { requirement: 'Card management: freeze card, change PIN, spending limit' });
  const doc = out.document;
  assert.equal(out.screenId, 'card-management');
  assert.equal(doc.screens[doc.screens.findIndex(s => s.id === 'dashboard') + 1].id, 'card-management');
  assert.ok(flowEdges(doc).some(e => e.from === 'dashboard' && e.to === 'card-management'), 'linked from the dashboard');
  assert.ok(flowEdges(doc).some(e => e.from === 'card-management' && e.to === 'dashboard'), 'leads onward');
  assert.deepEqual(errorsOnly(validateDocument(doc)), []);
  assert.ok(out.changes.some(c => c.startsWith('Link:')));
  assert.ok(out.costUsd > 0);
  assert.equal(kapiko.screens.some(s => s.id === 'card-management'), false, 'input untouched');
  const b = await gen.budgetStatus();
  assert.ok(b.spentUsd > 0, 'usage is recorded against the monthly budget');
});

test('the user\'s "opens from", "leads to" and menu choices win over the AI', async () => {
  const gen = new Generator(new MemoryStore(), provider(), defaultConfig);
  const out = await gen.addScreen(kapiko, { requirement: 'Card management', from: 'customer-profile', to: 'my-service-requests', addToMenu: true });
  const edges = flowEdges(out.document);
  assert.ok(edges.some(e => e.from === 'customer-profile' && e.to === out.screenId));
  assert.ok(out.document.shell.items.some(i => i.screen === out.screenId));
});

test('a list screen gets its own sample data when no collection fits', async () => {
  const plan = planJson({ title: 'Beneficiaries', archetype: 'list', collection: null, newCollection: { id: 'beneficiaries', label: 'Beneficiaries', key: 'iban', fields: [{ id: 'name', label: 'Name' }, { id: 'iban', label: 'IBAN' }, { id: 'bank', label: 'Bank' }], rows: [['Sara Al Mansoori', 'AE070331234567890123456', 'Emirates NBD'], ['Omar Haddad', 'AE450260001015333439101', 'ADCB']] } });
  const content = { intro: null, newRequest: null, titleField: 'name', subtitleField: 'bank', statusField: null, columns: ['name', 'iban', 'bank'], searchable: true, filterField: null, detailTarget: null, create: null };
  const gen = new Generator(new MemoryStore(), provider(plan, content), defaultConfig);
  const out = await gen.addScreen(kapiko, { requirement: 'Saved beneficiaries list' });
  assert.ok(out.document.collections.some(c => c.id === 'beneficiaries' && c.rows.length === 2));
  assert.ok(JSON.stringify(out.document.screens.find(s => s.id === out.screenId)).includes('"collection":"beneficiaries"'));
  assert.deepEqual(errorsOnly(validateDocument(out.document)), []);
});

test('entry points: quick action when there is one, otherwise a button before the action bar', () => {
  const doc: DemoDocument = structuredClone(kapiko);
  const home = doc.screens.find(s => s.id === 'dashboard')!;
  (home.children as any[]).push({ type: 'QuickActions', id: 'qa', items: [{ label: 'A', icon: 'home', actions: [] }, { label: 'B', icon: 'home', actions: [] }] });
  const r = linkFrom(doc, 'dashboard', 'welcome', 'Cards', 'credit-card')!;
  assert.match(r.change, /Quick action/);
  const r2 = linkFrom(kapiko, 'income-update', 'welcome', 'Help', 'help')!;
  assert.match(r2.change, /Button/);
});

test('an empty requirement is rejected before any paid call', async () => {
  const p = provider();
  await assert.rejects(new Generator(new MemoryStore(), p, defaultConfig).addScreen(kapiko, { requirement: ' ' }));
  assert.equal(p.calls.length, 0);
});

const rename = (req: CompletionRequest) => {
  const input = JSON.parse(req.input);
  if (req.schemaName === 'route') return { intent: /new|add a screen|create/i.test(input.request) ? 'add_screen' : 'modify_screen', screen: input.currentScreen };
  if (req.schemaName === 'screen_edit') {
    const all: any[] = []; const w = (ns: any[]) => ns.forEach(n => { all.push(n); if (n.children) w(n.children); }); w(input.components);
    const b = all.find(n => n.label === 'Verify'); const { children: _c, ...rest } = b; void _c;
    return { reply: 'Renamed the button.', operations: [{ op: 'replace', target: b.id, node: { ...rest, label: 'Validate' } }] };
  }
  return req.purpose === 'plan' ? planJson() : formContent;
};

test('change mode: a template button is renamed through the assistant, behaviour kept', async () => {
  const otp = kapiko.screens.find(s => JSON.stringify(s).includes('"template":"otp-entry"'))!;
  const gen = new Generator(new MemoryStore(), new FakeProvider(rename), defaultConfig);
  const out = await gen.assist(kapiko, { instruction: 'Rename the Verify button to Validate', currentScreen: otp.id });
  assert.equal(out.action, 'modified');
  const s = out.document.screens.find(x => x.id === otp.id)!;
  assert.ok(JSON.stringify(s).includes('"label":"Validate"'));
  assert.ok(JSON.stringify(s).includes('"type":"navigate"'), 'the button still continues the journey');
  assert.ok(out.changes.some(c => c.includes('Verify') && c.includes('Validate')), out.changes.join(' | '));
  assert.deepEqual(errorsOnly(validateDocument(out.document)), []);
  assert.equal(out.document.screens.length, kapiko.screens.length);
});

test('auto mode routes "add a new screen" requests to the add path', async () => {
  const gen = new Generator(new MemoryStore(), new FakeProvider(rename), defaultConfig);
  const out = await gen.assist(kapiko, { instruction: 'Create a new card management screen', currentScreen: 'dashboard' });
  assert.equal(out.action, 'added');
  assert.equal(out.document.screens.length, kapiko.screens.length + 1);
});

test('an invalid change is refused after one repair and nothing is altered', async () => {
  const bad = new FakeProvider(req => req.schemaName === 'screen_edit' ? { reply: 'Added', operations: [{ op: 'insert', parent: null, after: null, node: { type: 'Button', id: 'b', label: 'Go', variant: 'primary', actions: [{ type: 'navigate', screen: 'nowhere' }] } }] } : { intent: 'modify_screen', screen: 'dashboard' });
  const gen = new Generator(new MemoryStore(), bad, defaultConfig);
  await assert.rejects(gen.assist(kapiko, { instruction: 'Break it', currentScreen: 'dashboard' }), /could not make that change/);
  assert.equal(bad.calls.filter(c => c.schemaName === 'screen_edit').length, 2, 'exactly one repair');
});

test('edits only touch what the operations name; everything else is byte-identical', async () => {
  const otp = kapiko.screens.find(s => JSON.stringify(s).includes('"template":"otp-entry"'))!;
  const gen = new Generator(new MemoryStore(), new FakeProvider(rename), defaultConfig);
  const out = await gen.assist(kapiko, { instruction: 'Rename Verify to Validate', currentScreen: otp.id });
  for (const s of out.document.screens) if (s.id !== otp.id) assert.equal(JSON.stringify(s), JSON.stringify(kapiko.screens.find(x => x.id === s.id)));
  assert.equal(out.reply, 'Renamed the button.');
});

test('no operations: the AI explains, nothing changes', async () => {
  const p = new FakeProvider(req => req.schemaName === 'screen_edit' ? { reply: 'Tables cannot show maps; I can add a branch list instead.', operations: [] } : { intent: 'modify_screen', screen: 'dashboard' });
  const out = await new Generator(new MemoryStore(), p, defaultConfig).assist(kapiko, { instruction: 'Show a map in the table', currentScreen: 'dashboard' });
  assert.equal(out.action, 'none');
  assert.equal(out.document, kapiko);
  assert.match(out.reply, /cannot show maps/);
});

test('inputs that would do nothing are refused and repaired', async () => {
  let n = 0;
  const p = new FakeProvider(req => {
    if (req.schemaName !== 'screen_edit') return { intent: 'modify_screen', screen: 'my-service-requests' };
    n++;
    if (n === 1) return { reply: 'Added date inputs', operations: [{ op: 'insert', parent: null, after: null, node: { type: 'Input', id: 'from', field: 'filter.from', label: 'From', inputType: 'date', required: false } }] };
    const all: any[] = []; const w = (ns: any[]) => ns.forEach(x => { all.push(x); if (x.children) w(x.children); }); w(JSON.parse(req.input).components);
    const t = all.find(x => x.type === 'List'); const { children: _c, ...rest } = t; void _c;
    return { reply: 'Switched on search and status filters', operations: [{ op: 'replace', target: t.id, node: { ...rest, searchable: true, filterField: 'status' } }] };
  });
  const out = await new Generator(new MemoryStore(), p, defaultConfig).assist(kapiko, { instruction: 'Let me search and filter requests', currentScreen: 'my-service-requests' });
  assert.equal(n, 2, 'the inert input triggered one repair');
  assert.ok(JSON.stringify(out.document.screens.find(s => s.id === 'my-service-requests')).includes('"filterField":"status"'));
  assert.deepEqual(errorsOnly(validateDocument(out.document)), []);
});

test('change summaries ignore property order and equivalent form references', () => {
  const s = kapiko.screens.find(x => x.id === 'income-update')!;
  const shuffled = JSON.parse(JSON.stringify(s), (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
  assert.deepEqual(describeChanges(s, shuffled), ['No visible change']);
});
