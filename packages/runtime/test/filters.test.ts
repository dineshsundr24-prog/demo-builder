import test from 'node:test';
import assert from 'node:assert/strict';
import { dayOf, filterRows } from '../src/engine.ts';

test('demo dates in common formats are understood', () => {
  const d = dayOf('2026-11-24');
  assert.equal(dayOf('24 Nov 2026'), d);
  assert.equal(dayOf('24/11/2026'), d);
  assert.equal(dayOf('Nov 24, 2026'), d);
  assert.equal(dayOf('24 November 2026'), d);
  assert.equal(dayOf('In review'), null);
});

test('search, value filters and an inclusive date range combine', () => {
  const rows = [
    { ref: 'A1', status: 'Pending', date: '2026-11-01' }, { ref: 'A2', status: 'Approved', date: '15 Nov 2026' },
    { ref: 'A3', status: 'Pending', date: '2026-11-30' }, { ref: 'B4', status: 'Pending', date: 'unknown' }];
  assert.deepEqual(filterRows(rows, { date: { field: 'date', from: '2026-11-01', to: '2026-11-15' } }).map(r => r.ref), ['A1', 'A2']);
  assert.deepEqual(filterRows(rows, { equals: { status: 'Pending' }, date: { field: 'date', from: '2026-11-10' } }).map(r => r.ref), ['A3']);
  assert.deepEqual(filterRows(rows, { search: 'a', fields: ['ref'] }).map(r => r.ref), ['A1', 'A2', 'A3']);
  assert.equal(filterRows(rows, { date: { field: 'date' } }).length, 4, 'no range: nothing filtered');
});
