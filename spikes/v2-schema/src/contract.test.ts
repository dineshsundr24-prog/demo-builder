import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aiScreenSchema, lintStrict, stripNulls } from './aiSchema.ts';
import { validateDocument, validateScreen, contextFor } from './validate.ts';

const templates = ['uaepass-login', 'uaepass-ekyc', 'face-verification', 'otp-entry', 'document-upload'];
const kapiko = JSON.parse(readFileSync(new URL('../fixtures/kapiko.synthetic.json', import.meta.url), 'utf8'));
const ctx = { screenIds: kapiko.screens.map((s: any) => s.id), collectionIds: ['service-requests'], templateIds: templates };

test('Kapiko 12-screen synthetic document passes the single validator with no errors', () => {
  const issues = validateDocument(kapiko, templates);
  assert.equal(kapiko.screens.length, 12);
  assert.deepEqual(issues.filter(i => i.severity === 'error'), []);
});

test('flow lint reports unreachable screens as warnings, not failures', () => {
  const d = structuredClone(kapiko);
  d.screens.push({ id: 'orphan', title: 'Orphan', shell: 'hidden', children: [{ type: 'Text', id: 't', text: 'x' }] });
  const issues = validateDocument(d, templates);
  assert.ok(issues.some(i => i.code === 'flow.unreachable' && i.severity === 'warning'));
});

test('no fixed screen limit: a 40-screen document validates', () => {
  const d = structuredClone(kapiko);
  for (let i = 0; i < 28; i++) d.screens.push({ id: 'extra-' + i, title: 'Extra ' + i, shell: 'default', children: [{ type: 'Text', id: 't', text: 'x' }] });
  assert.equal(d.screens.length, 40);
  assert.deepEqual(validateDocument(d, templates).filter(i => i.severity === 'error'), []);
});

test('strict AI schema passes strict-mode lint (recursive and depth-unrolled variants)', () => {
  for (const variant of [aiScreenSchema(ctx), aiScreenSchema(ctx, { maxDepth: 3 })]) {
    const lint = lintStrict(variant);
    assert.deepEqual(lint.problems, []);
  }
});

test('AI schema pins the screen id and enumerates real destinations', () => {
  const schema = aiScreenSchema({ ...ctx, screenId: 'dashboard' });
  assert.deepEqual(schema.properties.id.enum, ['dashboard']);
  const text = JSON.stringify(schema);
  assert.ok(text.includes('"enum":["welcome","sign-in"'), 'navigate.screen is an enum of plan ids');
  assert.ok(!text.includes('"ref"'));
});

test('every v1 failure shape is rejected with an exact path and reason (no boolean errors)', () => {
  const c = contextFor(kapiko, templates);
  const cases: [string, any][] = [
    ['unknown kind', { type: 'Carousel', id: 'x' }],
    ['notice tone not allowed', { type: 'Notice', id: 'x', tone: 'danger', title: 't' }],
    ['button navigate to unknown screen', { type: 'Button', id: 'x', label: 'Go', variant: 'primary', actions: [{ type: 'navigate', screen: 'screen-b' }] }],
    ['navigate with wrong key', { type: 'Button', id: 'x', label: 'Go', variant: 'primary', actions: [{ type: 'navigate', screenId: 'dashboard' }] }],
    ['table column not in collection', { type: 'Table', id: 'x', collection: 'service-requests', searchable: false, columns: [{ field: 'amount', label: 'Amount' }] }],
    ['select options as objects', { type: 'Select', id: 'x', field: 'a', label: 'A', required: true, options: [{ value: 'a' }] }],
  ];
  for (const [name, node] of cases) {
    const issues = validateScreen({ id: 'dashboard', title: 'D', shell: 'default', children: [node] }, c);
    assert.ok(issues.some(i => i.severity === 'error'), name + ' must be rejected');
    assert.ok(issues.every(i => i.path.startsWith('screen.children[0]') && i.message.length > 5), name + ' must carry an exact path: ' + JSON.stringify(issues));
  }
});

test('strict decoding nulls are stripped before validation', () => {
  const decoded = { id: 'welcome', title: 'W', subtitle: null, shell: 'hidden', children: [{ type: 'Card', id: 'c', title: null, tone: null, children: [{ type: 'Text', id: 't', text: 'Hi', tone: null }] }] };
  assert.deepEqual(validateScreen(stripNulls(decoded), contextFor(kapiko, templates)), []);
});
