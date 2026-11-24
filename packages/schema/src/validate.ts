// The one validator used by generation, editor, import, migration and publish.
// Structure comes from the registry (Zod); semantics are checked here.
// Every issue has an exact path, a stable code and a human-readable message.
import { DemoDocument, Screen } from './document.ts';
import { containerTypes, inputTypes, type NodeT } from './registry.ts';
import { templateById, expandTemplate } from './templates.ts';
import { bindingsIn } from './bindings.ts';

export type Severity = 'error' | 'warning';
export type Issue = { path: string; code: string; message: string; severity: Severity; screenId?: string };
export type DocContext = {
  channel: 'mobile' | 'portal';
  screenIds: Set<string>;
  collections: Map<string, { key: string; fields: Set<string> }>;
  stateKeys: Set<string>;           // keys written by any input anywhere
  recordScreens: Set<string>;       // screens that receive a record
};

const issue = (path: string, code: string, message: string, severity: Severity = 'error'): Issue => ({ path, code, message, severity });
function zodIssues(result: any, prefix: string): Issue[] {
  if (result.success) return [];
  return result.error.issues.slice(0, 50).map((i: any) => issue(prefix + i.path.map((p: any) => typeof p === 'number' ? '[' + p + ']' : '.' + String(p)).join(''), 'schema.' + i.code, i.message));
}
/** Visit nodes depth-first, including the nodes templates expand to. */
export function walk(nodes: NodeT[], path: string, visit: (n: NodeT, path: string, ancestors: NodeT[]) => void, ancestors: NodeT[] = []) {
  nodes.forEach((n, i) => {
    const p = path + '[' + i + ']';
    visit(n, p, ancestors);
    if (Array.isArray(n.children)) walk(n.children, p + '.children', visit, [...ancestors, n]);
    if (n.type === 'Template') walk(expandTemplate(n), p + '.expanded', visit, [...ancestors, n]);
  });
}
function actionsOf(n: NodeT): any[] { return Array.isArray(n.actions) ? n.actions as any[] : []; }

export function documentContext(doc: DemoDocument): DocContext {
  const stateKeys = new Set<string>(), recordScreens = new Set<string>();
  for (const s of doc.screens) walk(s.children as NodeT[], '', n => {
    if (inputTypes.has(n.type) && typeof n.field === 'string') stateKeys.add(n.field);
    for (const a of actionsOf(n)) {
      if (a.type === 'setState') stateKeys.add(a.key);
      if (a.type === 'navigate' && a.passRecord) recordScreens.add(a.screen);
    }
    const ra = (n.rowAction as any)?.screen ?? (n.itemAction as any)?.screen;
    if (ra) recordScreens.add(ra);
  });
  return {
    channel: doc.channel, screenIds: new Set(doc.screens.map(s => s.id)), stateKeys, recordScreens,
    collections: new Map(doc.collections.map(c => [c.id, { key: c.key, fields: new Set(c.fields.map(f => f.id)) }])),
  };
}

export function validateScreen(screen: unknown, ctx: DocContext, prefix = 'screen'): Issue[] {
  const structural = zodIssues(Screen.safeParse(screen), prefix);
  if (structural.length) return structural;
  const s = screen as Screen;
  const out: Issue[] = [];
  const ids = new Map<string, string>();
  const forms = new Set<string>();
  walk(s.children as NodeT[], prefix + '.children', n => { if (n.type === 'Form') forms.add(n.id); });
  walk(s.children as NodeT[], prefix + '.children', (n, path, ancestors) => {
    if (ids.has(n.id)) out.push(issue(path + '.id', 'id.duplicate', 'Component id "' + n.id + '" is used twice on this screen (also at ' + ids.get(n.id) + ')'));
    else ids.set(n.id, path);
    const inForm = ancestors.some(a => a.type === 'Form');
    // Bindings
    for (const [key, value] of Object.entries(n)) {
      const texts = typeof value === 'string' ? [[key, value]] : key === 'items' && Array.isArray(value) ? value.flatMap((it: any, i: number) => Object.entries(it || {}).filter(([, v]) => typeof v === 'string').map(([k, v]) => [key + '[' + i + '].' + k, v])) : [];
      for (const [k, text] of texts as [string, string][]) for (const b of bindingsIn(text)) {
        if (!b.valid) out.push(issue(path + '.' + k, 'binding.syntax', 'Invalid binding ' + b.raw + ' (use {{state.x}}, {{record.x}} or {{params.x}}, optional | aed, date, upper, mask)'));
        else if (b.scope === 'state' && !ctx.stateKeys.has(b.path!)) out.push(issue(path + '.' + k, 'binding.state-unwritten', 'No input or action writes state "' + b.path + '"', 'warning'));
        else if (b.scope === 'record' && !ctx.recordScreens.has(s.id)) out.push(issue(path + '.' + k, 'binding.no-record', 'This screen shows {{record.' + b.path + '}} but nothing opens it with a record', 'warning'));
      }
    }
    // Actions
    actionsOf(n).forEach((a, i) => {
      const ap = path + '.actions[' + i + ']';
      if (a.type === 'navigate' && !ctx.screenIds.has(a.screen)) out.push(issue(ap + '.screen', 'route.unknown', 'Destination "' + a.screen + '" is not a screen'));
      if (a.type === 'navigate' && a.screen === s.id) out.push(issue(ap + '.screen', 'route.self', 'Button navigates to its own screen', 'warning'));
      if ((a.type === 'submit' || a.type === 'reset') && a.form && !forms.has(a.form)) out.push(issue(ap + '.form', 'form.unknown', 'No form "' + a.form + '" on this screen'));
      if ((a.type === 'submit' || a.type === 'reset') && !a.form && !inForm) out.push(issue(ap, 'form.missing', a.type + ' needs an enclosing Form or a form id' + (forms.size === 1 ? ' (this screen has form "' + [...forms][0] + '")' : '')));
    });
    if (inputTypes.has(n.type) && !inForm) out.push(issue(path, 'input.outside-form', n.type + ' "' + String(n.label) + '" is not inside a Form, so required checks will not run', 'warning'));
    if (n.type === 'Form' && inForm) out.push(issue(path, 'form.nested', 'Forms cannot be nested'));
    if (containerTypes.has(n.type) && Array.isArray(n.children) && !n.children.length) out.push(issue(path + '.children', 'container.empty', n.type + ' has no content', 'warning'));
    // Data
    if (n.type === 'Table' || n.type === 'List') {
      const c = ctx.collections.get(String(n.collection));
      if (!c) out.push(issue(path + '.collection', 'data.collection', 'Unknown collection "' + String(n.collection) + '"'));
      else {
        const fieldRefs: [string, unknown][] = n.type === 'Table'
          ? [...(n.columns as any[]).map((col, i) => ['columns[' + i + '].field', col.field] as [string, unknown]), ['filterField', n.filterField]]
          : [['titleField', n.titleField], ['subtitleField', n.subtitleField], ['badgeField', n.badgeField]];
        for (const [k, f] of fieldRefs) if (typeof f === 'string' && f && !c.fields.has(f)) out.push(issue(path + '.' + k, 'data.field', 'Collection "' + String(n.collection) + '" has no field "' + f + '"'));
      }
      const target = (n.rowAction as any)?.screen ?? (n.itemAction as any)?.screen;
      if (target && !ctx.screenIds.has(target)) out.push(issue(path + (n.type === 'Table' ? '.rowAction' : '.itemAction') + '.screen', 'route.unknown', 'Row destination "' + target + '" is not a screen'));
    }
    if (n.type === 'Template') {
      const t = templateById.get(String(n.template));
      if (!t) out.push(issue(path + '.template', 'template.unknown', 'Unknown template "' + String(n.template) + '"'));
      else if (!t.channels.includes(ctx.channel)) out.push(issue(path + '.template', 'template.channel', t.label + ' is designed for ' + t.channels.join('/'), 'warning'));
      if (typeof n.next === 'string' && !ctx.screenIds.has(n.next)) out.push(issue(path + '.next', 'route.unknown', 'Template destination "' + n.next + '" is not a screen'));
    }
  });
  return out.map(i => ({ ...i, screenId: s.id }));
}

export function validateDocument(doc: unknown): Issue[] {
  const structural = zodIssues(DemoDocument.safeParse(doc), 'doc');
  if (structural.length) return structural;
  const d = doc as DemoDocument;
  const ctx = documentContext(d);
  const out: Issue[] = [];
  const seen = new Set<string>();
  d.screens.forEach((s, i) => { if (seen.has(s.id)) out.push(issue('doc.screens[' + i + '].id', 'id.duplicate-screen', 'Two screens use id "' + s.id + '"')); seen.add(s.id); });
  d.collections.forEach((c, i) => {
    const fields = new Set(c.fields.map(f => f.id));
    if (!fields.has(c.key)) out.push(issue('doc.collections[' + i + '].key', 'data.key', 'Key "' + c.key + '" is not a field of ' + c.label));
    const keys = new Set<string>();
    c.rows.forEach((r, j) => {
      for (const k of Object.keys(r)) if (!fields.has(k)) out.push(issue('doc.collections[' + i + '].rows[' + j + '].' + k, 'data.row-field', 'Row has unknown field "' + k + '"', 'warning'));
      if (keys.has(r[c.key])) out.push(issue('doc.collections[' + i + '].rows[' + j + ']', 'data.key-duplicate', 'Duplicate key "' + r[c.key] + '"')); keys.add(r[c.key]);
    });
  });
  const items = d.shell.items.flatMap((it, i) => [[it, 'doc.shell.items[' + i + ']'] as const, ...(it.children || []).map((c, j) => [c, 'doc.shell.items[' + i + '].children[' + j + ']'] as const)]);
  for (const [it, p] of items) if (!ctx.screenIds.has(it.screen)) out.push(issue(p + '.screen', 'route.unknown', 'Menu item "' + it.label + '" points to missing screen "' + it.screen + '"'));
  if (d.channel === 'mobile' && d.shell.kind === 'sidebar') out.push(issue('doc.shell.kind', 'shell.channel', 'A sidebar is a portal pattern; mobile apps normally use tabs or a drawer', 'warning'));
  if (d.channel === 'portal' && d.shell.kind === 'tabs') out.push(issue('doc.shell.kind', 'shell.channel', 'Bottom tabs are a mobile pattern; portals normally use a sidebar', 'warning'));
  d.screens.forEach((s, i) => out.push(...validateScreen(s, ctx, 'doc.screens[' + i + ']')));
  out.push(...flowLint(d));
  return out;
}

/** Navigation graph derived from the document itself (Decision D4). */
export function flowEdges(d: DemoDocument) {
  const edges: { from: string; to: string; via: string; path: string }[] = [];
  d.screens.forEach((s, i) => walk(s.children as NodeT[], 'doc.screens[' + i + '].children', (n, path) => {
    actionsOf(n).forEach(a => { if (a.type === 'navigate') edges.push({ from: s.id, to: a.screen, via: String(n.label ?? n.id), path }); });
    const r = (n.rowAction as any) ?? (n.itemAction as any);
    if (r?.screen) edges.push({ from: s.id, to: r.screen, via: r.label ?? 'Item', path });
  }));
  for (const s of d.screens) if (s.shell !== 'hidden' && d.shell.kind !== 'none') for (const it of d.shell.items.flatMap(x => [x, ...(x.children || [])])) edges.push({ from: s.id, to: it.screen, via: 'Menu: ' + it.label, path: 'doc.shell' });
  return edges;
}
export function flowLint(d: DemoDocument): Issue[] {
  const edges = flowEdges(d);
  const seen = new Set([d.screens[0].id]), queue = [d.screens[0].id];
  while (queue.length) { const cur = queue.shift()!; for (const e of edges) if (e.from === cur && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); } }
  const out: Issue[] = [];
  d.screens.forEach((s, i) => {
    if (!seen.has(s.id)) out.push({ ...issue('doc.screens[' + i + ']', 'flow.unreachable', '"' + s.title + '" cannot be reached from "' + d.screens[0].title + '"', 'warning'), screenId: s.id });
    if (i > 0 && !edges.some(e => e.from === s.id) && s.shell === 'hidden') out.push({ ...issue('doc.screens[' + i + ']', 'flow.dead-end', '"' + s.title + '" has no way forward or back', 'warning'), screenId: s.id });
  });
  return out;
}
export const errorsOnly = (issues: Issue[]) => issues.filter(i => i.severity === 'error');
