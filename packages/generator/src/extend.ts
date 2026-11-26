// EXTEND (Phase A3): evolve an existing application demo with a newly approved story, non-destructively.
//   1. proposeExtension: one AI call against the exact baseline -> a change plan (new / changed / unchanged /
//      possibly obsolete screens, navigation, open questions). Nothing changes yet.
//   2. The user approves items. Removals are never pre-selected.
//   3. applyExtension: applies only the approved items (new screens via the add-screen engine, changes via the
//      screen editor, removals deterministically), records traceability, then checks every journey: screens that
//      were reachable stay reachable, new screens are reachable, and no new validation errors appear.
import { z } from 'zod';
import { toStrictSchema, clampToSchema, removeScreen, updateScreen, validateDocument, flowEdges, type DemoDocument, type Screen, type TraceLink } from '@demo/schema';
import type { CompletionResult, LlmProvider } from './provider.ts';
import { addScreenWithAI, modifyScreenWithAI } from './assist.ts';
import { screenText, shownShare } from './design.ts';

export type ExtendStory = { id: string; title: string; text?: string; version?: number };
export type ExtendInput = { story: ExtendStory; criteria: { id: string; text: string }[]; rules?: { id: string; text: string }[]; prompt?: string };
export type ChangeItem =
  | { key: string; kind: 'add'; title: string; purpose: string; details: string[]; criteria: string[]; openFrom: string | null; addToMenu: boolean }
  | { key: string; kind: 'modify'; screenId: string; title: string; change: string; criteria: string[]; sharedWith: string[] }
  | { key: string; kind: 'remove'; screenId: string; title: string; reason: string; sharedWith: string[] };
export type ChangePlan = {
  story: ExtendStory; summary: string; items: ChangeItem[]; unchanged: { screenId: string; title: string }[];
  /** Navigation that the approved items would add (shown before applying). */ navigation: string[];
  gaps: string[]; /** Criteria no change addresses and no existing screen demonstrates. */ uncovered: string[];
};
export type JourneyCheck = { passed: boolean; reachableBefore: number; reachableAfter: number; lostScreens: string[]; unreachableNew: string[]; newErrors: string[] };
export type ExtendResult = { document: DemoDocument; applied: { key: string; summary: string[] }[]; journey: JourneyCheck };

const INSTRUCTIONS = `You extend an EXISTING clickable demo app so it also demonstrates a newly approved user story.
Propose the smallest set of changes. Rules:
- Keep everything that works: an existing screen is changed only when the story needs something on it (e.g. an entry point, a new field, a new status). Never rebuild existing screens.
- "add" for each new screen the story needs (title 2-4 words, purpose, 3-6 concrete details consistent with the business rules, the criteria it demonstrates, openFrom: the existing screen whose button or menu opens it, or null when another NEW screen leads to it; addToMenu only for a new main destination).
- "modify" for each existing screen that must change: description = a precise instruction for the editor (what to add or change and where), plus the criteria it demonstrates.
- "remove_candidate" only when this story clearly makes an existing screen obsolete; explain why. The user decides.
- Cover every acceptance criterion with at least one add or modify, unless an existing screen already demonstrates it.
- Never invent business rules, limits or fees; list missing information under gaps as short questions.
- Use the existing screen ids exactly.`;

function model(screenIds: string[], criteriaIds: string[]) {
  const Crit = criteriaIds.length ? z.enum(criteriaIds as [string, ...string[]]) : z.string().max(80);
  const Existing = z.enum(screenIds as [string, ...string[]]);
  return z.object({
    summary: z.string().min(1).max(400),
    changes: z.array(z.object({
      action: z.enum(['add', 'modify', 'remove_candidate']),
      screen: Existing.nullable().describe('modify / remove_candidate: the existing screen id; add: null'),
      title: z.string().min(2).max(40), description: z.string().min(5).max(600),
      details: z.array(z.string().min(2).max(100)).max(6), criteria: z.array(Crit).max(10),
      openFrom: Existing.nullable(), addToMenu: z.boolean(),
    })).max(12),
    gaps: z.array(z.string().min(5).max(160)).max(5),
  });
}
/** Other stories a screen already demonstrates (changing it affects their coverage too). */
const otherStories = (s: Screen | undefined, story: string) => [...new Set((s?.trace ?? []).map(t => t.story).filter(x => x !== story))];

export async function proposeExtension(provider: LlmProvider, doc: DemoDocument, input: ExtendInput): Promise<{ plan: ChangePlan; call: CompletionResult }> {
  const ids = doc.screens.map(s => s.id), crit = input.criteria.map(c => c.id);
  const m = model(ids, crit);
  const outline = (s: Screen) => ({ id: s.id, title: s.title, inMenu: doc.shell.items.some(i => i.screen === s.id), opens: [...new Set(flowEdges(doc).filter(e => e.from === s.id).map(e => e.to))],
    content: screenText(s).slice(0, 400), demonstrates: (s.trace ?? []).map(t => t.story + ': ' + t.criteria.join(', ')) });
  const call = await provider.complete({ purpose: 'plan', instructions: INSTRUCTIONS, schemaName: 'change_plan', schema: toStrictSchema(m), maxOutputTokens: 4000,
    input: JSON.stringify({ app: { name: doc.name, channel: doc.channel, menu: doc.shell.items.map(i => i.label), screens: doc.screens.map(outline) },
      story: input.story, acceptanceCriteria: input.criteria, businessRules: input.rules ?? [], reviewedPrompt: (input.prompt ?? '').slice(0, 6000) }) });
  const raw: any = structuredClone(call.json);
  for (const c of raw?.changes ?? []) if (Array.isArray(c?.criteria)) c.criteria = c.criteria.filter((x: unknown) => !crit.length || crit.includes(String(x)));
  const parsed = m.safeParse(clampToSchema(m, raw));
  if (!parsed.success) throw Object.assign(Error('The change plan did not match its schema: ' + parsed.error.issues[0]?.message), { category: 'parse' });
  return { plan: normalizeChangePlan(doc, input, parsed.data), call };
}

/** Deterministic clean-up: one entry per existing screen, unique new titles, removals explained, coverage gaps listed. */
export function normalizeChangePlan(doc: DemoDocument, input: ExtendInput, out: { summary: string; changes: any[]; gaps: string[] }): ChangePlan {
  const items: ChangeItem[] = [], touched = new Set<string>(), titles = new Set(doc.screens.map(s => s.title.toLowerCase()));
  let n = 0;
  for (const c of out.changes) {
    const key = 'c' + ++n;
    const existing = c.screen ? doc.screens.find(s => s.id === c.screen) : undefined;
    if (c.action === 'add') {
      if (titles.has(c.title.toLowerCase())) continue; // already exists: not a new screen
      titles.add(c.title.toLowerCase());
      items.push({ key, kind: 'add', title: c.title, purpose: c.description, details: c.details ?? [], criteria: c.criteria ?? [], openFrom: c.openFrom ?? null, addToMenu: !!c.addToMenu });
    } else if (existing && !touched.has(existing.id)) {
      touched.add(existing.id);
      if (c.action === 'modify') items.push({ key, kind: 'modify', screenId: existing.id, title: existing.title, change: c.description, criteria: c.criteria ?? [], sharedWith: otherStories(existing, input.story.id) });
      else items.push({ key, kind: 'remove', screenId: existing.id, title: existing.title, reason: c.description, sharedWith: otherStories(existing, input.story.id) });
    }
  }
  // New screens that open from nowhere and are not reached by another new screen get the first screen as entry.
  const title = (id: string | null) => doc.screens.find(s => s.id === id)?.title ?? '';
  const navigation = items.flatMap(i => i.kind !== 'add' ? [] : [...(i.openFrom ? ['"' + title(i.openFrom) + '" gets a link to "' + i.title + '"'] : []), ...(i.addToMenu ? ['App menu gets "' + i.title + '"'] : [])]);
  const covered = new Set([...items.flatMap(i => (i.kind === 'remove' ? [] : i.criteria)), ...doc.screens.flatMap(s => (s.trace ?? []).filter(t => t.story === input.story.id).flatMap(t => t.criteria))]);
  return { story: input.story, summary: out.summary, items, navigation, gaps: out.gaps ?? [],
    unchanged: doc.screens.filter(s => !touched.has(s.id)).map(s => ({ screenId: s.id, title: s.title })),
    uncovered: input.criteria.filter(c => !covered.has(c.id)).map(c => c.id) };
}

/** Record that a screen demonstrates these criteria (merged with its existing trace; other stories untouched). */
export function addTrace(doc: DemoDocument, screenId: string, story: string, criteria: { id: string; text: string }[]): DemoDocument {
  if (!criteria.length) return doc;
  return { ...doc, screens: doc.screens.map(s => {
    if (s.id !== screenId) return s;
    const text = screenText(s), ids = new Set(criteria.map(c => c.id));
    const kept = (s.trace ?? []).map(t => (t.story === story && t.source === 'generated' ? { ...t, criteria: t.criteria.filter(c => !ids.has(c)) } : t)).filter(t => t.criteria.length);
    const groups = new Map<string, TraceLink>();
    for (const c of criteria) {
      const share = shownShare(s, c.text, text), confidence = share >= 0.5 ? 'high' : share >= 0.25 ? 'medium' : 'low';
      const g = groups.get(confidence) ?? { story, criteria: [], confidence, source: 'generated' as const };
      g.criteria.push(c.id); groups.set(confidence, g);
    }
    return { ...s, trace: [...kept, ...groups.values()].slice(0, 10) };
  }) };
}

const reachable = (d: DemoDocument) => {
  const edges = flowEdges(d), seen = new Set([d.screens[0].id]), queue = [d.screens[0].id];
  while (queue.length) { const cur = queue.shift()!; for (const e of edges) if (e.from === cur && !seen.has(e.to)) { seen.add(e.to); queue.push(e.to); } }
  return seen;
};
/** Journey check: every screen reachable before is still reachable; new screens are reachable; no new errors. */
export function journeyCheck(before: DemoDocument, after: DemoDocument, added: string[]): JourneyCheck {
  const b = reachable(before), a = reachable(after), exists = new Set(after.screens.map(s => s.id));
  const lostScreens = [...b].filter(id => exists.has(id) && !a.has(id)).map(id => after.screens.find(s => s.id === id)!.title);
  const unreachableNew = added.filter(id => !a.has(id)).map(id => after.screens.find(s => s.id === id)?.title ?? id);
  const known = new Set(validateDocument(before).filter(i => i.severity === 'error').map(i => i.message));
  const newErrors = validateDocument(after).filter(i => i.severity === 'error' && !known.has(i.message)).map(i => i.message).slice(0, 10);
  return { passed: !lostScreens.length && !unreachableNew.length && !newErrors.length, reachableBefore: b.size, reachableAfter: a.size, lostScreens, unreachableNew, newErrors };
}

export async function applyExtension(providers: { add: LlmProvider; edit: LlmProvider }, base: DemoDocument, plan: ChangePlan, approvedKeys: string[], criteria: { id: string; text: string }[],
  hooks: { onCall?: (call: CompletionResult) => Promise<void>; onStep?: (done: number, total: number, label: string) => void } = {}): Promise<ExtendResult> {
  const chosen = plan.items.filter(i => approvedKeys.includes(i.key));
  if (!chosen.length) throw Object.assign(Error('Choose at least one change to apply'), { category: 'bad_request' });
  const byId = new Map(criteria.map(c => [c.id, c]));
  const crit = (ids: string[]) => ids.map(id => byId.get(id)).filter((c): c is { id: string; text: string } => !!c);
  const onCall = hooks.onCall ?? (async () => {});
  // New screens first (so changed screens can link to them), then changes, then approved removals.
  const order = [...chosen.filter(i => i.kind === 'add'), ...chosen.filter(i => i.kind === 'modify'), ...chosen.filter(i => i.kind === 'remove')];
  let doc = base; const applied: ExtendResult['applied'] = [], added: string[] = [], newIds = new Map<string, string>();
  for (const [k, item] of order.entries()) {
    hooks.onStep?.(k, order.length, item.kind === 'add' ? 'Adding "' + item.title + '"' : item.kind === 'modify' ? 'Changing "' + item.title + '"' : 'Removing "' + item.title + '"');
    if (item.kind === 'add') {
      const requirement = item.title + ': ' + item.purpose + (item.details.length ? '\n- ' + item.details.join('\n- ') : '') + (item.criteria.length ? '\nDemonstrates: ' + crit(item.criteria).map(c => c.text).join(' | ') : '');
      const from = item.openFrom && doc.screens.some(s => s.id === item.openFrom) ? item.openFrom : (added.length ? added[added.length - 1] : doc.screens[0].id);
      const r = await addScreenWithAI(providers.add, doc, { requirement, from, addToMenu: item.addToMenu }, (_k, c) => onCall(c));
      doc = updateScreen(r.document, r.screenId, { title: item.title.slice(0, 85) });
      doc = addTrace(doc, r.screenId, plan.story.id, crit(item.criteria));
      added.push(r.screenId); newIds.set(item.key, r.screenId);
      applied.push({ key: item.key, summary: r.changes });
    } else if (item.kind === 'modify') {
      if (!doc.screens.some(s => s.id === item.screenId)) continue;
      // New screens this screen already opens (the add step linked them): another button or card would duplicate the entry.
      const linked = new Set(flowEdges(doc).filter(e => e.from === item.screenId).map(e => e.to));
      const title = (id: string) => doc.screens.find(s => s.id === id)!.title + ' (' + id + ')';
      const instruction = item.change + (item.criteria.length ? '\nThis must demonstrate: ' + crit(item.criteria).map(c => c.text).join(' | ') : '')
        + (added.some(id => linked.has(id)) ? '\nAlready linked from this screen, do NOT add another button, card or shortcut to: ' + added.filter(id => linked.has(id)).map(title).join(', ') + '. If the change was only about linking to them, make no change.' : '')
        + (added.some(id => !linked.has(id)) ? '\nNew screens you may link to: ' + added.filter(id => !linked.has(id)).map(title).join(', ') : '');
      const r = await modifyScreenWithAI(providers.edit, doc, item.screenId, instruction, (_k, c) => onCall(c));
      doc = addTrace(r.document, item.screenId, plan.story.id, crit(item.criteria));
      applied.push({ key: item.key, summary: r.changes });
    } else {
      if (doc.screens.length < 2 || !doc.screens.some(s => s.id === item.screenId)) continue;
      doc = removeScreen(doc, item.screenId);
      applied.push({ key: item.key, summary: ['Removed "' + item.title + '"'] });
    }
  }
  hooks.onStep?.(order.length, order.length, 'Checking every journey');
  return { document: doc, applied, journey: journeyCheck(base, doc, added) };
}
