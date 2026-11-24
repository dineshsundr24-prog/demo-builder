import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateScreen, documentContext, type Screen } from '@demo/schema';
import { normalizeDesign, coverageIssues, screenText } from '../src/design.ts';

const kapiko = JSON.parse(readFileSync(new URL('../../schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));

test('IDIDI dashboard mistakes are cleaned deterministically', () => {
  // The exact structures gpt-4.1-mini produced in UAT job 8ac2784f.
  const screen: Screen = { id: 'dashboard', title: 'Dashboard', shell: 'default', children: [
    { type: 'Grid', id: 'g', columns: '2', gap: 'md', children: [
      { type: 'Card', id: 'bal', title: 'Available Balance', tone: 'brand', children: [{ type: 'Stat', id: 's1', label: 'AED', value: '35,600.75 AED' }] },
      { type: 'Card', id: 'sal', title: 'Current Salary', tone: 'default', children: [{ type: 'Stat', id: 's2', label: 'Monthly', value: '25,000 AED' }] }] },
    { type: 'Stack', id: 'row', direction: 'horizontal', gap: 'sm', children: [
      { type: 'Button', id: 'b1', label: 'Update Income', variant: 'primary', actions: [{ type: 'navigate', screen: 'income' }] },
      { type: 'Button', id: 'b2', label: 'Profile & Settings', variant: 'secondary', actions: [{ type: 'navigate', screen: 'profile' }] }] },
    { type: 'Button', id: 'self', label: 'Refresh', variant: 'link', actions: [{ type: 'navigate', screen: 'dashboard' }] },
  ] } as any;
  const { screen: out, changes } = normalizeDesign(screen);
  const grid = (out.children as any[])[0];
  assert.equal(grid.children[0].type, 'BalanceCard');
  assert.equal(grid.children[0].amount, '35,600.75 AED');
  assert.equal(grid.children[0].caption, undefined, 'currency-only label is not repeated');
  assert.deepEqual({ type: grid.children[1].type, label: grid.children[1].label, delta: grid.children[1].delta }, { type: 'Stat', label: 'Current Salary', delta: 'Monthly' });
  const bar = (out.children as any[])[1];
  assert.equal(bar.type, 'ActionBar'); assert.equal(bar.primary.label, 'Update Income'); assert.equal(bar.secondary.label, 'Profile & Settings');
  assert.equal((out.children as any[])[2].actions[0].type, 'toast');
  assert.ok(changes.length >= 4);
});

test('duplicate logos are removed (Welcome showed two)', () => {
  const screen = { id: 'w', title: 'W', shell: 'hidden', children: [
    { type: 'Image', id: 'l1', kind: 'logo', alt: 'Logo' }, { type: 'Heading', id: 'h', text: 'Welcome', level: '1' },
    { type: 'Template', id: 't', template: 'uaepass-login' }, { type: 'Image', id: 'l2', kind: 'logo', alt: 'Logo again' }] } as any;
  const out = normalizeDesign(screen).screen.children as any[];
  assert.equal(out.filter(n => n.type === 'Image').length, 1);
});

test('coverage: missing requirement items are reported; present ones pass, including template content', () => {
  const income = kapiko.screens.find((s: any) => s.id === 'income-update');
  assert.deepEqual(coverageIssues(income, ['new monthly salary', 'allowances', 'employment status', 'effective date', 'salary certificate']), []);
  const missing = coverageIssues(income, ['employer contact number', 'allowances']);
  assert.equal(missing.length, 1); assert.ok(missing[0].message.includes('employer contact number') && !missing[0].message.includes('allowances'));
  const signIn = { id: 's', title: 'Sign in', shell: 'hidden', children: [{ type: 'Template', id: 't', template: 'sign-in', next: 'x' }] } as any;
  assert.ok(screenText(signIn).includes('password'));
  assert.deepEqual(coverageIssues(signIn, ['email or mobile', 'password', 'forgot password']), []);
});

test('actions inside designed patterns are validated (routes and forms)', () => {
  const ctx = documentContext(kapiko);
  const bad = { id: 'dashboard', title: 'D', shell: 'default', children: [
    { type: 'QuickActions', id: 'q', items: [{ label: 'Go', icon: 'send', actions: [{ type: 'navigate', screen: 'nowhere' }] }, { label: 'Ok', icon: 'home', actions: [] }] },
    { type: 'ActionBar', id: 'a', primary: { label: 'Save', actions: [{ type: 'submit', validate: true }] } }] };
  const codes = validateScreen(bad, ctx).filter(i => i.severity === 'error').map(i => i.code);
  assert.ok(codes.includes('route.unknown') && codes.includes('form.missing'), JSON.stringify(codes));
});

test('unknown binding formatters are dropped and single-brace bindings fixed (benchmark fallbacks)', () => {
  const s = { id: 'x', title: 'X', shell: 'default', children: [
    { type: 'Text', id: 't1', text: 'Decision: {{state.leave.decision | lower}} / {{state.leave.decision | shout}}' },
    { type: 'RecordFields', id: 'r', items: [{ label: 'Name', value: '{record.name}' }] }] } as any;
  const out = normalizeDesign(s).screen.children as any[];
  assert.equal(out[0].text, 'Decision: {{state.leave.decision | lower}} / {{state.leave.decision}}');
  assert.equal(out[1].items[0].value, '{{record.name}}');
});
