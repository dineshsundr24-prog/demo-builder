// Assemble generated screens into one document and apply deterministic,
// reported fixes for cross-screen issues (no extra AI calls).
import { validateDocument, documentContext, flowLint, type DemoDocument, type Screen, type NodeT, type Issue } from '@demo/schema';
import type { Plan } from './plan.ts';
import { planDocument } from './screen.ts';

const GENERIC = new Set(['name', 'value', 'type', 'date', 'status', 'id', 'amount', 'code', 'number', 'title', 'description', 'comment', 'comments', 'email', 'phone', 'mobile', 'notes']);
const norm = (v: string) => v.toLowerCase().replace(/\(.*?\)|aed|\*/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Apply fn to every string inside a node tree. */
function deepMap(v: any, fn: (s: string) => string): any { return typeof v === 'string' ? fn(v) : Array.isArray(v) ? v.map(x => deepMap(x, fn)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepMap(x, fn)])) : v; }
export type Assembly = { document: DemoDocument; issues: Issue[]; fixes: string[] };

function mapStrings(node: NodeT, fn: (s: string) => string): NodeT {
  const out: any = {};
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') out[k] = fn(v);
    else if (k === 'children' && Array.isArray(v)) out[k] = v.map(c => mapStrings(c as NodeT, fn));
    else if (k === 'items' && Array.isArray(v)) out[k] = v.map(it => (it && typeof it === 'object' ? Object.fromEntries(Object.entries(it).map(([a, b]) => [a, typeof b === 'string' ? fn(b) : b])) : it));
    else out[k] = v;
  }
  return out;
}

export function assemble(plan: Plan, screens: Screen[], meta: { id?: string } = {}): Assembly {
  const fixes: string[] = [];
  let doc: DemoDocument = { ...planDocument(plan, screens), id: meta.id ?? (plan.appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'demo') };

  // 1. State bindings that reference a key nobody writes, but whose last segment matches exactly one written key.
  const written = [...documentContext(doc).stateKeys];
  const lastSeg = (k: string) => k.split('.').pop()!.toLowerCase();
  doc = { ...doc, screens: doc.screens.map(s => ({ ...s, subtitle: s.subtitle, children: (s.children as NodeT[]).map(n => mapStrings(n, text => text.replace(/\{\{\s*state\.([A-Za-z0-9_.]+)/g, (m, key: string) => {
    if (written.includes(key)) return m;
    if (GENERIC.has(lastSeg(key))) return m; // "name", "date"... are too ambiguous to link safely
    const candidates = written.filter(w => lastSeg(w) === lastSeg(key));
    if (candidates.length !== 1) return m;
    fixes.push('Linked {{state.' + key + '}} on "' + s.title + '" to the input "' + candidates[0] + '"');
    return '{{state.' + candidates[0];
  }))) })) };

  // 1b. Review screens repeat what the customer entered: a summary row whose label matches an input
  //     on an earlier screen (or the loan calculator) shows that value, with the AI's sample as fallback.
  const inputs: { label: string; key: string; screen: number; currency: boolean }[] = [];
  const calcs: { key: string; screen: number }[] = [];
  doc.screens.forEach((s, si) => { const w = (ns: NodeT[]) => ns.forEach(n => {
    if (['Input', 'Select', 'Radio', 'BeneficiaryPicker', 'AmountInput'].includes(n.type) && typeof n.field === 'string' && typeof n.label === 'string') {
      const currency = n.inputType === 'currency' || n.type === 'AmountInput';
      inputs.push({ label: norm(n.label), key: n.field, screen: si, currency });
      // Common review wording for the same values.
      if (n.type === 'BeneficiaryPicker') for (const alias of ['beneficiary', 'beneficiary name', 'pay to', 'to', 'recipient', 'supplier', 'payee']) inputs.push({ label: alias, key: n.field, screen: si, currency });
      if (n.type === 'AmountInput') for (const alias of ['amount', 'transfer amount', 'payment amount', 'amount paid']) inputs.push({ label: alias, key: n.field, screen: si, currency });
    }
    if (n.type === 'EmiCalculator' && typeof n.stateKey === 'string') calcs.push({ key: n.stateKey, screen: si });
    if (n.children) w(n.children as NodeT[]); }); w(s.children as NodeT[]); });
  let linkedRows = 0;
  doc = { ...doc, screens: doc.screens.map((s, si) => {
    const link = (items: any[]) => items.map(it => {
      if (typeof it?.value !== 'string' || it.value.includes('{{') || typeof it.label !== 'string') return it;
      const l = norm(it.label), fallback = it.value.replace(/[{}]/g, '').slice(0, 80);
      const calc = calcs.filter(c => c.screen < si).at(-1);
      if (calc && /instal|emi|monthly (payment|repayment)/.test(l)) { linkedRows++; return { ...it, value: '{{state.' + calc.key + '.emi ?? ' + fallback + '}}' }; }
      if (calc && /^(finance |loan )?amount|requested amount|loan amount|finance amount/.test(l)) { linkedRows++; return { ...it, value: '{{state.' + calc.key + '.amountText ?? ' + fallback + '}}' }; }
      if (calc && /tenure|term|period/.test(l)) { linkedRows++; return { ...it, value: '{{state.' + calc.key + '.tenureText ?? ' + fallback + '}}' }; }
      const match = inputs.filter(i => i.screen < si && (i.label === l || (l.length > 5 && (i.label.includes(l) || l.includes(i.label))))).at(-1);
      if (!match) return it;
      linkedRows++;
      return { ...it, value: '{{state.' + match.key + (match.currency ? ' | aed' : '') + ' ?? ' + fallback + '}}' };
    });
    const visit = (ns: NodeT[]): NodeT[] => ns.map(n => n.type === 'RecordFields' && Array.isArray(n.items) ? { ...n, items: link(n.items as any[]) } : n.children ? { ...n, children: visit(n.children as NodeT[]) } : n);
    const isReview = /review|confirm|summary|check/i.test(s.id + ' ' + s.title);
    return isReview ? { ...s, children: visit(s.children as NodeT[]) } : s;
  }) };
  if (linkedRows) fixes.push('Linked ' + linkedRows + ' review value(s) to what the customer enters');

  // 1c. A screen that shows {{record.x}} but is never opened with a record shows the first sample record.
  {
    const ctx = documentContext(doc);
    let filled = 0;
    doc = { ...doc, screens: doc.screens.map(s => {
      if (ctx.recordScreens.has(s.id) || !JSON.stringify(s.children).includes('{{record.')) return s;
      const planned = plan.screens.find(p => p.id === s.id)?.collection;
      const cols = [...(planned ? doc.collections.filter(c => c.id === planned) : []), ...doc.collections];
      const fill = (text: string) => text.replace(/\{\{\s*record\.([A-Za-z0-9_]+)[^}]*\}\}/g, (m, f: string) => { const c = cols.find(x => x.fields.some(y => y.id === f) && x.rows.length); if (!c) return m; filled++; return String(c.rows[0][f] ?? ''); });
      return { ...s, children: (s.children as NodeT[]).map(n => deepMap(n, fill)) };
    }) };
    if (filled) fixes.push('Filled ' + filled + ' record value(s) on screens opened without a record (sample record shown)');
  }

  // 1d. Compliance: full card numbers are never displayed (only the last 4 digits).
  {
    let masked = 0;
    // IBANs (AE + 21 digits) are meant to be shown; only payment card numbers are masked.
    const mask = (t: string) => /\bAE\d{2}/.test(t) ? t : t.replace(/\b(\d{4})[ -]?(\d{4})[ -]?(\d{4})[ -]?(\d{4})\b/g, (_m, _a, _b, _c, d) => { masked++; return '•••• •••• •••• ' + d; });
    doc = { ...doc, screens: doc.screens.map(s => ({ ...s, children: (s.children as NodeT[]).map(n => deepMap(n, mask)) })),
      collections: doc.collections.map(c => ({ ...c, rows: c.rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, mask(String(v))]))) })) };
    if (masked) fixes.push('Masked ' + masked + ' full card number(s)');
  }

  // 2. Planned links that ended up missing and leave a screen unreachable: add an explicit button.
  for (let pass = 0; pass < 3; pass++) {
    const unreachable = flowLint(doc).filter(i => i.code === 'flow.unreachable').map(i => i.screenId!);
    if (!unreachable.length) break;
    let changed = false;
    for (const target of unreachable) {
      const source = plan.screens.find(p => p.links.includes(target) && !unreachable.includes(p.id) && ((doc.screens.find(s => s.id === p.id)?.children.length ?? 40) < 40));
      if (!source) continue;
      const title = plan.screens.find(p => p.id === target)!.title;
      doc = { ...doc, screens: doc.screens.map(s => s.id !== source.id ? s : { ...s, children: [...(s.children as NodeT[]), { type: 'Button', id: 'link-' + target, label: ('Open ' + title).slice(0, 40), variant: 'secondary', actions: [{ type: 'navigate', screen: target }] }] }) };
      fixes.push('Added a link from "' + source.title + '" to "' + title + '" (planned but missing)');
      changed = true;
    }
    if (!changed) break;
  }
  // 3. Dead ends (no way forward or back) get buttons for their planned links.
  for (const issue of flowLint(doc).filter(i => i.code === 'flow.dead-end')) {
    const planned = plan.screens.find(p => p.id === issue.screenId);
    const screen = doc.screens.find(s => s.id === issue.screenId);
    if (!planned || !screen || !planned.links.length || screen.children.length >= 38) continue;
    const buttons: NodeT[] = planned.links.slice(0, 2).map((target, i) => ({ type: 'Button', id: 'link-' + target, label: ('Continue to ' + plan.screens.find(p => p.id === target)!.title).slice(0, 40), variant: i ? 'secondary' : 'primary', actions: [{ type: 'navigate', screen: target }] }));
    doc = { ...doc, screens: doc.screens.map(s => (s.id === screen.id ? { ...s, children: [...(s.children as NodeT[]), ...buttons] } : s)) };
    fixes.push('Added ' + buttons.length + ' planned link(s) to "' + screen.title + '", which had no way forward');
  }
  return { document: doc, issues: validateDocument(doc), fixes };
}
