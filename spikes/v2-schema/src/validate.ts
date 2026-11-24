// One validator for every layer (generation, editor, import, publish).
// Structural rules come from the registry (Zod); semantic rules live here.
// Every issue has an exact path, a code and a human message - never a boolean.
import { Document, Screen, components } from './registry.ts';

export type Issue = { path: string; code: string; message: string; severity: 'error' | 'warning' };
const containerTypes = new Set(components.filter(c => c.container).map(c => c.type));
const inputTypes = new Set(['Input', 'Select', 'Checkbox', 'Upload']);
const BINDING = /\{\{\s*([a-zA-Z]+)\.([a-zA-Z0-9_.]+)\s*\}\}/g;

export type Context = { screenIds: Set<string>; collections: Map<string, Set<string>>; templateIds: Set<string>; stateKeys?: Set<string> };

function zodIssues(result: any, prefix: string): Issue[] {
  if (result.success) return [];
  return result.error.issues.map((i: any) => ({ path: prefix + i.path.map((p: any) => typeof p === 'number' ? '[' + p + ']' : '.' + p).join(''), code: 'schema.' + i.code, message: i.message, severity: 'error' as const }));
}

export function validateScreen(screen: unknown, ctx: Context, prefix = 'screen'): Issue[] {
  const structural = zodIssues(Screen.safeParse(screen), prefix);
  if (structural.length) return structural;
  const issues: Issue[] = [];
  const s = screen as any;
  const ids = new Set<string>();
  const walk = (node: any, path: string, inForm: boolean, inTableScreen: boolean) => {
    if (ids.has(node.id)) issues.push({ path: path + '.id', code: 'id.duplicate', message: 'Duplicate component id "' + node.id + '" on this screen', severity: 'error' });
    ids.add(node.id);
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') for (const m of value.matchAll(BINDING)) {
        const [, scope, rest] = m;
        if (!['state', 'record', 'params'].includes(scope)) issues.push({ path: path + '.' + key, code: 'binding.scope', message: 'Unknown binding scope "' + scope + '"', severity: 'error' });
        if (scope === 'state' && ctx.stateKeys && !ctx.stateKeys.has(rest)) issues.push({ path: path + '.' + key, code: 'binding.state', message: 'No input writes state "' + rest + '"', severity: 'warning' });
      }
    }
    const actions = [...(node.actions || []), ...(node.onSubmit || [])];
    actions.forEach((a: any, i: number) => {
      const ap = path + (node.onSubmit ? '.onSubmit' : '.actions') + '[' + i + ']';
      if (a.type === 'navigate' && !ctx.screenIds.has(a.screen)) issues.push({ path: ap + '.screen', code: 'route.unknown', message: 'Destination "' + a.screen + '" is not a screen', severity: 'error' });
      if (a.type === 'navigate' && a.screen === s.id) issues.push({ path: ap + '.screen', code: 'route.self', message: 'Button navigates to its own screen', severity: 'warning' });
      if (a.type === 'submit' && !inForm && node.type !== 'Form') issues.push({ path: ap, code: 'action.submit-outside-form', message: 'submit is only valid inside a Form', severity: 'error' });
    });
    if (inputTypes.has(node.type) && !inForm) issues.push({ path, code: 'input.outside-form', message: node.type + ' should be inside a Form to be validated', severity: 'warning' });
    if (node.type === 'Table') {
      const fields = ctx.collections.get(node.collection);
      if (!fields) issues.push({ path: path + '.collection', code: 'data.collection', message: 'Unknown collection "' + node.collection + '"', severity: 'error' });
      else node.columns.forEach((c: any, i: number) => { if (!fields.has(c.field)) issues.push({ path: path + '.columns[' + i + '].field', code: 'data.field', message: 'Collection "' + node.collection + '" has no field "' + c.field + '"', severity: 'error' }); });
      if (node.rowAction && !ctx.screenIds.has(node.rowAction.screen)) issues.push({ path: path + '.rowAction.screen', code: 'route.unknown', message: 'Row destination "' + node.rowAction.screen + '" is not a screen', severity: 'error' });
    }
    if (node.type === 'Template' && !ctx.templateIds.has(node.template)) issues.push({ path: path + '.template', code: 'template.unknown', message: 'Unknown template "' + node.template + '"', severity: 'error' });
    if (node.type === 'Template' && node.next && !ctx.screenIds.has(node.next)) issues.push({ path: path + '.next', code: 'route.unknown', message: 'Template destination "' + node.next + '" is not a screen', severity: 'error' });
    if (node.type === 'Form' && inForm) issues.push({ path, code: 'form.nested', message: 'Forms cannot be nested', severity: 'error' });
    if (containerTypes.has(node.type)) node.children.forEach((c: any, i: number) => walk(c, path + '.children[' + i + ']', inForm || node.type === 'Form', inTableScreen));
  };
  s.children.forEach((c: any, i: number) => walk(c, prefix + '.children[' + i + ']', false, false));
  return issues;
}

export function contextFor(doc: any, templateIds: string[]): Context {
  return {
    screenIds: new Set(doc.screens.map((s: any) => s.id)),
    collections: new Map(doc.collections.map((c: any) => [c.id, new Set(c.fields.map((f: any) => f.id))])),
    templateIds: new Set(templateIds),
  };
}

export function validateDocument(doc: unknown, templateIds: string[]): Issue[] {
  const structural = zodIssues(Document.safeParse(doc), 'doc');
  if (structural.length) return structural;
  const d = doc as any;
  const ctx = contextFor(d, templateIds);
  const issues: Issue[] = [];
  const seen = new Set<string>();
  d.screens.forEach((s: any, i: number) => { if (seen.has(s.id)) issues.push({ path: 'doc.screens[' + i + '].id', code: 'id.duplicate-screen', message: 'Duplicate screen id "' + s.id + '"', severity: 'error' }); seen.add(s.id); });
  d.shell.items.forEach((it: any, i: number) => { if (!ctx.screenIds.has(it.screen)) issues.push({ path: 'doc.shell.items[' + i + '].screen', code: 'route.unknown', message: 'Menu destination "' + it.screen + '" is not a screen', severity: 'error' }); });
  d.screens.forEach((s: any, i: number) => issues.push(...validateScreen(s, ctx, 'doc.screens[' + i + ']')));
  issues.push(...reachability(d));
  return issues;
}

// Flow lint: every screen should be reachable from the first screen.
export function reachability(d: any): Issue[] {
  const edges = new Map<string, Set<string>>();
  const add = (from: string, to: string) => { if (!edges.has(from)) edges.set(from, new Set()); edges.get(from)!.add(to); };
  const shellTargets = d.shell.items.map((x: any) => x.screen);
  for (const s of d.screens) {
    const visit = (n: any) => {
      for (const a of [...(n.actions || []), ...(n.onSubmit || [])]) if (a.type === 'navigate') add(s.id, a.screen);
      if (n.rowAction) add(s.id, n.rowAction.screen);
      if (n.next) add(s.id, n.next);
      (n.children || []).forEach(visit);
    };
    s.children.forEach(visit);
    if (s.shell !== 'hidden') shellTargets.forEach((t: string) => add(s.id, t));
  }
  const seen = new Set([d.screens[0].id]);
  const queue = [d.screens[0].id];
  while (queue.length) for (const n of edges.get(queue.shift()!) || []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  return d.screens.filter((s: any) => !seen.has(s.id)).map((s: any) => ({ path: 'doc.screens[' + d.screens.indexOf(s) + ']', code: 'flow.unreachable', message: 'Screen "' + s.title + '" cannot be reached from "' + d.screens[0].title + '"', severity: 'warning' as const }));
}
