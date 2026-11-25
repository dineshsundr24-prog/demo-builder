import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDocument, errorsOnly, flowEdges, type DemoDocument } from '@demo/schema';
import { applyFlowOps, FakeProvider, Generator, MemoryStore, defaultConfig, type CompletionRequest } from '../src/index.ts';

const mobile: DemoDocument = JSON.parse(readFileSync(new URL('../../schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const portal: DemoDocument = JSON.parse(readFileSync(new URL('../../schema/fixtures/staff-portal.json', import.meta.url), 'utf8'));
const menu = (d: DemoDocument) => d.shell.items.map(i => i.label);

test('menu: add, rename, change icon and target, reorder, remove (mobile)', () => {
  let { doc, problems } = applyFlowOps(mobile, [{ op: 'menuAdd', screen: 'income-update', label: 'Income', icon: 'banknote', after: null }]);
  assert.deepEqual(problems, []);
  assert.ok(menu(doc).includes('Income'));
  ({ doc, problems } = applyFlowOps(doc, [{ op: 'menuUpdate', screen: 'income-update', label: 'Salary', icon: 'wallet', newScreen: null }, { op: 'menuOrder', screens: ['income-update'] }]));
  assert.deepEqual(problems, []);
  assert.equal(menu(doc)[0], 'Salary');
  assert.equal(doc.shell.items[0].icon, 'wallet');
  ({ doc, problems } = applyFlowOps(doc, [{ op: 'menuRemove', screen: 'income-update' }]));
  assert.ok(!menu(doc).includes('Salary'));
  assert.deepEqual(errorsOnly(validateDocument(doc)), []);
});

test('mobile menus are limited to 5 items; portals allow 10', () => {
  const full = { ...mobile, shell: { ...mobile.shell, items: mobile.screens.slice(0, 5).map((s, i) => ({ id: 'm' + i, label: 'M' + i, icon: 'home', screen: s.id })) } };
  const r = applyFlowOps(full, [{ op: 'menuAdd', screen: mobile.screens[6].id, label: 'More', icon: 'list', after: null }]);
  assert.match(r.problems[0], /maximum on mobile/);
  const p = applyFlowOps(portal, [{ op: 'menuAdd', screen: portal.screens.find(s => !portal.shell.items.some(i => i.screen === s.id))!.id, label: 'Extra', icon: 'list', after: null }]);
  assert.deepEqual(p.problems, []);
});

test('screens: delete removes links and menu items; move and rename; hide the menu on a step', () => {
  const target = mobile.shell.items[0].screen;
  const { doc, problems, changes } = applyFlowOps(mobile, [
    { op: 'screenDelete', screen: 'income-update' },
    { op: 'screenMove', screen: 'customer-profile', after: 'dashboard' },
    { op: 'screenRename', screen: 'dashboard', title: 'Home' },
    { op: 'screenMenu', screen: target, show: false }]);
  assert.deepEqual(problems, []);
  assert.ok(!doc.screens.some(s => s.id === 'income-update'));
  assert.ok(!flowEdges(doc).some(e => e.to === 'income-update'), 'no links to the deleted screen');
  const ids = doc.screens.map(s => s.id);
  assert.equal(ids[ids.indexOf('dashboard') + 1], 'customer-profile');
  assert.equal(doc.screens.find(s => s.id === 'dashboard')!.title, 'Home');
  assert.equal(doc.screens.find(s => s.id === target)!.shell, 'hidden');
  assert.equal(changes.length, 4);
  assert.deepEqual(errorsOnly(validateDocument(doc)), []);
});

test('impossible operations are reported, never applied silently', () => {
  const r = applyFlowOps(portal, [{ op: 'menuStyle', kind: 'tabs' }, { op: 'menuRemove', screen: 'not-in-menu-xyz' }]);
  assert.equal(r.problems.length, 2);
  assert.equal(r.doc, portal);
  const one = { ...mobile, screens: [mobile.screens[0]], shell: { ...mobile.shell, items: [] } };
  assert.match(applyFlowOps(one, [{ op: 'screenDelete', screen: mobile.screens[0].id }]).problems[0], /at least one screen/);
});

test('the assistant routes structure requests and returns the change list (portal)', async () => {
  const p = new FakeProvider((req: CompletionRequest) => req.schemaName === 'route' ? { intent: 'change_flow', screen: null }
    : { reply: 'Removed Reports from the sidebar.', operations: [{ op: 'menuRemove', screen: portal.shell.items.at(-1)!.screen }] });
  const out = await new Generator(new MemoryStore(), p, defaultConfig).assist(portal, { instruction: 'Remove Reports from the sidebar', currentScreen: portal.screens[0].id });
  assert.equal(out.action, 'flow');
  assert.equal(out.document.shell.items.length, portal.shell.items.length - 1);
  assert.match(out.changes[0], /^Menu: removed/);
  assert.equal(out.reply, 'Removed Reports from the sidebar.');
});
