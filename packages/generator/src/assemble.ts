// Assemble generated screens into one document and apply deterministic,
// reported fixes for cross-screen issues (no extra AI calls).
import { validateDocument, documentContext, flowLint, type DemoDocument, type Screen, type NodeT, type Issue } from '@demo/schema';
import type { Plan } from './plan.ts';
import { planDocument } from './screen.ts';

const GENERIC = new Set(['name', 'value', 'type', 'date', 'status', 'id', 'amount', 'code', 'number', 'title', 'description', 'comment', 'comments', 'email', 'phone', 'mobile', 'notes']);
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
  return { document: doc, issues: validateDocument(doc), fixes };
}
