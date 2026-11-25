import test from 'node:test';
import assert from 'node:assert/strict';
import { validateForm, createSession } from '../src/engine.ts';
import type { DemoDocument } from '@demo/schema';

const doc = { schemaVersion: 2, id: 'd', name: 'D', channel: 'mobile', theme: { primary: '#123456', secondary: '#123456', accent: '#123456', radius: 'lg', font: 'inter' },
  shell: { kind: 'none', brand: 'D', showBack: true, items: [] }, collections: [],
  screens: [{ id: 's', title: 'S', shell: 'default', children: [{ type: 'Form', id: 'f', children: [{ type: 'AmountInput', id: 'a', field: 't.amount', label: 'Amount', required: true, available: 1000, max: 800, maxLabel: 'Daily limit AED 800' }] }] }] } as unknown as DemoDocument;
const withAmount = (v: string) => ({ ...createSession(doc, 's'), state: { t: { amount: v } } });

test('amount fields enforce the available balance and the limit', () => {
  assert.deepEqual(validateForm(doc, withAmount('500'), 'f'), {});
  assert.equal(validateForm(doc, withAmount('900'), 'f')['t.amount'], 'Daily limit AED 800');
  assert.equal(validateForm(doc, withAmount('0'), 'f')['t.amount'], 'Enter an amount greater than zero');
  assert.equal(validateForm(doc, withAmount(''), 'f')['t.amount'], 'Amount is required');
});
