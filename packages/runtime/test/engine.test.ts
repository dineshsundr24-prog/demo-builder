import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DemoDocument, Action } from '@demo/schema';
import { expandTemplate } from '@demo/schema';
import { createSession, runActions, setField, openRecord, visibleRows, csvFor } from '../src/engine.ts';

const load = (f: string): DemoDocument => JSON.parse(readFileSync(new URL('../../schema/fixtures/' + f, import.meta.url), 'utf8'));
const kapiko = load('kapiko-mobile.json'), portal = load('staff-portal.json');
const fast = { sleep: async () => {} };
const buttonActions = (doc: DemoDocument, screen: string, id: string): Action[] => {
  const find = (nodes: any[]): any => { for (const n of nodes) { if (n.id === id) return n; const r = find([...(n.children || []), ...(n.type === 'Template' ? expandTemplate(n) : [])]); if (r) return r; } };
  const b = find(doc.screens.find(s => s.id === screen)!.children);
  assert.ok(b, 'button ' + id + ' on ' + screen); return b.actions;
};

test('required fields block navigation and report per-field errors', async () => {
  let s = createSession(kapiko, 'sign-up');
  s = await runActions(kapiko, s, buttonActions(kapiko, 'sign-up', 'register-submit'), { ...fast, formId: 'register' });
  assert.equal(s.screenId, 'sign-up');
  assert.deepEqual(Object.keys(s.errors).sort(), ['customer.email', 'customer.mobile', 'customer.name', 'customer.password', 'customer.terms']);
});

test('journey A: sign up -> OTP -> eKYC -> face -> dashboard with entered data carried forward', async () => {
  let s = createSession(kapiko, 'sign-up');
  for (const [k, v] of [['customer.name', 'Ahmed'], ['customer.mobile', '+971 50 123 4567'], ['customer.email', 'ahmed@example.com'], ['customer.password', 'x'], ['customer.terms', 'true']]) s = setField(s, k, v);
  s = await runActions(kapiko, s, buttonActions(kapiko, 'sign-up', 'register-submit'), { ...fast, formId: 'register' });
  assert.equal(s.screenId, 'mobile-otp-verification');
  s = await runActions(kapiko, s, buttonActions(kapiko, 'mobile-otp-verification', 'otp-verify'), { ...fast, formId: 'otp-form' });
  assert.equal(s.screenId, 'mobile-otp-verification', 'empty OTP is rejected');
  s = setField(s, 'otp.code', '123456');
  s = await runActions(kapiko, s, buttonActions(kapiko, 'mobile-otp-verification', 'otp-verify'), { ...fast, formId: 'otp-form' });
  assert.equal(s.screenId, 'ekyc-using-uae-pass');
  s = setField(s, 'ekyc.consent', 'true');
  s = await runActions(kapiko, s, buttonActions(kapiko, 'ekyc-using-uae-pass', 'ekyc-confirm'), { ...fast, formId: 'ekyc-form' });
  assert.equal(s.screenId, 'face-verification');
  s = await runActions(kapiko, s, buttonActions(kapiko, 'face-verification', 'face-start'), fast);
  assert.equal(s.screenId, 'dashboard');
  assert.ok(s.log.some(l => l.startsWith('simulated Checking liveness')));
  assert.equal((s.state as any).customer.mobile, '+971 50 123 4567');
});

test('income journey: a button outside the form submits it by id; values reach the review', async () => {
  let s = createSession(kapiko, 'income-update');
  s = await runActions(kapiko, s, buttonActions(kapiko, 'income-update', 'continue'), fast);
  assert.equal(s.screenId, 'income-update');
  assert.ok(s.errors['income.salary']);
  for (const [k, v] of [['income.salary', '21500'], ['income.employment', 'Employed'], ['income.effective', '2026-12-01'], ['income.document', 'salary.pdf']]) s = setField(s, k, v);
  s = await runActions(kapiko, s, buttonActions(kapiko, 'income-update', 'continue'), fast);
  assert.equal(s.screenId, 'income-verification-review');
  assert.equal((s.state as any).income.salary, '21500');
});

test('portal: two different rows open the same details screen with their own record', () => {
  const rows = portal.collections[0].rows;
  const a = openRecord(portal, createSession(portal, 'applications'), 'applications', rows[0], 'application-details');
  const b = openRecord(portal, createSession(portal, 'applications'), 'applications', rows[1], 'application-details');
  assert.equal(a.screenId, 'application-details'); assert.equal(b.screenId, 'application-details');
  assert.equal(a.record!.row.customer, 'Ahmed Al Hammadi');
  assert.equal(b.record!.row.customer, 'Mariam Al Suwaidi');
});

test('portal maker -> checker updates the selected record status in the shared collection', async () => {
  const row = portal.collections[0].rows[1];
  let s = openRecord(portal, createSession(portal, 'applications'), 'applications', row, 'application-details');
  s = await runActions(portal, s, buttonActions(portal, 'application-details', 'to-maker'), fast);
  assert.equal(s.screenId, 'maker-review'); assert.equal(s.record!.key, 'APP-20482');
  s = setField(s, 'review.makerDecision', 'Recommend approval'); s = setField(s, 'review.makerComment', 'Income verified');
  s = await runActions(portal, s, buttonActions(portal, 'maker-review', 'maker-submit'), { ...fast, formId: 'maker-form' });
  assert.equal(s.screenId, 'applications');
  assert.equal(s.collections.applications.find(r => r.ref === 'APP-20482')!.status, 'Pending checker');
  s = openRecord(portal, s, 'applications', s.collections.applications.find(r => r.ref === 'APP-20482')!, 'application-details');
  s = await runActions(portal, s, buttonActions(portal, 'application-details', 'to-checker'), fast);
  s = await runActions(portal, s, buttonActions(portal, 'checker-approval', 'checker-approve'), fast);
  assert.equal(s.screenId, 'completed');
  assert.equal(s.collections.applications.find(r => r.ref === 'APP-20482')!.status, 'Approved');
  assert.equal(s.collections.applications.find(r => r.ref === 'APP-20481')!.status, 'Pending maker', 'other rows untouched');
});

test('back restores the previous screen and its record; simulated failure stops the chain', async () => {
  let s = openRecord(portal, createSession(portal, 'applications'), 'applications', portal.collections[0].rows[0], 'application-details');
  s = await runActions(portal, s, [{ type: 'navigate', screen: 'reports' }], fast);
  assert.equal(s.record, null);
  s = await runActions(portal, s, [{ type: 'back' }], fast);
  assert.equal(s.screenId, 'application-details'); assert.equal(s.record!.key, 'APP-20481');
  s = await runActions(portal, s, [{ type: 'simulate', label: 'Core banking', durationMs: 0, outcome: 'failure' }, { type: 'navigate', screen: 'reports' }], fast);
  assert.equal(s.screenId, 'application-details');
  assert.ok(s.toasts.some(t => t.tone === 'error' && t.message.includes('simulated')));
});

test('search/filter and CSV export are safe', () => {
  const rows = portal.collections[0].rows;
  assert.equal(visibleRows(rows, ['customer'], 'mariam').length, 1);
  assert.equal(visibleRows(rows, ['customer'], '', 'status', 'Pending maker').length, 2);
  const csv = csvFor([{ a: '=SUM(1)' }], [{ field: 'a', label: 'A' }]);
  assert.ok(csv.includes(`"'=SUM(1)"`));
});

test('a confirm step asks first: Cancel stops the chain, Confirm continues; card status follows the freeze state', async () => {
  const actions: Action[] = [{ type: 'confirm', title: 'Freeze this card?', confirmLabel: 'Freeze card' }, { type: 'setState', key: 'cards.freeze', value: 'true' }, { type: 'toast', message: 'Card frozen' }];
  const asked: string[] = [];
  const no = await runActions(kapiko, createSession(kapiko), actions, { ...fast, confirm: async c => { asked.push(c.title); return false; } });
  assert.equal((no.state as any).cards?.freeze, undefined, 'cancelled: nothing changed');
  assert.equal(no.toasts.length, 0);
  const yes = await runActions(kapiko, createSession(kapiko), actions, { ...fast, confirm: async () => true });
  assert.equal((yes.state as any).cards.freeze, 'true');
  assert.deepEqual(asked, ['Freeze this card?']);
  const { resolveText } = await import('@demo/schema');
  assert.equal(resolveText('{{state.cards.freeze | frozen ?? Active}}', { state: yes.state, record: null, params: {} } as any), 'Frozen');
  assert.equal(resolveText('{{state.cards.freeze | frozen ?? Active}}', { state: {}, record: null, params: {} } as any), 'Active');
});
