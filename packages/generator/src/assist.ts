// "Add screen with AI": plan ONE new screen against an existing document, build it with the
// archetype engine (same design quality as a full generation) and link it from an entry point.
import { z } from 'zod';
import { toStrictSchema, clampToSchema, allowedTemplates, validateDocument, ScreenRef, Icon, ICON_NAMES, type DemoDocument, type NodeT, type Screen, type Collection } from '@demo/schema';
import type { LlmProvider, CompletionResult } from './provider.ts';
import type { Plan, PlanScreen } from './plan.ts';
import { archetypesFor, ARCHETYPES } from './archetypes.ts';
import { generateScreen, screenInstructions, stripArtifacts } from './screen.ts';
import { ProviderError } from './provider.ts';
import { normalizeDesign } from './design.ts';
import { stripNulls, validateScreen, documentContext, detachTemplate, findNode, allIds, insertNode, removeNode, moveNode, updateNode, updateScreen, isContainer, componentGuide, templates, Node, type Issue } from '@demo/schema';

export type AddScreenRequest = { requirement: string; from?: string | null; to?: string | null; addToMenu?: boolean };
export type AddScreenResult = { document: DemoDocument; screenId: string; changes: string[]; status: 'valid' | 'repaired' | 'fallback'; calls: CompletionResult[] };

const Slug = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
function model(channel: 'mobile' | 'portal') {
  return z.object({
    title: z.string().min(1).max(60), archetype: z.enum([...archetypesFor(channel).map(a => a.id), 'custom'] as unknown as [string, ...string[]]),
    purpose: z.string().min(1).max(400), mustInclude: z.array(z.string().min(2).max(48)).max(8),
    openFrom: ScreenRef.nullable(), entryLabel: z.string().min(1).max(20), entryIcon: Icon,
    leadsTo: z.array(ScreenRef).max(4),
    collection: z.string().nullable(),
    newCollection: z.object({ id: Slug, label: z.string().min(1).max(60), key: z.string().min(1).max(40),
      fields: z.array(z.object({ id: z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/), label: z.string().min(1).max(40) })).min(2).max(8),
      rows: z.array(z.array(z.string().max(120))).min(2).max(8) }).nullable(),
    sampleFacts: z.array(z.object({ label: z.string().min(1).max(40), value: z.string().min(1).max(80) })).max(10),
  });
}
const INSTRUCTIONS = `You add ONE new screen to an existing clickable demo app. Return its plan only.
- title: short screen title. archetype: the standard screen type it IS (designed layouts):
ARCHETYPES
  Use "custom" only when none fits. Notifications, messages, alerts, help/FAQ and offers are "info" (icon rows), not "list".
- purpose: 1-2 sentences, concrete content and controls. mustInclude: 3-8 content items from the requirement (never navigation).
- openFrom: the existing screen the user opens it from (a dashboard/home/profile/list is typical), or the one given. entryLabel/entryIcon: the label (1-2 words) and icon of that entry point.
- leadsTo: existing screens its actions lead to (e.g. a success screen, back to home); may be empty.
- collection: an existing collection id when the screen lists/shows existing records; else null. newCollection: only when it lists records no collection holds (human-readable columns only, no icon names or codes; realistic fictional rows, UAE/AED unless the app says otherwise); else null.
- sampleFacts: the existing app's facts this screen must reuse exactly (customer name, account numbers, balances) taken from appText.
- Never claim real integrations; never use real personal data.`;

const words = (v: unknown, out: string[] = []): string[] => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(x => words(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!['id', 'type', 'actions', 'logo'].includes(k)) words(x, out); return out; };
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'screen';

/** Plan document context from an existing document (so the archetype engine can run on it). */
export function planFromDocument(doc: DemoDocument, screens: PlanScreen[], extra: Partial<Plan> = {}): Plan {
  return { appName: doc.name, brandName: doc.shell.brand || doc.name, channel: doc.channel, theme: { primary: doc.theme.primary, secondary: doc.theme.secondary, accent: doc.theme.accent },
    shell: doc.shell, collections: doc.collections, screens, sampleFacts: [], templates: [], globalContext: '', notes: [],
    ...(doc.theme.logo || doc.theme.font ? { brand: { ...(doc.theme.logo ? { logo: doc.theme.logo } : {}), font: doc.theme.font } } : {}), ...extra };
}

/** Add an entry point to the new screen on `from`: a quick action, a menu row, or a button. */
export function linkFrom(doc: DemoDocument, fromId: string, target: string, label: string, icon: string): { doc: DemoDocument; change: string } | null {
  const from = doc.screens.find(s => s.id === fromId);
  if (!from) return null;
  const nav = [{ type: 'navigate', screen: target }];
  let change = '';
  const visit = (nodes: NodeT[]): NodeT[] => nodes.map(n => {
    if (change) return n;
    const items = n.items as any[] | undefined;
    if (n.type === 'QuickActions' && items && items.length < 8) { change = 'Quick action "' + label + '" on ' + from.title; return { ...n, items: [...items, { label: label.slice(0, 20), icon, actions: nav }] }; }
    if (n.type === 'MenuList' && items && items.length < 12 && !items.some(i => i.danger)) { change = 'Menu row "' + label + '" on ' + from.title; return { ...n, items: [...items, { label: label.slice(0, 40), icon, actions: nav }] }; }
    return Array.isArray(n.children) ? { ...n, children: visit(n.children as NodeT[]) } : n;
  });
  let children = visit(from.children as NodeT[]);
  if (!change) {
    // A plain secondary button, placed before the screen's action bar when it has one.
    const ids = new Set<string>(); const walk = (ns: NodeT[]) => ns.forEach(n => { ids.add(n.id); if (n.children) walk(n.children as NodeT[]); }); walk(children);
    let id = 'open-' + target, k = 2; while (ids.has(id)) id = 'open-' + target + '-' + k++;
    const button: NodeT = { type: 'Button', id, label: label.slice(0, 40), variant: 'secondary', actions: nav };
    const bar = children.findIndex(n => n.type === 'ActionBar');
    children = bar >= 0 ? [...children.slice(0, bar), button, ...children.slice(bar)] : [...children, button];
    change = 'Button "' + label + '" on ' + from.title;
  }
  return { doc: { ...doc, screens: doc.screens.map(s => (s.id === fromId ? { ...s, children } : s)) }, change };
}

export async function addScreenWithAI(provider: LlmProvider, doc: DemoDocument, req: AddScreenRequest, onCall: (kind: 'plan' | 'screen' | 'repair', call: CompletionResult) => Promise<void> = async () => {}): Promise<AddScreenResult> {
  const requirement = req.requirement.trim().slice(0, 3000);
  if (requirement.length < 3) throw Object.assign(Error('Describe the screen you want to add'), { category: 'bad_request' });
  const ids = doc.screens.map(s => s.id);
  const m = model(doc.channel);
  const schema = toStrictSchema(m, { screen: ids });
  const appText = doc.screens.map(s => s.title + ': ' + words(s.children).join(' | ')).join('\n').slice(0, 5000);
  const input = JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    app: { name: doc.name, brand: doc.shell.brand, channel: doc.channel, menu: doc.shell.items.map(i => i.label) },
    requirement, openFromGiven: req.from ?? null, leadsToGiven: req.to ?? null,
    screens: doc.screens.map(s => ({ id: s.id, title: s.title })),
    collections: doc.collections.map(c => ({ id: c.id, label: c.label, fields: c.fields.map(f => f.id) })),
    appText,
  });
  const instructions = INSTRUCTIONS.replace('ARCHETYPES', archetypesFor(doc.channel).map(a => '  - ' + a.id + ': ' + a.description).join('\n'));
  const call = await provider.complete({ purpose: 'plan', instructions, input, schemaName: 'new_screen', schema, maxOutputTokens: 3000 });
  await onCall('plan', call);
  const raw: any = call.json;
  const parsed = m.safeParse(clampToSchema(m, raw));
  if (!parsed.success) throw Object.assign(Error('The AI plan for the new screen was not usable: ' + parsed.error.issues[0]?.message), { category: 'parse' });
  const p = parsed.data;

  // New screen id and data, decided deterministically.
  const taken = new Set(ids);
  let id = slug(p.title), n = 2; while (taken.has(id)) id = slug(p.title) + '-' + n++;
  const collections: Collection[] = [...doc.collections];
  let collection = p.collection && collections.some(c => c.id === p.collection) ? p.collection : null;
  if (!collection && p.newCollection) {
    const c = p.newCollection, fields = c.fields.filter((f, i, all) => all.findIndex(x => x.id === f.id) === i);
    let cid = c.id, k = 2; while (collections.some(x => x.id === cid)) cid = c.id + '-' + k++;
    const key = fields.some(f => f.id === c.key) ? c.key : fields[0].id;
    const seen = new Set<string>();
    const rows = c.rows.map(r => Object.fromEntries(fields.map((f, i) => [f.id, String(r[i] ?? '')]))).filter(r => r[key] && !seen.has(r[key]) && seen.add(r[key]));
    collections.push({ id: cid, label: c.label, key, fields, rows }); collection = cid;
  }
  const from = req.from && ids.includes(req.from) ? req.from : p.openFrom && ids.includes(p.openFrom) ? p.openFrom : null;
  const leads = [...new Set([...(req.to && ids.includes(req.to) ? [req.to] : []), ...p.leadsTo.filter(x => ids.includes(x))])];
  let archetype = ARCHETYPES[p.archetype]?.channels.includes(doc.channel) ? p.archetype : 'custom';
  if (['list', 'detail', 'approval'].includes(archetype) && !collection) archetype = archetype === 'list' ? 'custom' : archetype;
  const target: PlanScreen = { id, title: p.title, requirement, purpose: p.purpose, template: null, links: leads.length ? leads : from ? [from] : [], shell: archetype === 'custom' ? 'default' : ARCHETYPES[archetype].shell(doc.channel),
    locked: true, mustInclude: p.mustInclude, archetype, collection };
  const existing: PlanScreen[] = doc.screens.map(s => ({ id: s.id, title: s.title, requirement: '', purpose: s.title, template: null, links: [], shell: s.shell, locked: true }));
  const plan = planFromDocument({ ...doc, collections }, [...existing, target], { sampleFacts: p.sampleFacts, templates: allowedTemplates(doc.channel, requirement), globalContext: 'Existing app "' + doc.name + '". ' + appText.slice(0, 1500) });

  const out = await generateScreen(provider, plan, target, (kind, c) => onCall(kind, c));
  const screen: Screen = { ...out.screen, id, title: p.title };
  const index = from ? doc.screens.findIndex(s => s.id === from) + 1 : doc.screens.length;
  const screens = [...doc.screens]; screens.splice(index, 0, screen);
  let next: DemoDocument = { ...doc, collections, screens };
  const changes = ['New screen "' + p.title + '" (' + (ARCHETYPES[archetype]?.label ?? 'custom layout') + ')'];
  if (collection && !doc.collections.some(c => c.id === collection)) changes.push('New sample data "' + collections.find(c => c.id === collection)!.label + '"');
  if (from) { const l = linkFrom(next, from, id, p.entryLabel, (ICON_NAMES as readonly string[]).includes(p.entryIcon) ? p.entryIcon : 'circle'); if (l) { next = l.doc; changes.push('Link: ' + l.change); } }
  if (req.addToMenu && next.shell.kind !== 'none' && next.shell.items.length < 6) {
    next = { ...next, shell: { ...next.shell, items: [...next.shell.items, { id: 'menu-' + id, label: p.entryLabel.slice(0, 24), icon: p.entryIcon, screen: id }] } };
    changes.push('App menu item "' + p.entryLabel + '"');
  }
  if (!from && !req.addToMenu) changes.push('Not linked yet: add a link from another screen, or use "Opens from"');
  const errors = validateDocument(next).filter(i => i.severity === 'error');
  if (errors.length) throw Object.assign(Error('The new screen did not validate: ' + errors.slice(0, 2).map(e => e.message).join('; ')), { category: 'parse' });
  return { document: next, screenId: id, changes, status: out.status, calls: [call, ...out.calls] };
}

// ---------- Change an existing screen ----------

export type ModifyScreenResult = { document: DemoDocument; screenId: string; changes: string[]; calls: CompletionResult[]; reply?: string };
const MODIFY_RULES = `
CHANGE MODE: you receive an existing screen and an instruction from the demo author.
- Apply exactly what the instruction asks. Keep every other component, id, text, binding and action unchanged and in the same order.
- New components get new, descriptive ids. Keep the screen id. Change the title only if asked.
- If the instruction asks for something that already exists, adjust it rather than adding a duplicate.`;

/** Flatten journey templates so their texts and buttons can be changed (same look and behaviour). */
function detachAll(doc: DemoDocument, screenId: string): DemoDocument {
  for (let guard = 0; guard < 20; guard++) {
    const s = doc.screens.find(x => x.id === screenId)!;
    let tpl: string | null = null;
    const find = (ns: NodeT[]) => ns.forEach(n => { if (!tpl && n.type === 'Template') tpl = n.id; if (n.children) find(n.children as NodeT[]); });
    find(s.children as NodeT[]);
    if (!tpl) return doc;
    doc = detachTemplate(doc, screenId, tpl).doc;
  }
  return doc;
}

/** Human summary of what changed between two versions of a screen. */
export function describeChanges(before: Screen, after: Screen): string[] {
  const index = (s: Screen) => { const m = new Map<string, NodeT>(); const w = (ns: NodeT[]) => ns.forEach(n => { m.set(n.id, n); if (n.children) w(n.children as NodeT[]); }); w(s.children as NodeT[]); return m; };
  const a = index(before), b = index(after), out: string[] = [];
  const name = (n: NodeT) => String(n.label ?? n.text ?? n.title ?? (n as any).primary?.label ?? n.type).slice(0, 40);
  // Canonical form: property order and an explicit-but-equivalent form id are not changes.
  const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => k !== 'children' && !(k === 'form' && v.type === 'submit')).sort().map(k => [k, canon(v[k])])) : v;
  const own = (n: NodeT) => JSON.stringify(canon(n));
  if (before.title !== after.title) out.push('Title: "' + before.title + '" → "' + after.title + '"');
  for (const [id, n] of b) if (!a.has(id)) out.push('Added ' + n.type + ' "' + name(n) + '"');
  for (const [id, n] of a) if (!b.has(id)) out.push('Removed ' + n.type + ' "' + name(n) + '"');
  for (const [id, n] of b) { const o = a.get(id); if (o && own(o) !== own(n)) out.push(name(o) !== name(n) ? 'Changed ' + n.type + ': "' + name(o) + '" → "' + name(n) + '"' : 'Changed ' + n.type + ' "' + name(n) + '"'); }
  const order = (m: Map<string, NodeT>) => [...m.keys()].filter(k => a.has(k) && b.has(k)).join(',');
  if (!out.length && order(a) !== order(b)) out.push('Reordered components');
  return out.length ? out.slice(0, 12) : ['No visible change'];
}

const OPS_RULES = `You edit ONE screen of a clickable demo app for its author. You receive the screen (an outline and its components) and the author's request.
Return a short "reply" to the author and the smallest list of "operations" that does what they asked:
- replace: give the component's full new version (same id). For a container (Section, Card, Form, Grid, Stack), "children" is its complete new content: restate children you keep (same ids) and add new ones; an empty children list keeps the current content.
- insert: a new component inside "parent" (null = screen top level) right after "after" (null = first position).
- remove: delete a component. move: put an existing component inside "parent" after "after".
- screen: change the screen title/subtitle (only when asked, or when they no longer describe the screen).
- Data must match what the screen is about: a customer search shows customers (name, CIF, mobile, Emirates ID, segment, customer since), not loan applications. If no listed collection holds the right records, add them with a data operation.
- "Rework", "improve" or "clean up" means: make the screen a proper banking screen for its purpose; remove parts marked [does nothing] and fix a subtitle that no longer fits.
- data: add a new sample data set (realistic FICTIONAL UAE banking records; key = the unique field) when a table/list needs records no listed collection holds; components then use collection "new-data".
Rules:
- Touch nothing the author did not ask about. Never rename, reword or restyle other components.
- Dropdown filters are for categories with repeating values (status, segment, emirate, product, branch), never for names, ids or phone numbers (search covers those).
- On a staff portal, buttons size to their label; to make one smaller or quieter use variant "secondary" or "link"; a button with no actions does nothing: give it one or remove it.
- Prefer built-in capabilities over new parts: tables have search, dropdown filters (filterField, moreFilters) and a date-range filter (dateFilterField); lists have search (searchable) and a filter chip row (filterField). Switch these on with a replace of the table/list. Never add loose inputs to filter or search data.
- Inputs only work inside a Form with a submit button. Buttons need actions (navigate to a listed screen, toast, simulate...).
- If the request is unclear or impossible with the available components, return no operations and say in "reply" what you can do instead.
- reply: one or two plain sentences describing exactly what your operations do (or why you made none). Never claim a change your operations do not make. No ids.
${''}`;

const OpRef = z.string().min(1).meta({ ref: 'node' });
function opsModel() {
  return z.object({
    reply: z.string().min(1).max(400),
    operations: z.array(z.discriminatedUnion('op', [
      z.object({ op: z.literal('replace'), target: OpRef, node: Node }),
      z.object({ op: z.literal('insert'), parent: OpRef.nullable(), after: OpRef.nullable(), node: Node }),
      z.object({ op: z.literal('remove'), target: OpRef }),
      z.object({ op: z.literal('move'), target: OpRef, parent: OpRef.nullable(), after: OpRef.nullable() }),
      z.object({ op: z.literal('screen'), title: z.string().max(85).nullable(), subtitle: z.string().max(140).nullable() }),
      z.object({ op: z.literal('data'), label: z.string().min(1).max(60), key: z.string().min(1).max(40),
        fields: z.array(z.object({ id: z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/), label: z.string().min(1).max(40) })).min(2).max(10),
        rows: z.array(z.array(z.string().max(120))).min(3).max(12) }),
    ])).max(15),
  });
}
type Op = z.infer<ReturnType<typeof opsModel>>['operations'][number];

/** Readable outline of a screen for the model (type, id and the visible text of every component). */
export function outlineOf(screen: Screen): string {
  const lines: string[] = [];
  const text = (n: NodeT) => { const t = n.label ?? n.text ?? n.title ?? (n as any).primary?.label ?? n.name ?? n.headline; return t ? ' "' + String(t).slice(0, 60) + '"' : ''; };
  // Flag parts that do nothing, so a "rework/clean up" request removes or fixes them.
  const note = (n: NodeT, inForm: boolean) => n.type === 'Button' && !(n.actions as unknown[] | undefined)?.length ? '  [does nothing: no actions]'
    : ['Input', 'Select', 'Radio', 'Checkbox', 'Upload', 'Toggle'].includes(n.type) && !inForm ? '  [does nothing: outside a form]' : '';
  const walk = (ns: NodeT[], d: number, inForm: boolean) => ns.forEach(n => { lines.push('  '.repeat(d) + '- ' + n.type + ' #' + n.id + text(n) + note(n, inForm)); if (n.children) walk(n.children as NodeT[], d + 1, inForm || n.type === 'Form'); });
  walk(screen.children as NodeT[], 0, false);
  return 'Screen "' + screen.title + '"' + (screen.subtitle ? ' (subtitle "' + screen.subtitle + '")' : '') + '\n' + lines.join('\n');
}

/** Apply operations with the editor's own command layer (same rules as manual editing), and verify that
 *  each one actually took effect, so the reply can never describe a change that did not happen. */
export function applyOps(doc: DemoDocument, screenId: string, ops: Op[]): { doc: DemoDocument; skipped: string[] } {
  const skipped: string[] = [];
  // New sample data first; components reference it as "new-data".
  let dataId: string | null = null;
  for (const op of ops) if (op.op === 'data' && !dataId) {
    const base = op.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'records';
    let id = base, n = 2; while (doc.collections.some(c => c.id === id)) id = base + '-' + n++;
    const fields = op.fields.filter((f, i, all) => all.findIndex(x => x.id === f.id) === i);
    const key = fields.some(f => f.id === op.key) ? op.key : fields[0].id, seen = new Set<string>();
    const rows = op.rows.map(r => Object.fromEntries(fields.map((f, i) => [f.id, String(r[i] ?? '')]))).filter(r => r[key] && !seen.has(r[key]) && seen.add(r[key]));
    doc = { ...doc, collections: [...doc.collections, { id, label: op.label, key, fields, rows }] }; dataId = id;
  }
  const remap = (v: any): any => Array.isArray(v) ? v.map(remap) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'collection' && x === 'new-data' ? (dataId ?? x) : remap(x)])) : v;
  const nodesOf = (d: DemoDocument) => d.screens.find(s => s.id === screenId)!.children as NodeT[];
  const indexAfter = (d: DemoDocument, parent: string | null, after: string | null) => {
    if (!after) return 0;
    const loc = findNode(nodesOf(d), after);
    return loc && loc.parentId === parent ? loc.index + 1 : (parent ? ((findNode(nodesOf(d), parent)?.node.children as NodeT[] | undefined)?.length ?? 0) : nodesOf(d).length);
  };
  const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter(k => k !== 'children' && k !== 'id').sort().map(k => [k, canon(v[k])])) : v;
  for (const raw of ops) {
    if (raw.op === 'data') continue;
    const op: any = remap(raw);
    try {
      if (op.op === 'screen') {
        const patch: any = {}; if (op.title) patch.title = op.title; if (op.subtitle !== null && op.subtitle !== undefined) patch.subtitle = op.subtitle;
        doc = updateScreen(doc, screenId, patch);
        const s = doc.screens.find(x => x.id === screenId)!;
        if ((patch.title && s.title !== patch.title) || (patch.subtitle !== undefined && (s.subtitle ?? '') !== patch.subtitle)) throw Error('screen title/subtitle not applied');
      } else if (op.op === 'remove') {
        if (!findNode(nodesOf(doc), op.target)) throw Error('no component ' + op.target);
        doc = removeNode(doc, screenId, op.target);
      } else if (op.op === 'insert') {
        const r = insertNode(doc, screenId, op.parent, indexAfter(doc, op.parent, op.after), stripNulls(op.node) as NodeT);
        doc = r.doc; if (!findNode(nodesOf(doc), r.id)) throw Error('insert had no effect');
      } else if (op.op === 'move') {
        doc = moveNode(doc, screenId, op.target, op.parent, indexAfter(doc, op.parent, op.after));
      } else if (op.op === 'replace') {
        const loc = findNode(nodesOf(doc), op.target); if (!loc) throw Error('no component ' + op.target);
        const next = stripNulls(op.node) as NodeT;
        const newKids = Array.isArray(next.children) && next.children.length ? next.children as NodeT[] : null;
        if (next.type === loc.node.type && !newKids) {
          const { type: _t, id: _i, children: _c, ...props } = next; void _t; void _i; void _c;
          const patch: Record<string, unknown> = { ...props };
          for (const k of Object.keys(loc.node)) if (!['type', 'id', 'children'].includes(k) && !(k in props)) patch[k] = undefined;
          doc = updateNode(doc, screenId, op.target, patch);
        } else {
          // New content (or a different component type): swap the whole subtree, keeping the id and position.
          const keepKids = !newKids && Array.isArray(loc.node.children) && isContainer(next.type) ? { children: loc.node.children } : {};
          const node = { ...next, ...keepKids, id: op.target } as NodeT;
          doc = insertNode(removeNode(doc, screenId, op.target), screenId, loc.parentId, loc.index, node).doc;
        }
        const now = findNode(nodesOf(doc), op.target);
        if (!now || JSON.stringify(canon(now.node)) !== JSON.stringify(canon({ ...next, id: op.target })) || (newKids && ((now.node.children as NodeT[]) ?? []).length !== newKids.length)) throw Error('replace of ' + op.target + ' did not take effect');
      }
    } catch (e) { skipped.push(op.op + ': ' + (e instanceof Error ? e.message : String(e))); }
  }
  return { doc, skipped };
}

/** Inputs outside any form do nothing; report the ones an edit introduced. */
function inertInputs(screen: Screen): Set<string> {
  const out = new Set<string>();
  const walk = (ns: NodeT[], inForm: boolean) => ns.forEach(n => { if (['Input', 'Select', 'Radio', 'Checkbox', 'Upload', 'Toggle'].includes(n.type) && !inForm) out.add(n.id); if (n.children) walk(n.children as NodeT[], inForm || n.type === 'Form'); });
  walk(screen.children as NodeT[], false);
  return out;
}

export async function modifyScreenWithAI(provider: LlmProvider, doc: DemoDocument, screenId: string, instruction: string, onCall: (kind: 'screen' | 'repair', call: CompletionResult) => Promise<void> = async () => {}, conversation: string[] = []): Promise<ModifyScreenResult> {
  if (!doc.screens.some(s => s.id === screenId)) throw Object.assign(Error('Unknown screen ' + screenId), { category: 'bad_request' });
  const working = detachAll(doc, screenId);
  const current = working.screens.find(s => s.id === screenId)!;
  const ids = [...allIds(current.children as NodeT[])];
  const m = opsModel();
  const schema = toStrictSchema(m, { screen: doc.screens.map(s => s.id), collection: [...doc.collections.map(c => c.id), 'new-data'], template: templates.filter(t => t.channels.includes(doc.channel)).map(t => t.id), node: ids });
  const instructions = OPS_RULES + '\n' + componentGuide(doc.channel);
  const context = { conversationSoFar: conversation, app: { name: doc.name, channel: doc.channel, menu: doc.shell.items.map(i => i.label) }, allScreens: doc.screens.map(s => ({ id: s.id, title: s.title })),
    collections: doc.collections.map(c => ({ id: c.id, label: c.label, fields: c.fields.map(f => ({ id: f.id, label: f.label })), sampleRow: c.rows[0] })) };
  const calls: CompletionResult[] = [];
  const before = inertInputs(current);
  const attempt = (json: unknown) => {
    // Strict outputs send null for every unused optional property: drop those inside components only
    // (parent/after/title/subtitle use null on purpose).
    const raw: any = structuredClone(json);
    for (const op of raw?.operations ?? []) if (op?.node) op.node = stripNulls(op.node);
    const parsed = m.safeParse(clampToSchema(m, raw));
    if (!parsed.success) return { reply: '', doc: working, issues: [{ path: 'operations', code: 'schema.ops', severity: 'error', message: parsed.error.issues[0]?.message ?? 'invalid' } as Issue], ops: [] as Op[] };
    let { doc: next, skipped } = applyOps(working, screenId, parsed.data.operations);
    let screen = next.screens.find(s => s.id === screenId)!;
    // Known model artifact (stray braces such as "Reference},{"): clean deterministically.
    const ctx = documentContext(next);
    const cleaned = stripArtifacts(screen, validateScreen(screen, ctx, 'screen'));
    if (cleaned) { screen = cleaned; next = { ...next, screens: next.screens.map(s => (s.id === screenId ? cleaned : s)) }; }
    const issues: Issue[] = [...validateScreen(screen, ctx, 'screen'), ...skipped.map(x => ({ path: 'operations', code: 'ops.skipped', severity: 'error', message: 'Could not apply ' + x } as Issue))];
    for (const id of inertInputs(screen)) if (!before.has(id)) issues.push({ path: 'screen', code: 'ux.inert-input', severity: 'error', message: 'Input #' + id + ' is outside a Form, so it does nothing. To filter or search a table/list use its built-in options; otherwise put inputs in a Form with a submit button.' } as Issue);
    return { reply: parsed.data.reply, doc: next, issues, ops: parsed.data.operations };
  };
  const errs = (i: Issue[]) => i.filter(x => x.severity === 'error');
  const input = { request: instruction.slice(0, 2000), outline: outlineOf(current), components: current.children, context };
  const ask = (extra: object = {}) => provider.complete({ purpose: 'repair', instructions, input: JSON.stringify({ ...input, ...extra }), schemaName: 'screen_edit', schema, maxOutputTokens: 10000 });
  let call: CompletionResult;
  try { call = await ask(); }
  catch (e) {
    if (!(e instanceof ProviderError) || e.category !== 'truncated') throw e;
    call = await ask({ note: 'Your previous answer ran too long. Use as few operations as possible and keep the reply to one sentence.' }); // one retry
  }
  calls.push(call); await onCall('screen', call);
  let out = attempt(call.json);
  if (errs(out.issues).length) {
    const fix = await provider.complete({ purpose: 'repair', instructions, input: JSON.stringify({ ...input, task: 'Your operations had these problems. Return corrected operations for the ORIGINAL screen.', problems: errs(out.issues).map(i => i.message), previousOperations: out.ops }), schemaName: 'screen_edit', schema, maxOutputTokens: 10000 });
    calls.push(fix); await onCall('repair', fix);
    out = attempt(fix.json);
    if (errs(out.issues).length) throw Object.assign(Error('I could not make that change validly (' + errs(out.issues)[0].message + '). Try rephrasing it, or edit the screen directly.'), { category: 'parse' });
  }
  const after = out.doc.screens.find(s => s.id === screenId)!;
  const changed = JSON.stringify(after) !== JSON.stringify(current);
  // Templates are only flattened when the edit actually changed the screen.
  const document: DemoDocument = changed ? { ...doc, collections: out.doc.collections, screens: doc.screens.map(s => (s.id === screenId ? after : s)) } : doc;
  const newData = out.doc.collections.filter(c => !doc.collections.some(x => x.id === c.id)).map(c => 'New sample data "' + c.label + '" (' + c.rows.length + ' records)');
  // Never let a reply claim a change that did not happen.
  const reply = !changed && out.ops.length ? 'I made no change: the screen already looks like that. Tell me more specifically what should change (for example "make the Filters button a small link" or "remove the Filters button").' : out.reply;
  return { document, screenId, changes: changed ? [...describeChanges(current, after), ...newData] : ['No visible change'], calls, reply };
}

// ---------- One assistant entry point ----------
export type AssistRequest = { instruction: string; history?: string[]; currentScreen?: string | null; mode?: 'auto' | 'add' | 'modify'; from?: string | null; to?: string | null; addToMenu?: boolean };
export type AssistResult = { action: 'added' | 'modified'; document: DemoDocument; screenId: string; changes: string[] };

/** Decide between adding a new screen and changing an existing one (tiny call; explicit modes skip it). */
export async function routeInstruction(provider: LlmProvider, doc: DemoDocument, req: AssistRequest, onCall: (call: CompletionResult) => Promise<void>): Promise<{ intent: 'add' | 'modify'; screen: string | null }> {
  if (req.mode === 'add') return { intent: 'add', screen: null };
  if (req.mode === 'modify') return { intent: 'modify', screen: req.currentScreen ?? null };
  const m = z.object({ intent: z.enum(['add_screen', 'modify_screen']), screen: ScreenRef.nullable() });
  const call = await provider.complete({ purpose: 'plan', schemaName: 'route', schema: toStrictSchema(m, { screen: doc.screens.map(s => s.id) }), maxOutputTokens: 200,
    instructions: 'Classify a demo author\'s request about their clickable app. "add_screen" when they want a NEW screen/page/step; "modify_screen" when they want to change content, wording, fields, buttons or layout of an EXISTING screen (screen = which one; the current screen unless another is named).',
    input: JSON.stringify({ request: req.instruction.slice(0, 1000), conversationSoFar: (req.history ?? []).slice(-6), currentScreen: req.currentScreen ?? null, screens: doc.screens.map(s => ({ id: s.id, title: s.title })) }) });
  await onCall(call);
  const r = m.safeParse(call.json);
  if (!r.success) return { intent: req.currentScreen ? 'modify' : 'add', screen: req.currentScreen ?? null };
  return { intent: r.data.intent === 'add_screen' ? 'add' : 'modify', screen: r.data.screen ?? req.currentScreen ?? null };
}
