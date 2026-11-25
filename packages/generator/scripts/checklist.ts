// UX checklist over benchmark output: node scripts/checklist.ts <benchmarkDir> [report.md]
// Every check is objective and automated, so runs can be compared before/after a change.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { validateDocument, flowLint, type DemoDocument, type NodeT, type Screen } from '@demo/schema';
import { uxIssues } from '../src/index.ts';
import { coverageIssues } from '../src/design.ts';

const [dir, out] = process.argv.slice(2);
const walk = (ns: NodeT[], f: (n: NodeT) => void) => ns.forEach(n => { f(n); if (Array.isArray(n.children)) walk(n.children as NodeT[], f); });
const has = (s: Screen, pred: (n: NodeT) => boolean) => { let r = false; walk(s.children as NodeT[], n => { if (pred(n)) r = true; }); return r; };
const LONG_LABEL = (n: NodeT) => (n.type === 'Button' && String(n.label).length > 28) || (n.type === 'ActionBar' && String((n as any).primary?.label ?? '').length > 28);
const GENERIC_BRAND = /\b(digital|banking|app|portal)\b/i;

type Check = { id: string; label: string; test: (s: Screen, ctx: { doc: DemoDocument; summary: any }) => boolean };
const checks: Check[] = [
  { id: 'title', label: 'Screen has a title (app bar or heading)', test: s => !!s.title.trim() && (s.shell !== 'hidden' || has(s, n => n.type === 'Heading' || n.type === 'Hero')) },
  { id: 'one-action-bar', label: 'At most one action bar; one primary action (mobile)', test: (s, c) => !uxIssues(s, c.doc.channel).some(i => i.code === 'ux.many-action-bars' || i.code === 'ux.many-primary') },
  { id: 'no-nav-buttons', label: 'No buttons duplicating tab bar / back (outcome screens excepted)', test: (s, c) => !uxIssues(s, c.doc.channel).some(i => i.code === 'ux.nav-button' && i.severity === 'error') },
  { id: 'no-meta-text', label: 'No meta or placeholder copy', test: (s, c) => !uxIssues(s, c.doc.channel).some(i => i.code === 'ux.meta-text') },
  { id: 'no-success-on-form', label: 'Success messages only on outcome screens', test: (s, c) => !uxIssues(s, c.doc.channel).some(i => i.code === 'ux.success-on-form') },
  { id: 'no-empty', label: 'No empty sections or cards', test: (s, c) => s.children.length > 0 && !uxIssues(s, c.doc.channel).some(i => i.code === 'ux.empty-section') },
  { id: 'no-duplicate-actions', label: 'No duplicated action labels', test: (s, c) => !uxIssues(s, c.doc.channel).some(i => i.code === 'ux.duplicate-action') },
  { id: 'inputs-in-form', label: 'Inputs live in a form with a submit action', test: s => { let ok = true; const visit = (ns: NodeT[], inForm: boolean) => ns.forEach(n => { if (['Input', 'Select', 'Radio', 'Checkbox', 'Upload'].includes(n.type) && !inForm) ok = false; if (Array.isArray(n.children)) visit(n.children as NodeT[], inForm || n.type === 'Form'); }); visit(s.children as NodeT[], false); return ok; } },
  { id: 'labels-short', label: 'Action labels fit (<= 28 characters)', test: s => !has(s, LONG_LABEL) },
  { id: 'no-fallback', label: 'Real content (no fallback/default content)', test: (s, c) => c.summary.screens.find((x: any) => x.id === s.id)?.status !== 'fallback' },
  { id: 'valid', label: 'Passes schema and binding validation', test: (s, c) => !validateDocument(c.doc).some(i => i.severity === 'error' && i.path.startsWith('screens[' + c.doc.screens.indexOf(s) + ']')) },
  { id: 'connected', label: 'Reachable and has a way forward/back', test: (s, c) => !flowLint(c.doc).some(i => i.screenId === s.id && i.severity === 'error') },
  { id: 'coverage', label: 'Covers the planned requirement items', test: (s, c) => !coverageIssues(s, c.summary.plan?.find((p: any) => p.id === s.id)?.mustInclude ?? []).length },
];
const rows: string[] = [], totals = new Map(checks.map(c => [c.id, [0, 0]]));
let allPass = 0, all = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.summary.json')).sort()) {
  const key = f.replace('.summary.json', ''), summary = JSON.parse(readFileSync(dir + '/' + f, 'utf8'));
  let doc: DemoDocument; try { doc = JSON.parse(readFileSync(dir + '/' + key + '.json', 'utf8')); } catch { rows.push('| ' + key + ' | FAILED: ' + JSON.stringify(summary.error) + ' |'); continue; }
  const fails: string[] = [];
  for (const s of doc.screens) {
    all++; let screenOk = true;
    for (const c of checks) { const t = totals.get(c.id)!; t[1]++; if (c.test(s, { doc, summary })) t[0]++; else { screenOk = false; fails.push(s.id + ': ' + c.id); } }
    if (screenOk) allPass++;
  }
  const brandOk = !GENERIC_BRAND.test(doc.shell.brand) || doc.shell.brand.split(/\s+/).length <= 2;
  rows.push('| ' + key + ' | ' + doc.channel + ' | ' + doc.screens.length + ' | ' + doc.shell.brand + (brandOk ? '' : ' (long)') + ' | $' + Number(summary.costUsd).toFixed(4) + ' | ' + summary.seconds + 's | ' + (fails.length ? fails.join('; ') : 'all checks pass') + ' |');
}
const report = ['# UX checklist', '', 'Screens passing every check: **' + allPass + ' / ' + all + '**', '', '| Check | Pass rate |', '|---|---|',
  ...checks.map(c => { const [p, n] = totals.get(c.id)!; return '| ' + c.label + ' | ' + p + '/' + n + (p === n ? ' ✅' : '') + ' |'; }),
  '', '| Brief | Channel | Screens | Brand | Cost | Time | Findings |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
console.log(report);
if (out) writeFileSync(out, report + '\n');
