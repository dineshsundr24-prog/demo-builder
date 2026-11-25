import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveText, validateDocument, errorsOnly, type NodeT } from '@demo/schema';
import { assemble, type Plan } from '../src/index.ts';

const plan = (screens: { id: string; title: string; children: NodeT[] }[]): Plan => ({
  appName: 'Falcon', brandName: 'Falcon', channel: 'mobile', theme: { primary: '#123456', secondary: '#345678', accent: '#567890' },
  shell: { kind: 'none', brand: 'Falcon', showBack: true, items: [] },
  collections: [{ id: 'apps', label: 'Applications', key: 'ref', fields: [{ id: 'ref', label: 'Ref' }, { id: 'name', label: 'Name' }], rows: [{ ref: 'A-1', name: 'Sara Al Mansoori' }] }],
  screens: screens.map((s, i) => ({ id: s.id, title: s.title, requirement: '', purpose: '', template: null, links: screens[i + 1] ? [screens[i + 1].id] : [], shell: 'default', locked: true })),
  sampleFacts: [], templates: [], globalContext: '', notes: [],
});
const build = (screens: { id: string; title: string; children: NodeT[] }[]) => assemble(plan(screens), screens.map(s => ({ ...s, shell: 'default' as const })));

test('bindings show fallback text until the customer enters a value', () => {
  assert.equal(resolveText('{{state.loan.employer ?? GulfTech Solutions}}', { state: {} }), 'GulfTech Solutions');
  assert.equal(resolveText('{{state.loan.employer ?? GulfTech Solutions}}', { state: { loan: { employer: 'Emaar' } } }), 'Emaar');
  assert.equal(resolveText('{{state.loan.salary | aed ?? AED 12,000}}', { state: { loan: { salary: '15000' } } }), 'AED 15,000.00');
});

test('review rows link to the inputs and the loan calculator of earlier screens', () => {
  const { document, fixes } = build([
    { id: 'offer', title: 'Offer', children: [{ type: 'EmiCalculator', id: 'calc', title: 'Calc', minAmount: 10000, maxAmount: 500000, defaultAmount: 100000, tenures: [12, 24], ratePercent: 6, stateKey: 'offer.calc' } as NodeT] },
    { id: 'apply', title: 'Apply', children: [{ type: 'Form', id: 'f', children: [{ type: 'Input', id: 'sal', field: 'apply.monthlySalary', label: 'Monthly salary (AED)', inputType: 'currency', required: true }, { type: 'Button', id: 'b', label: 'Next', variant: 'primary', actions: [{ type: 'submit', validate: true }, { type: 'navigate', screen: 'review-application' }] }] } as NodeT] },
    { id: 'review-application', title: 'Review application', children: [{ type: 'RecordFields', id: 'r', items: [{ label: 'Monthly salary', value: 'AED 12,000' }, { label: 'Calculated instalment', value: 'AED 2,500 per month' }, { label: 'Branch', value: 'Dubai Mall' }] } as NodeT] },
  ]);
  const items = (document.screens[2].children[0] as any).items;
  assert.equal(items[0].value, '{{state.apply.monthlySalary | aed ?? AED 12,000}}');
  assert.equal(items[1].value, '{{state.offer.calc.emi ?? AED 2,500 per month}}');
  assert.equal(items[2].value, 'Dubai Mall', 'unmatched rows keep their text');
  assert.ok(fixes.some(f => f.startsWith('Linked 2 review')));
  assert.deepEqual(errorsOnly(validateDocument(document)), []);
});

test('record values on a screen opened without a record show the first sample record', () => {
  const { document } = build([{ id: 'kyc', title: 'KYC review', children: [{ type: 'RecordFields', id: 'r', items: [{ label: 'Customer', value: '{{record.name}}' }] } as NodeT] }]);
  assert.equal((document.screens[0].children[0] as any).items[0].value, 'Sara Al Mansoori');
});

test('full card numbers are never shown', () => {
  const { document } = build([{ id: 'cards', title: 'Cards', children: [{ type: 'RecordFields', id: 'r', items: [{ label: 'Card number', value: '1234 5678 9012 3456' }] } as NodeT] }]);
  assert.equal((document.screens[0].children[0] as any).items[0].value, '•••• •••• •••• 3456');
  const iban = build([{ id: 'acc', title: 'Account', children: [{ type: 'RecordFields', id: 'r', items: [{ label: 'IBAN', value: 'AE07 0331 2345 6789 0123 456' }] } as NodeT] }]);
  assert.equal((iban.document.screens[0].children[0] as any).items[0].value, 'AE07 0331 2345 6789 0123 456', 'IBANs stay visible');
});

test('transfer review rows link to the beneficiary picker and the amount', () => {
  const { document } = build([
    { id: 'transfer', title: 'Transfer', children: [{ type: 'Form', id: 'f', children: [
      { type: 'BeneficiaryPicker', id: 'b', field: 'transfer.beneficiary', label: 'Pay to', required: true, beneficiaries: [{ name: 'Sara Al Mansoori', detail: 'ENBD · AE07 •••• 3456' }] },
      { type: 'AmountInput', id: 'a', field: 'transfer.amount', label: 'Amount', required: true, available: 1000 },
      { type: 'Button', id: 'go', label: 'Review', variant: 'primary', actions: [{ type: 'submit', validate: true }, { type: 'navigate', screen: 'review-transfer' }] }] } as NodeT] },
    { id: 'review-transfer', title: 'Review transfer', children: [{ type: 'RecordFields', id: 'r', items: [{ label: 'Beneficiary', value: 'Sara Al Mansoori' }, { label: 'Transfer amount', value: 'AED 2,500.00' }] } as NodeT] },
  ]);
  const items = (document.screens[1].children[0] as any).items;
  assert.equal(items[0].value, '{{state.transfer.beneficiary ?? Sara Al Mansoori}}');
  assert.equal(items[1].value, '{{state.transfer.amount | aed ?? AED 2,500.00}}');
});
