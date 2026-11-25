// "Add screen with AI": plan ONE new screen against an existing document, build it with the
// archetype engine (same design quality as a full generation) and link it from an entry point.
import { z } from 'zod';
import { toStrictSchema, clampToSchema, allowedTemplates, validateDocument, ScreenRef, Icon, ICON_NAMES, type DemoDocument, type NodeT, type Screen, type Collection } from '@demo/schema';
import type { LlmProvider, CompletionResult } from './provider.ts';
import type { Plan, PlanScreen } from './plan.ts';
import { archetypesFor, ARCHETYPES } from './archetypes.ts';
import { generateScreen, screenInstructions } from './screen.ts';
import { normalizeDesign } from './design.ts';
import { aiScreenSchema, stripNulls, validateScreen, documentContext, detachTemplate, type Issue } from '@demo/schema';

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

export type ModifyScreenResult = { document: DemoDocument; screenId: string; changes: string[]; calls: CompletionResult[] };
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

export async function modifyScreenWithAI(provider: LlmProvider, doc: DemoDocument, screenId: string, instruction: string, onCall: (kind: 'screen' | 'repair', call: CompletionResult) => Promise<void> = async () => {}): Promise<ModifyScreenResult> {
  const original = doc.screens.find(s => s.id === screenId);
  if (!original) throw Object.assign(Error('Unknown screen ' + screenId), { category: 'bad_request' });
  const working = detachAll(doc, screenId);
  const current = working.screens.find(s => s.id === screenId)!;
  const ctx = documentContext(working);
  const schema = aiScreenSchema({ channel: doc.channel, screenIds: doc.screens.map(s => s.id), collectionIds: doc.collections.map(c => c.id) });
  const instructions = screenInstructions(doc.channel) + MODIFY_RULES;
  const context = { app: { name: doc.name, channel: doc.channel, menu: doc.shell.items.map(i => i.label) }, allScreens: doc.screens.map(s => ({ id: s.id, title: s.title })),
    collections: doc.collections.map(c => ({ id: c.id, label: c.label, fields: c.fields.map(f => f.id) })) };
  const calls: CompletionResult[] = [];
  const check = (json: unknown) => {
    const raw = { ...(stripNulls(json) as Screen), id: screenId, shell: current.shell } as Screen;
    const first = validateScreen(raw, ctx, 'screen');
    if (first.some(i => i.severity === 'error' && i.code.startsWith('schema.'))) return { screen: raw, issues: first };
    const { screen } = normalizeDesign(raw);
    return { screen, issues: validateScreen(screen, ctx, 'screen') };
  };
  const errs = (i: Issue[]) => i.filter(x => x.severity === 'error');
  const call = await provider.complete({ purpose: 'repair', instructions, input: JSON.stringify({ instruction: instruction.slice(0, 2000), screen: current, context }), schemaName: 'screen', schema, maxOutputTokens: 8000 });
  calls.push(call); await onCall('screen', call);
  let out = check(call.json);
  if (errs(out.issues).length) {
    const fix = await provider.complete({ purpose: 'repair', instructions, input: JSON.stringify({ instruction: instruction.slice(0, 2000), task: 'Your changed screen has these problems; fix them and return the full screen.', problems: errs(out.issues).map(i => i.path + ': ' + i.message), previousScreen: out.screen, originalScreen: current, context }), schemaName: 'screen', schema, maxOutputTokens: 8000 });
    calls.push(fix); await onCall('repair', fix);
    out = check(fix.json);
    if (errs(out.issues).length) throw Object.assign(Error('The AI could not make that change validly (' + errs(out.issues)[0].message + '). Try rephrasing it, or edit the screen directly.'), { category: 'parse' });
  }
  const next: DemoDocument = { ...doc, screens: doc.screens.map(s => (s.id === screenId ? out.screen : s)) };
  return { document: next, screenId, changes: describeChanges(current, out.screen), calls };
}

// ---------- One assistant entry point ----------
export type AssistRequest = { instruction: string; currentScreen?: string | null; mode?: 'auto' | 'add' | 'modify'; from?: string | null; to?: string | null; addToMenu?: boolean };
export type AssistResult = { action: 'added' | 'modified'; document: DemoDocument; screenId: string; changes: string[] };

/** Decide between adding a new screen and changing an existing one (tiny call; explicit modes skip it). */
export async function routeInstruction(provider: LlmProvider, doc: DemoDocument, req: AssistRequest, onCall: (call: CompletionResult) => Promise<void>): Promise<{ intent: 'add' | 'modify'; screen: string | null }> {
  if (req.mode === 'add') return { intent: 'add', screen: null };
  if (req.mode === 'modify') return { intent: 'modify', screen: req.currentScreen ?? null };
  const m = z.object({ intent: z.enum(['add_screen', 'modify_screen']), screen: ScreenRef.nullable() });
  const call = await provider.complete({ purpose: 'plan', schemaName: 'route', schema: toStrictSchema(m, { screen: doc.screens.map(s => s.id) }), maxOutputTokens: 200,
    instructions: 'Classify a demo author\'s request about their clickable app. "add_screen" when they want a NEW screen/page/step; "modify_screen" when they want to change content, wording, fields, buttons or layout of an EXISTING screen (screen = which one; the current screen unless another is named).',
    input: JSON.stringify({ request: req.instruction.slice(0, 1000), currentScreen: req.currentScreen ?? null, screens: doc.screens.map(s => ({ id: s.id, title: s.title })) }) });
  await onCall(call);
  const r = m.safeParse(call.json);
  if (!r.success) return { intent: req.currentScreen ? 'modify' : 'add', screen: req.currentScreen ?? null };
  return { intent: r.data.intent === 'add_screen' ? 'add' : 'modify', screen: r.data.screen ?? req.currentScreen ?? null };
}
