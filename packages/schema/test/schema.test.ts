import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  components, createNode, Node, templates, expandTemplate, validateDocument, validateScreen, documentContext, errorsOnly,
  aiScreenSchema, lintStrict, stripNulls, componentGuide, resolveText, flowEdges, migrateV1, type DemoDocument,
} from '../src/index.ts';

const load = (f: string): DemoDocument => JSON.parse(readFileSync(new URL('../fixtures/' + f, import.meta.url), 'utf8'));
const kapiko = load('kapiko-mobile.json');
const portal = load('staff-portal.json');

test('every registry component creates a structurally valid node', () => {
  for (const c of components) {
    const r = Node.safeParse(createNode(c.type, 'x-' + c.type));
    // Table/List/Template need real references; structure must still parse except for empty refs.
    if (['Table', 'List', 'Template'].includes(c.type)) continue;
    assert.ok(r.success, c.type + ': ' + JSON.stringify(r.error?.issues?.slice(0, 2)));
  }
  assert.ok(components.length >= 25, 'at least 25 components, got ' + components.length);
});

test('every template expands to valid nodes with working routes and no errors', () => {
  for (const t of templates) {
    const doc: DemoDocument = { ...structuredClone(kapiko), channel: t.channels[0], shell: { ...kapiko.shell, kind: 'none', items: [] },
      screens: [{ id: 'a', title: 'A', shell: 'default', children: [{ type: 'Template', id: 't', template: t.id, next: 'b' }] }, { id: 'b', title: 'B', shell: 'default', children: [{ type: 'Text', id: 'x', text: 'done' }] }] };
    for (const n of expandTemplate({ type: 'Template', id: 't', template: t.id, next: 'b' })) assert.ok(Node.safeParse(n).success, t.id);
    const errors = errorsOnly(validateDocument(doc));
    assert.deepEqual(errors, [], t.id);
    assert.ok(flowEdges(doc).some(e => e.from === 'a' && e.to === 'b'), t.id + ' must navigate to next');
    assert.ok(JSON.stringify(expandTemplate({ type: 'Template', id: 't', template: t.id })).match(/simulat|demo|fictional|not uploaded|Sent to checker|approved|Returned|Rejected/i), t.id + ' must be labelled');
  }
});

test('Kapiko mobile fixture: exactly 12 screens, no errors, every screen reachable', () => {
  const issues = validateDocument(kapiko);
  assert.equal(kapiko.screens.length, 12);
  assert.deepEqual(errorsOnly(issues), []);
  assert.deepEqual(issues.filter(i => i.code === 'flow.unreachable'), []);
});

test('Kapiko journeys exist as navigation edges', () => {
  const e = flowEdges(kapiko);
  const has = (a: string, b: string) => e.some(x => x.from === a && x.to === b);
  for (const [a, b] of [['welcome', 'sign-up'], ['sign-up', 'mobile-otp-verification'], ['mobile-otp-verification', 'ekyc-using-uae-pass'], ['ekyc-using-uae-pass', 'face-verification'],
    ['face-verification', 'dashboard'], ['welcome', 'sign-in'], ['sign-in', 'dashboard'], ['dashboard', 'income-update'], ['income-update', 'income-verification-review'],
    ['income-verification-review', 'income-update-confirmation'], ['income-update-confirmation', 'my-service-requests'], ['dashboard', 'customer-profile']])
    assert.ok(has(a, b), a + ' -> ' + b);
});

test('Staff portal fixture: no errors; details, maker and checker receive the selected record', () => {
  const issues = validateDocument(portal);
  assert.deepEqual(errorsOnly(issues), []);
  assert.deepEqual(issues.filter(i => i.code === 'binding.no-record'), []);
  const ctx = documentContext(portal);
  for (const s of ['application-details', 'maker-review', 'checker-approval']) assert.ok(ctx.recordScreens.has(s), s);
});

test('no fixed screen limit: 60 screens validate', () => {
  const d = structuredClone(kapiko);
  for (let i = 0; i < 48; i++) d.screens.push({ id: 'extra-' + i, title: 'Extra ' + i, shell: 'default', children: [{ type: 'Text', id: 't', text: 'x' }] });
  assert.equal(d.screens.length, 60);
  assert.deepEqual(errorsOnly(validateDocument(d)), []);
});

test('strict AI schema is lint-clean for both channels and stays small', () => {
  for (const doc of [kapiko, portal]) {
    const schema = aiScreenSchema({ channel: doc.channel, screenIds: doc.screens.map(s => s.id), collectionIds: doc.collections.map(c => c.id) });
    const lint = lintStrict(schema);
    assert.deepEqual(lint.problems, [], doc.channel);
    assert.ok(lint.bytes < 30000, doc.channel + ' schema bytes ' + lint.bytes); // budget for prompt size and caching (raised for banking blocks)
    assert.ok(JSON.stringify(schema).includes('"enum":["' + doc.screens[0].id + '"'));
    assert.ok(JSON.stringify(schema).includes('"format":{"anyOf"') || JSON.stringify(schema).includes('"format":{"type"'), 'column format property survives strictify');
    const portalOnly = JSON.stringify(schema).includes('"maker-review"');
    assert.equal(portalOnly, doc.channel === 'portal', 'templates filtered by channel');
  }
  const guide = componentGuide('mobile');
  for (const c of components) assert.ok(guide.includes('- ' + c.type), c.type + ' in guide');
});

test('v1 and live-model failure shapes are rejected with exact paths and reasons', () => {
  const ctx = documentContext(kapiko);
  const cases: [string, any, string][] = [
    ['unknown kind', { type: 'Carousel', id: 'x' }, 'schema.'],
    ['bad notice tone', { type: 'Notice', id: 'x', tone: 'danger', title: 't' }, 'schema.'],
    ['unknown destination', { type: 'Button', id: 'x', label: 'Go', variant: 'primary', actions: [{ type: 'navigate', screen: 'screen-b' }] }, 'route.unknown'],
    ['wrong action key', { type: 'Button', id: 'x', label: 'Go', variant: 'primary', actions: [{ type: 'navigate', screenId: 'dashboard' }] }, 'schema.'],
    ['column not in collection', { type: 'Table', id: 'x', collection: 'service-requests', searchable: false, columns: [{ field: 'amount', label: 'Amount' }] }, 'data.field'],
    ['submit outside any form (live gpt-4.1-mini case)', { type: 'Button', id: 'x', label: 'Continue', variant: 'primary', actions: [{ type: 'submit', validate: true }] }, 'form.missing'],
    ['submit naming a missing form', { type: 'Button', id: 'x', label: 'Continue', variant: 'primary', actions: [{ type: 'submit', form: 'nope', validate: true }] }, 'form.unknown'],
    ['bad binding formatter', { type: 'Text', id: 'x', text: 'Hi {{state.a | shout}}' }, 'binding.syntax'],
  ];
  for (const [name, node, code] of cases) {
    const issues = validateScreen({ id: 'dashboard', title: 'D', shell: 'default', children: [node] }, ctx);
    const hit = issues.find(i => i.severity === 'error' && i.code.startsWith(code));
    assert.ok(hit, name + ' -> ' + JSON.stringify(issues));
    assert.ok(hit!.path.startsWith('screen.children[0]') && hit!.message.length > 8, name);
  }
});

test('a button outside the form may submit it by id (the live model\'s layout)', () => {
  const screen = kapiko.screens.find(s => s.id === 'income-update')!;
  assert.deepEqual(errorsOnly(validateScreen(screen, documentContext(kapiko))), []);
});

test('strict decoding nulls are stripped before validation', () => {
  const decoded = { id: 'welcome', title: 'W', subtitle: null, shell: 'hidden', children: [{ type: 'Card', id: 'c', title: null, tone: null, children: [{ type: 'Text', id: 't', text: 'Hi', tone: null }] }] };
  assert.deepEqual(validateScreen(stripNulls(decoded), documentContext(kapiko)), []);
});

test('bindings resolve with formatters and never execute code', () => {
  const scope = { state: { income: { salary: '21500' } }, record: { customer: 'Mariam', submitted: '2026-11-21' } };
  assert.equal(resolveText('Salary {{state.income.salary | aed}}', scope), 'Salary AED 21,500.00');
  assert.equal(resolveText('{{record.customer}} on {{record.submitted | date}}', scope), 'Mariam on 21 Nov 2026');
  assert.equal(resolveText('{{state.missing}}', scope), '—');
  assert.equal(resolveText('{{constructor.constructor("x")}}', scope), '{{constructor.constructor("x")}}');
});

test('v1 starters migrate to valid v2 documents with routes preserved and losses reported', async () => {
  const v1 = await import('../../../src/demo.ts');
  for (const def of [v1.starter, v1.mobileStarter]) {
    const { document, notes } = migrateV1(def);
    assert.deepEqual(errorsOnly(validateDocument(document)), [], def.id);
    const v1Routes = new Set<string>();
    for (const s of def.screens) for (const e of s.elements as any[]) {
      if (e.nextScreen) v1Routes.add(s.id + '>' + e.nextScreen);
      if (e.detailScreen) v1Routes.add(s.id + '>' + e.detailScreen);
      for (const b of e.buttons || []) if (b.nextScreen) v1Routes.add(s.id + '>' + b.nextScreen);
    }
    const v2Routes = new Set(flowEdges(document).filter(x => !x.via.startsWith('Menu')).map(x => x.from + '>' + x.to));
    for (const r of v1Routes) assert.ok(v2Routes.has(r), def.id + ' lost route ' + r);
    assert.ok(Array.isArray(notes));
  }
});

test('v1 composed controls, navigation and portal sub-pages migrate', () => {
  const v1 = { schemaVersion: 1, id: 'm', name: 'M', description: '', channel: 'mobile', theme: 'teal', screens: [
    { id: 'home', title: 'Home', subtitle: '', elements: [
      { id: 'c1', kind: 'composed', title: 'Apply', items: [{ id: 'name', kind: 'input', label: 'Name', required: true }, { id: 'go', kind: 'button', label: 'Next', nextScreen: 'done' }, { id: 'p', kind: 'progress', label: 'Step', value: 40 }] },
      { id: 'nav', kind: 'navigation', variant: 'footer', title: 'Tabs', links: [{ id: 'h', label: 'Home', screenId: 'home' }, { id: 'd', label: 'Done', screenId: 'done' }, { id: 'x', label: 'Broken' }] }] },
    { id: 'done', title: 'Done', subtitle: '', elements: [{ id: 'n', kind: 'notice', tone: 'success', title: 'OK', body: 'Done' }] }] };
  const { document, notes } = migrateV1(v1);
  assert.deepEqual(errorsOnly(validateDocument(document)), []);
  assert.equal(document.shell.kind, 'tabs');
  assert.equal(document.shell.items.length, 2);
  assert.ok(notes.some(n => n.note.includes('Broken')));
  const button = JSON.stringify(document.screens[0]);
  assert.ok(button.includes('"type":"submit"') && button.includes('"screen":"done"'), 'composed button keeps validation and route');
  const portalV1 = { schemaVersion: 1, id: 'p', name: 'P', description: '', channel: 'portal', theme: 'navy', screens: [
    { id: 'apps', title: 'Apps', subtitle: '', elements: [{ id: 't', kind: 'table', title: 'Apps', columns: [{ id: 'ref', label: 'Ref' }], rows: [{ ref: 'A' }, { ref: 'A' }], detailScreen: 'detail' }] },
    { id: 'detail', title: 'Detail', subtitle: '', parentScreenId: 'apps', elements: [{ id: 'n', kind: 'notice', tone: 'info', title: 'x', body: 'y' }] }] };
  const p = migrateV1(portalV1);
  assert.deepEqual(errorsOnly(validateDocument(p.document)), []);
  assert.equal(p.document.shell.items[0].children?.[0].screen, 'detail');
  assert.ok(p.notes.some(n => n.note.includes('row number')));
});

test('warnings fire for unreachable screens, unwritten state, missing record and loose inputs', () => {
  const d = structuredClone(kapiko);
  d.screens.push({ id: 'orphan', title: 'Orphan', shell: 'hidden', children: [
    { type: 'Text', id: 't', text: 'Hello {{state.nobody.wrote}} {{record.name}}' },
    { type: 'Input', id: 'i', field: 'loose.value', label: 'Loose', inputType: 'text', required: true }] });
  const codes = validateDocument(d).filter(i => i.severity === 'warning' && i.screenId === 'orphan').map(i => i.code).sort();
  assert.deepEqual(codes, ['binding.no-record', 'binding.state-unwritten', 'flow.dead-end', 'flow.unreachable', 'input.outside-form']);
});

test('AI schema puts the discriminator first in every component (strict key order)', () => {
  const schema: any = aiScreenSchema({ channel: 'mobile', screenIds: ['a'], collectionIds: [] });
  const variants = Object.values(schema.$defs as Record<string, any>)[0].anyOf as any[];
  assert.ok(variants.length >= 25);
  for (const v of variants) assert.deepEqual(Object.keys(v.properties).slice(0, 2), ['type', 'id'], JSON.stringify(Object.keys(v.properties)));
  for (const v of variants) if (v.properties.children) assert.equal(Object.keys(v.properties).at(-1), 'children');
});

test('degenerate screens (the live Divider collapse) are errors, so repair/fallback runs', () => {
  const ctx = documentContext(kapiko);
  const dividers = { id: 'x', title: 'X', shell: 'default', children: [...Array.from({ length: 19 }, (_, i) => ({ type: 'Divider', id: 'd' + i })), { type: 'Button', id: 'b', label: 'Go', variant: 'primary', actions: [] }] };
  const codes = validateScreen(dividers, ctx).filter(i => i.severity === 'error').map(i => i.code);
  assert.ok(codes.includes('quality.repetitive'), JSON.stringify(codes));
  const empty = validateScreen({ id: 'x', title: 'X', shell: 'default', children: [] }, ctx);
  assert.ok(empty.some(i => i.code === 'quality.empty' && i.severity === 'error'));
  for (const doc of [kapiko, portal]) for (const s of doc.screens) assert.deepEqual(validateScreen(s, documentContext(doc)).filter(i => i.code.startsWith('quality')), [], s.id);
});

test('record bindings must use fields of the collection whose rows open the screen', () => {
  const d = structuredClone(portal);
  const details = d.screens.find(s => s.id === 'application-details')!;
  (details.children as any[]).push({ type: 'Text', id: 'bad', text: 'Mobile: {{record.mobileNumber}}' });
  const hit = validateDocument(d).find(i => i.code === 'binding.record-field');
  assert.ok(hit && hit.message.includes('mobileNumber') && hit.message.includes('customer'), JSON.stringify(hit));
  assert.deepEqual(validateDocument(portal).filter(i => i.code === 'binding.record-field'), [], 'maker/checker receive fields via passRecord');
});
