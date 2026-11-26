// Framework-free demo runtime: navigation, state, forms, records and the
// declarative action engine. Shared by editor preview, Run mode and the
// published viewer so behaviour is identical everywhere (Decision D1/D5).
import { walk, inputTypes, type Action, type DemoDocument, type NodeT, type Scope } from '@demo/schema';

export type RecordRef = { collection: string; key: string; row: Record<string, string> };
export type Toast = { id: number; message: string; tone: 'info' | 'success' | 'error' };
export type Session = {
  screenId: string;
  history: { screenId: string; record: RecordRef | null }[];
  record: RecordRef | null;
  state: Record<string, unknown>;
  collections: Record<string, Record<string, string>[]>;
  errors: Record<string, string>;       // state key -> message
  busy: string | null;                  // label of a running simulated step
  toasts: Toast[];
  log: string[];                        // human-readable trace for tests and debugging
};

let toastSeq = 0;
export function createSession(doc: DemoDocument, screenId = doc.screens[0]?.id): Session {
  return {
    screenId, history: [], record: null, state: {}, errors: {}, busy: null, toasts: [], log: [],
    collections: Object.fromEntries(doc.collections.map(c => [c.id, structuredClone(c.rows)])),
  };
}
export function getPath(obj: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<any>((v, k) => (v && typeof v === 'object' ? v[k] : undefined), obj);
}
function setPath(obj: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const parts = key.split('.');
  const root = structuredClone(obj);
  let cur: any = root;
  parts.slice(0, -1).forEach(p => { if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {}; cur = cur[p]; });
  cur[parts[parts.length - 1]] = value;
  return root;
}
export function scopeOf(s: Session): Scope { return { state: s.state, record: s.record?.row ?? null, params: {} }; }
export function setField(s: Session, key: string, value: string): Session {
  const errors = { ...s.errors }; delete errors[key];
  return { ...s, state: setPath(s.state, key, value), errors };
}
const screenOf = (doc: DemoDocument, id: string) => doc.screens.find(x => x.id === id);

/** Inputs inside a form (including inside templates), for required checks. */
export function formInputs(doc: DemoDocument, screenId: string, formId: string): NodeT[] {
  const screen = screenOf(doc, screenId);
  if (!screen) return [];
  let found: NodeT | null = null;
  walk(screen.children as NodeT[], '', n => { if (n.type === 'Form' && n.id === formId) found = n; });
  const out: NodeT[] = [];
  if (found) walk([found], '', n => { if (inputTypes.has(n.type)) out.push(n); });
  return out;
}
export function validateForm(doc: DemoDocument, s: Session, formId: string): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const input of formInputs(doc, s.screenId, formId)) {
    const key = String(input.field), v = getPath(s.state, key);
    if (input.type === 'AmountInput' && String(v ?? '').trim()) {
      const n = Number(String(v).replace(/[^0-9.]/g, ''));
      const cap = [input.available, input.max].filter((x): x is number => typeof x === 'number').reduce((a, b) => Math.min(a, b), Infinity);
      if (!Number.isFinite(n) || n <= 0) { errors[key] = 'Enter an amount greater than zero'; continue; }
      if (n > cap) { errors[key] = typeof input.max === 'number' && input.max === cap ? (input.maxLabel ? String(input.maxLabel) : 'The maximum is AED ' + cap.toLocaleString('en-US')) : 'The amount is more than your available balance'; continue; }
    }
    if (!input.required) continue;
    if (input.type === 'Checkbox' ? v !== 'true' : !String(v ?? '').trim()) errors[key] = input.type === 'Checkbox' ? 'Please confirm to continue' : String(input.label) + ' is required';
    else if (input.type === 'Input' && input.inputType === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v))) errors[key] = 'Enter a valid email address';
    else if (input.type === 'Input' && input.inputType === 'otp' && !/^\d{4,8}$/.test(String(v))) errors[key] = 'Enter the numeric code';
  }
  return errors;
}
export function openRecord(doc: DemoDocument, s: Session, collection: string, row: Record<string, string>, screen: string): Session {
  const c = doc.collections.find(x => x.id === collection);
  const record: RecordRef = { collection, key: c ? row[c.key] : '', row: { ...row } };
  return go(s, screen, record);
}
function go(s: Session, screenId: string, record: RecordRef | null): Session {
  return { ...s, history: [...s.history, { screenId: s.screenId, record: s.record }], screenId, record, errors: {}, log: [...s.log, 'navigate ' + screenId] };
}

export type RunContext = { formId?: string; sleep?: (ms: number) => Promise<void>; onUpdate?: (s: Session) => void;
  /** Asks the user; resolves false when they cancel. Without it (headless), confirmations are accepted. */ confirm?: (c: { title: string; message?: string; confirmLabel: string }) => Promise<boolean> };
/**
 * Run a button's actions in order. Stops on a failed submit or a simulated failure.
 * onUpdate receives intermediate states (e.g. the busy indicator during simulate).
 */
export async function runActions(doc: DemoDocument, start: Session, actions: Action[], ctx: RunContext = {}): Promise<Session> {
  let s = start;
  const sleep = ctx.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));
  const emit = (next: Session) => { s = next; ctx.onUpdate?.(s); };
  for (const a of actions) {
    switch (a.type) {
      case 'navigate':
        if (!screenOf(doc, a.screen)) { emit({ ...s, toasts: [...s.toasts, { id: ++toastSeq, message: 'Missing screen "' + a.screen + '"', tone: 'error' }] }); return s; }
        emit(go(s, a.screen, a.passRecord ? s.record : null)); break;
      case 'back': {
        const prev = s.history[s.history.length - 1];
        if (prev) emit({ ...s, screenId: prev.screenId, record: prev.record, history: s.history.slice(0, -1), errors: {}, log: [...s.log, 'back ' + prev.screenId] });
        break;
      }
      case 'submit': {
        const formId = a.form ?? ctx.formId;
        if (!formId) break;
        const errors = a.validate ? validateForm(doc, s, formId) : {};
        if (Object.keys(errors).length) { emit({ ...s, errors: { ...s.errors, ...errors }, log: [...s.log, 'invalid ' + formId + ': ' + Object.keys(errors).join(',')] }); return s; }
        emit({ ...s, log: [...s.log, 'submitted ' + formId] }); break;
      }
      case 'reset': {
        const formId = a.form ?? ctx.formId;
        let state = s.state;
        if (formId) for (const input of formInputs(doc, s.screenId, formId)) state = setPath(state, String(input.field), '');
        emit({ ...s, state, errors: {} }); break;
      }
      case 'setState': emit({ ...s, state: setPath(s.state, a.key, a.value) }); break;
      case 'updateRecord': {
        if (!s.record) { emit({ ...s, log: [...s.log, 'updateRecord skipped: no record'] }); break; }
        const c = doc.collections.find(x => x.id === s.record!.collection);
        const rows = (s.collections[s.record.collection] || []).map(r => (c && r[c.key] === s.record!.key ? { ...r, [a.field]: a.value } : r));
        emit({ ...s, collections: { ...s.collections, [s.record.collection]: rows }, record: { ...s.record, row: { ...s.record.row, [a.field]: a.value } }, log: [...s.log, 'record ' + s.record.key + '.' + a.field + '=' + a.value] });
        break;
      }
      case 'simulate':
        emit({ ...s, busy: a.label });
        await sleep(a.durationMs);
        if (a.outcome === 'failure') { emit({ ...s, busy: null, toasts: [...s.toasts, { id: ++toastSeq, message: a.label + ' failed (simulated)', tone: 'error' }] }); return s; }
        emit({ ...s, busy: null, log: [...s.log, 'simulated ' + a.label] }); break;
      case 'toast': emit({ ...s, toasts: [...s.toasts, { id: ++toastSeq, message: a.message, tone: 'success' }] }); break;
      case 'confirm':
        if (ctx.confirm && !(await ctx.confirm(a))) { emit({ ...s, log: [...s.log, 'cancelled ' + a.title] }); return s; }
        emit({ ...s, log: [...s.log, 'confirmed ' + a.title] }); break;
    }
  }
  return s;
}
export function dismissToast(s: Session, id: number): Session { return { ...s, toasts: s.toasts.filter(t => t.id !== id) }; }
/** Rows for a table/list after search and filter (pure, testable). */
const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
/** Day number (UTC) of a demo date: "2026-11-24", "24 Nov 2026", "24/11/2026" or "Nov 24, 2026"; null when not a date. */
export function dayOf(v: unknown): number | null {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5;
  m = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -,]*(\d{4})/.exec(s); if (m && MONTHS[m[2].toLowerCase()] !== undefined) return Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) / 864e5;
  m = /^([A-Za-z]{3})[A-Za-z]* (\d{1,2}),? (\d{4})/.exec(s); if (m && MONTHS[m[1].toLowerCase()] !== undefined) return Date.UTC(+m[3], MONTHS[m[1].toLowerCase()], +m[2]) / 864e5;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]) / 864e5;
  return null;
}
export type RowFilters = { search?: string; fields?: string[]; equals?: Record<string, string>; date?: { field: string; from?: string; to?: string } };
/** Rows matching a search over `fields`, exact-value filters and an inclusive date range. */
export function filterRows(rows: Record<string, string>[], f: RowFilters) {
  const q = (f.search ?? '').trim().toLowerCase();
  const from = f.date?.from ? dayOf(f.date.from) : null, to = f.date?.to ? dayOf(f.date.to) : null;
  return rows.filter(r => {
    if (q && !(f.fields ?? Object.keys(r)).some(k => String(r[k] ?? '').toLowerCase().includes(q))) return false;
    for (const [k, v] of Object.entries(f.equals ?? {})) if (v && r[k] !== v) return false;
    if (f.date && (from !== null || to !== null)) { const d = dayOf(r[f.date.field]); if (d === null || (from !== null && d < from) || (to !== null && d > to)) return false; }
    return true;
  });
}
export function visibleRows(rows: Record<string, string>[], fields: string[], search: string, filterField?: string, filterValue?: string) {
  return filterRows(rows, { search, fields, equals: filterField && filterValue ? { [filterField]: filterValue } : {} });
}
export function csvFor(rows: Record<string, string>[], columns: { field: string; label: string }[]) {
  const cell = (v: unknown) => { const raw = String(v ?? ''); const safe = /^[\s]*[=+@-]/.test(raw) ? "'" + raw : raw; return '"' + safe.replace(/"/g, '""') + '"'; };
  return '﻿' + [columns.map(c => cell(c.label)).join(','), ...rows.map(r => columns.map(c => cell(r[c.field])).join(','))].join('\r\n');
}
