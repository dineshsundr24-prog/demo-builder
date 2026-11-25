// App structure by chat: the app menu (mobile tabs/drawer, portal sidebar) and the screen list
// (delete, reorder, rename, show/hide the menu). Same contract as screen edits: a reply plus small
// operations, applied deterministically and verified one by one, so a reply never claims a change
// that did not happen.
import { z } from 'zod';
import { toStrictSchema, clampToSchema, removeScreen, moveScreen, updateScreen, validateDocument, ScreenRef, Icon, ICON_NAMES, type DemoDocument } from '@demo/schema';
import type { LlmProvider, CompletionResult } from './provider.ts';
import { ProviderError } from './provider.ts';

export const MENU_LIMIT = { mobile: 5, portal: 10 } as const;

const MenuScreen = ScreenRef;
function flowModel() {
  return z.object({
    reply: z.string().min(1).max(400),
    operations: z.array(z.discriminatedUnion('op', [
      z.object({ op: z.literal('menuAdd'), screen: MenuScreen, label: z.string().min(1).max(24), icon: Icon, after: MenuScreen.nullable() }),
      z.object({ op: z.literal('menuUpdate'), screen: MenuScreen, label: z.string().max(24).nullable(), icon: Icon.nullable(), newScreen: MenuScreen.nullable() }),
      z.object({ op: z.literal('menuRemove'), screen: MenuScreen }),
      z.object({ op: z.literal('menuOrder'), screens: z.array(MenuScreen).min(1).max(12) }),
      z.object({ op: z.literal('menuStyle'), kind: z.enum(['tabs', 'drawer', 'sidebar', 'none']) }),
      z.object({ op: z.literal('screenDelete'), screen: ScreenRef }),
      z.object({ op: z.literal('screenMove'), screen: ScreenRef, after: ScreenRef.nullable() }),
      z.object({ op: z.literal('screenRename'), screen: ScreenRef, title: z.string().min(1).max(85) }),
      z.object({ op: z.literal('screenMenu'), screen: ScreenRef, show: z.boolean() }),
    ])).max(20),
  });
}
export type FlowOp = z.infer<ReturnType<typeof flowModel>>['operations'][number];

const FLOW_RULES = (channel: 'mobile' | 'portal') => `You manage the STRUCTURE of a clickable ${channel === 'mobile' ? 'mobile banking app' : 'staff banking web portal'} for its author: the app menu and the list of screens.
Return a short "reply" and the smallest list of "operations" that does what they asked:
- menuAdd / menuUpdate / menuRemove / menuOrder: the app menu (${channel === 'mobile' ? 'bottom tabs, at most 5 items; labels of 1-2 words' : 'left sidebar, at most 10 items'}). Each item opens one screen. menuUpdate can rename it, change its icon, or point it to another screen (newScreen).
- menuStyle: ${channel === 'mobile' ? '"tabs" (bottom bar) or "drawer" (side menu); "none" removes the menu' : '"sidebar"; "none" removes the menu'}.
- screenDelete: delete a screen (buttons that led to it are removed automatically). screenMove: put a screen after another (null = first). screenRename: change a screen title. screenMenu: show (true) or hide (false) the app menu on one screen (hide it on focused steps like sign-in, OTP, verification).
Rules: touch nothing the author did not ask about; only use listed screen ids; if the request is unclear, impossible, or would delete the last screen, return no operations and explain in "reply". The reply must describe exactly what the operations do. No ids in the reply.`;

/** Apply operations; each one is checked after it runs. Problems are returned, never silently skipped. */
export function applyFlowOps(doc: DemoDocument, ops: FlowOp[]): { doc: DemoDocument; problems: string[]; changes: string[] } {
  const problems: string[] = [], changes: string[] = [];
  const limit = MENU_LIMIT[doc.channel];
  const title = (d: DemoDocument, id: string) => d.screens.find(s => s.id === id)?.title ?? id;
  const has = (d: DemoDocument, id: string) => d.screens.some(s => s.id === id);
  const items = (d: DemoDocument) => d.shell.items;
  const withItems = (d: DemoDocument, next: DemoDocument['shell']['items']) => ({ ...d, shell: { ...d.shell, items: next, kind: next.length ? (d.shell.kind === 'none' ? (d.channel === 'mobile' ? 'tabs' : 'sidebar') : d.shell.kind) : d.shell.kind } as DemoDocument['shell'] });
  const icon = (v: unknown) => ((ICON_NAMES as readonly string[]).includes(String(v)) ? String(v) : 'circle');
  for (const op of ops) {
    const fail = (why: string) => problems.push(op.op + ': ' + why);
    switch (op.op) {
      case 'menuAdd': {
        if (!has(doc, op.screen)) { fail('unknown screen'); break; }
        if (items(doc).some(i => i.screen === op.screen)) { fail('"' + title(doc, op.screen) + '" is already in the menu'); break; }
        if (items(doc).length >= limit) { fail('the menu already has ' + limit + ' items (the maximum on ' + doc.channel + ')'); break; }
        const list = [...items(doc)], at = op.after ? list.findIndex(i => i.screen === op.after) + 1 : list.length;
        let id = 'menu-' + op.screen, n = 2; while (list.some(i => i.id === id)) id = 'menu-' + op.screen + '-' + n++;
        list.splice(at <= 0 ? list.length : at, 0, { id: id.slice(0, 64), label: op.label, icon: icon(op.icon), screen: op.screen });
        doc = withItems(doc, list);
        changes.push('Menu: added "' + op.label + '" → ' + title(doc, op.screen));
        break;
      }
      case 'menuUpdate': {
        const i = items(doc).findIndex(x => x.screen === op.screen);
        if (i < 0) { fail('"' + title(doc, op.screen) + '" is not in the menu'); break; }
        if (op.newScreen && !has(doc, op.newScreen)) { fail('unknown screen'); break; }
        const before = items(doc)[i];
        const after = { ...before, ...(op.label ? { label: op.label } : {}), ...(op.icon ? { icon: icon(op.icon) } : {}), ...(op.newScreen ? { screen: op.newScreen } : {}) };
        if (JSON.stringify(after) === JSON.stringify(before)) { fail('no change'); break; }
        doc = withItems(doc, items(doc).map((x, k) => (k === i ? after : x)));
        changes.push('Menu: "' + before.label + '"' + (after.label !== before.label ? ' renamed to "' + after.label + '"' : '') + (after.icon !== before.icon ? ' (new icon)' : '') + (after.screen !== before.screen ? ' now opens ' + title(doc, after.screen) : ''));
        break;
      }
      case 'menuRemove': {
        const it = items(doc).find(x => x.screen === op.screen);
        if (!it) { fail('"' + title(doc, op.screen) + '" is not in the menu'); break; }
        doc = withItems(doc, items(doc).filter(x => x !== it));
        changes.push('Menu: removed "' + it.label + '"');
        break;
      }
      case 'menuOrder': {
        const current = items(doc);
        const named = op.screens.map(s => current.find(i => i.screen === s)).filter((x): x is NonNullable<typeof x> => !!x);
        if (!named.length) { fail('none of those screens are in the menu'); break; }
        const next = [...named, ...current.filter(i => !named.includes(i))];
        if (next.map(i => i.id).join() === current.map(i => i.id).join()) { fail('already in that order'); break; }
        doc = withItems(doc, next);
        changes.push('Menu order: ' + next.map(i => i.label).join(' · '));
        break;
      }
      case 'menuStyle': {
        const allowed = doc.channel === 'mobile' ? ['tabs', 'drawer', 'none'] : ['sidebar', 'none'];
        if (!allowed.includes(op.kind)) { fail('"' + op.kind + '" is not available on ' + doc.channel); break; }
        if (doc.shell.kind === op.kind) { fail('already ' + op.kind); break; }
        doc = { ...doc, shell: { ...doc.shell, kind: op.kind } };
        changes.push(op.kind === 'none' ? 'Menu removed from the app' : 'Menu style: ' + (op.kind === 'tabs' ? 'bottom tabs' : op.kind === 'drawer' ? 'side drawer' : 'sidebar'));
        break;
      }
      case 'screenDelete': {
        if (!has(doc, op.screen)) { fail('unknown screen'); break; }
        if (doc.screens.length <= 1) { fail('a demo needs at least one screen'); break; }
        const name = title(doc, op.screen);
        doc = removeScreen(doc, op.screen);
        changes.push('Deleted screen "' + name + '" (links to it removed)');
        break;
      }
      case 'screenMove': {
        if (!has(doc, op.screen) || (op.after && !has(doc, op.after)) || op.after === op.screen) { fail('unknown or invalid screen'); break; }
        const ids = doc.screens.map(s => s.id), from = ids.indexOf(op.screen);
        const target = op.after ? ids.filter(x => x !== op.screen).indexOf(op.after) + 1 : 0;
        if (target === from) { fail('already there'); break; }
        let d = doc; // step with the editor's command until the screen is in place
        for (let guard = 0; guard < ids.length && d.screens.findIndex(s => s.id === op.screen) !== target; guard++) d = moveScreen(d, op.screen, d.screens.findIndex(s => s.id === op.screen) < target ? 1 : -1);
        doc = d;
        changes.push('Moved "' + title(doc, op.screen) + '" ' + (op.after ? 'after "' + title(doc, op.after) + '"' : 'to the start'));
        break;
      }
      case 'screenRename': {
        if (!has(doc, op.screen)) { fail('unknown screen'); break; }
        const before = title(doc, op.screen);
        if (before === op.title) { fail('already named that'); break; }
        doc = updateScreen(doc, op.screen, { title: op.title });
        changes.push('Renamed "' + before + '" to "' + op.title + '"');
        break;
      }
      case 'screenMenu': {
        if (!has(doc, op.screen)) { fail('unknown screen'); break; }
        const shell = op.show ? 'default' : 'hidden';
        if (doc.screens.find(s => s.id === op.screen)!.shell === shell) { fail('already ' + (op.show ? 'showing' : 'hiding') + ' the menu'); break; }
        doc = updateScreen(doc, op.screen, { shell });
        changes.push((op.show ? 'Menu shown on "' : 'Menu hidden on "') + title(doc, op.screen) + '"');
        break;
      }
    }
  }
  // Menu items must point at existing screens (a deleted screen leaves no dangling item).
  return { doc, problems, changes };
}

export type FlowResult = { document: DemoDocument; changes: string[]; reply: string; calls: CompletionResult[] };

export async function changeFlowWithAI(provider: LlmProvider, doc: DemoDocument, instruction: string, currentScreen: string | null, onCall: (call: CompletionResult) => Promise<void>, conversation: string[] = []): Promise<FlowResult> {
  const m = flowModel();
  const schema = toStrictSchema(m, { screen: doc.screens.map(s => s.id) });
  const input = JSON.stringify({
    request: instruction.slice(0, 2000), conversationSoFar: conversation, currentScreen,
    app: { name: doc.name, channel: doc.channel, menuStyle: doc.shell.kind, menuLimit: MENU_LIMIT[doc.channel] },
    menu: doc.shell.items.map(i => ({ label: i.label, icon: i.icon, screen: i.screen })),
    screens: doc.screens.map((s, i) => ({ position: i + 1, id: s.id, title: s.title, showsMenu: s.shell === 'default' })),
  });
  const calls: CompletionResult[] = [];
  const ask = async (extra: object = {}) => {
    try { const c = await provider.complete({ purpose: 'repair', instructions: FLOW_RULES(doc.channel), input: JSON.stringify({ ...JSON.parse(input), ...extra }), schemaName: 'flow_edit', schema, maxOutputTokens: 3000 }); calls.push(c); await onCall(c); return c; }
    catch (e) { if (e instanceof ProviderError && e.category === 'truncated') throw Object.assign(Error('The request was too long to process; try one change at a time.'), { category: 'parse' }); throw e; }
  };
  const run = (json: unknown) => {
    const raw: any = structuredClone(json);
    const parsed = m.safeParse(clampToSchema(m, raw));
    if (!parsed.success) return { reply: '', doc, problems: ['invalid operations: ' + parsed.error.issues[0]?.message], changes: [] as string[], ops: [] as FlowOp[] };
    const out = applyFlowOps(doc, parsed.data.operations);
    const errors = validateDocument(out.doc).filter(i => i.severity === 'error');
    return { reply: parsed.data.reply, ...out, problems: [...out.problems, ...errors.slice(0, 3).map(e => e.message)], ops: parsed.data.operations };
  };
  let out = run((await ask()).json);
  if (out.problems.length && out.ops.length) {
    const retry = run((await ask({ task: 'Some operations could not be applied. Return corrected operations for the ORIGINAL app, or none with an explanation.', problems: out.problems, previousOperations: out.ops })).json);
    if (retry.problems.length && retry.ops.length) throw Object.assign(Error('I could not make that change (' + retry.problems[0] + '). Try one change at a time, or use Edit mode.'), { category: 'parse' });
    out = retry;
  }
  const changed = JSON.stringify(out.doc) !== JSON.stringify(doc);
  const reply = !changed && out.ops.length ? 'I made no change: the app already looks like that. Tell me more specifically what should change.' : out.reply;
  return { document: changed ? out.doc : doc, changes: changed ? out.changes : ['No visible change'], reply, calls };
}
