import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { insertNode, moveNode, removeNode, duplicateNode, updateNode, renameNode, nudgeNode, findNode, addScreen, removeScreen, duplicateScreen, moveScreen, updateScreen, validateDocument, errorsOnly, type DemoDocument, type NodeT } from '../src/index.ts';

const kapiko: DemoDocument = JSON.parse(readFileSync(new URL('../fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const ok = (d: DemoDocument) => assert.deepEqual(errorsOnly(validateDocument(d)), []);
const s0 = kapiko.screens.find(s => s.id === 'income-update')!;
const firstForm = (d: DemoDocument) => { let f: NodeT | undefined; const w = (ns: NodeT[]) => ns.forEach(n => { if (!f && n.type === 'Form') f = n; if (n.children) w(n.children as NodeT[]); }); w(d.screens.find(s => s.id === s0.id)!.children as NodeT[]); return f!; };

test('insert, update, duplicate, move, remove keep the document valid and the input untouched', () => {
  const before = JSON.stringify(kapiko);
  let { doc, id } = insertNode(kapiko, s0.id, null, 0, 'Notice');
  assert.equal((doc.screens.find(s => s.id === s0.id)!.children[0] as NodeT).id, id);
  doc = updateNode(doc, s0.id, id, { title: 'Edited', tone: 'warning' });
  assert.equal(findNode(doc.screens.find(s => s.id === s0.id)!.children as NodeT[], id)!.node.title, 'Edited');
  const dup = duplicateNode(doc, s0.id, id); doc = dup.doc;
  assert.notEqual(dup.id, id);
  const form = firstForm(doc);
  doc = moveNode(doc, s0.id, dup.id, form.id, 0);
  assert.equal(findNode(doc.screens.find(s => s.id === s0.id)!.children as NodeT[], dup.id)!.parentId, form.id);
  doc = removeNode(doc, s0.id, id);
  assert.equal(findNode(doc.screens.find(s => s.id === s0.id)!.children as NodeT[], id), null);
  ok(doc);
  assert.equal(JSON.stringify(kapiko), before, 'input is never mutated');
});

test('ids stay unique: duplicating a container re-ids its whole subtree', () => {
  const form = firstForm(kapiko);
  const { doc } = duplicateNode(kapiko, s0.id, form.id);
  ok(doc);
});

test('illegal moves are refused: into itself, into a non-container, form inside form', () => {
  const form = firstForm(kapiko);
  const child = (form.children as NodeT[])[0];
  assert.throws(() => moveNode(kapiko, s0.id, form.id, child.id, 0));
  assert.throws(() => moveNode(kapiko, s0.id, form.id, form.id, 0));
  assert.throws(() => insertNode(kapiko, s0.id, form.id, 0, 'Form'));
});

test('nudge moves among siblings and is a no-op at the edges', () => {
  const ids = (d: DemoDocument) => (d.screens.find(s => s.id === s0.id)!.children as NodeT[]).map(n => n.id);
  const first = ids(kapiko)[0];
  assert.deepEqual(ids(nudgeNode(kapiko, s0.id, first, -1)), ids(kapiko));
  assert.equal(ids(nudgeNode(kapiko, s0.id, first, 1))[1], first);
});

test('rename follows submit actions that name the form', () => {
  const form = firstForm(kapiko);
  const withRef = updateNode(kapiko, s0.id, form.id, {});
  const doc = renameNode(withRef, s0.id, form.id, 'my-form');
  assert.ok(findNode(doc.screens.find(s => s.id === s0.id)!.children as NodeT[], 'my-form'));
  ok(doc);
});

test('screens: add, rename, duplicate, reorder, delete removes links to it', () => {
  let { doc, id } = addScreen(kapiko, 'Card Services', 'dashboard');
  assert.equal(doc.screens[doc.screens.findIndex(s => s.id === 'dashboard') + 1].id, id);
  doc = updateScreen(doc, id, { title: 'Cards', shell: 'hidden' });
  const dup = duplicateScreen(doc, 'income-update'); doc = dup.doc;
  doc = moveScreen(doc, dup.id, -1);
  doc = removeScreen(doc, 'income-update');
  assert.ok(!doc.screens.some(s => s.id === 'income-update'));
  assert.ok(!JSON.stringify(doc).includes('"screen":"income-update"'));
  assert.deepEqual(errorsOnly(validateDocument(doc)).filter(i => i.code.startsWith('ref.')), []);
});
