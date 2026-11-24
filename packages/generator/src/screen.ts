// One screen per call: strict schema -> validate -> at most one targeted repair -> marked fallback.
import { aiScreenSchema, componentGuide, stripNulls, validateScreen, documentContext, type DemoDocument, type Issue, type Screen, type NodeT } from '@demo/schema';
import type { LlmProvider, CompletionResult } from './provider.ts';
import { ProviderError } from './provider.ts';
import type { Plan, PlanScreen } from './plan.ts';

export type ScreenOutcome = { screen: Screen; status: 'valid' | 'repaired' | 'fallback'; issues: Issue[]; calls: CompletionResult[]; failure?: string };

export function screenInstructions(channel: 'mobile' | 'portal') {
  // Static per channel, so the provider can cache this prefix across every screen call.
  return `You design ONE screen of a fictional ${channel === 'mobile' ? 'mobile banking app (390px wide)' : 'staff web portal (desktop)'} as a component tree for a declarative renderer.
Rules:
- Return the screen with the given id and title. Use only the schema's components and actions. Keep it focused: 3-12 top-level components.
- Put inputs inside a Form. A Button with {type:"submit"} validates its Form; a button outside the form must name it: {type:"submit", form:"<form id>"}. Then add {type:"navigate"} to continue.
- Navigate only to listed screen ids. Back/Cancel buttons use {type:"back"} or navigate to the right screen.
- Existing or sample data (balances, current employer, profile details) is literal text in RecordFields/Stat/Text. Use {{state...}} ONLY to show what the user typed on an earlier screen.
- Input "field" state keys are "<topic>.<name>" in camelCase with a business topic, e.g. customer.mobile, income.salary, review.makerComment. To show a value entered on an earlier screen use {{state.topic.name}}; on a screen opened from a table/list row use {{record.field}}.
- Tables and Lists only use the listed collections and their field ids. On a screen opened from a row, {{record.<field>}} must use that collection's exact field ids. Use rowAction/itemAction to open a details screen.
- Prefer a Template node for simulated UAE PASS, OTP, eKYC, face verification, document upload and maker/checker steps; set its next.
- Everything external is simulated: say so in the UI. Use realistic FICTIONAL UAE data (AED amounts, +971 numbers). No real people, no real IDs.
- Mobile: single column, primary action last. Portal: use Grid for KPIs and side-by-side cards.
${componentGuide(channel)}`;
}

function screenInput(plan: Plan, s: PlanScreen) {
  const title = (id: string) => plan.screens.find(x => x.id === id)?.title ?? id;
  return JSON.stringify({
    app: { name: plan.appName, channel: plan.channel, shell: plan.shell.kind, menu: plan.shell.items.map(i => i.label), globalRequirements: plan.globalContext.slice(0, 3000) },
    screen: { id: s.id, title: s.title, requirement: s.requirement, purpose: s.purpose, suggestedTemplate: s.template, leadsTo: s.links.map(id => ({ id, title: title(id) })), shell: s.shell },
    allScreens: plan.screens.map(x => ({ id: x.id, title: x.title })),
    collections: plan.collections.map(c => ({ id: c.id, label: c.label, key: c.key, fields: c.fields.map(f => f.id) })),
    sampleFactsToReuseExactly: plan.sampleFacts ?? [],
  });
}
export function planDocument(plan: Plan, screens: Screen[] = []): DemoDocument {
  return { schemaVersion: 2, id: 'generated', name: plan.appName, channel: plan.channel, theme: { ...plan.theme, radius: plan.channel === 'mobile' ? 'lg' : 'md', font: 'inter' },
    shell: plan.shell, collections: plan.collections,
    screens: screens.length ? screens : plan.screens.map(s => ({ id: s.id, title: s.title, shell: s.shell, children: [] })) };
}
const errorsOf = (issues: Issue[]) => issues.filter(i => i.severity === 'error');

export async function generateScreen(provider: LlmProvider, plan: Plan, target: PlanScreen, onCall: (kind: 'screen' | 'repair', call: CompletionResult) => Promise<void> = async () => {}): Promise<ScreenOutcome> {
  const schema = aiScreenSchema({ channel: plan.channel, screenIds: plan.screens.map(s => s.id), collectionIds: plan.collections.map(c => c.id) });
  const ctx = documentContext(planDocument(plan));
  const instructions = screenInstructions(plan.channel);
  const calls: CompletionResult[] = [];
  const check = (json: unknown) => {
    const screen = { ...(stripNulls(json) as Screen), id: target.id, title: target.title } as Screen; // the plan owns id and title
    return { screen, issues: validateScreen(screen, ctx, 'screen') };
  };
  let first: ReturnType<typeof check> | null = null;
  let failure = '';
  try {
    const call = await provider.complete({ purpose: 'screen', instructions, input: screenInput(plan, target), schemaName: 'screen', schema, maxOutputTokens: 6000 });
    calls.push(call); await onCall('screen', call);
    first = check(call.json);
    if (!errorsOf(first.issues).length) return { screen: first.screen, status: 'valid', issues: first.issues, calls };
    const cleaned = stripArtifacts(first.screen, first.issues);
    if (cleaned) { const again = check(cleaned); if (!errorsOf(again.issues).length) return { screen: again.screen, status: 'valid', issues: again.issues, calls }; first = again; }
    const shortened = shortenTooLong(first.screen, first.issues);
    if (shortened) { const again = check(shortened); if (!errorsOf(again.issues).length) return { screen: again.screen, status: 'valid', issues: again.issues, calls }; first = again; }
    // Targeted repair: the exact problems, the previous output and the same requirement.
    const repairInput = JSON.stringify({ task: 'Fix ONLY these problems in the screen and return the full corrected screen.', problems: errorsOf(first.issues).map(i => i.path.replace(/^screen/, '') + ': ' + i.message), previousScreen: first.screen, context: JSON.parse(screenInput(plan, target)) });
    const fix = await provider.complete({ purpose: 'repair', instructions, input: repairInput, schemaName: 'screen', schema, maxOutputTokens: 6000 });
    calls.push(fix); await onCall('repair', fix);
    const second = check(fix.json);
    if (!errorsOf(second.issues).length) return { screen: second.screen, status: 'repaired', issues: second.issues, calls };
    failure = 'Still invalid after one repair: ' + errorsOf(second.issues).slice(0, 3).map(i => i.code + ' at ' + i.path).join('; ');
  } catch (e) {
    if (e instanceof ProviderError && !['truncated', 'parse', 'refusal'].includes(e.category)) throw e; // let the orchestrator retry/stop
    failure = e instanceof Error ? e.message : String(e);
  }
  return { screen: fallbackScreen(plan, target, failure), status: 'fallback', issues: first ? errorsOf(first.issues) : [], calls, failure };
}

/**
 * Cross-screen refinement after assembly: fix bindings that no other screen satisfies.
 * Returns the improved screen only if it is valid and has fewer binding problems.
 */
export async function refineBindings(provider: LlmProvider, plan: Plan, screen: Screen, problems: Issue[], writtenKeys: string[], recordScreens: string[], onCall: (kind: 'repair', call: CompletionResult) => Promise<void>): Promise<Screen | null> {
  const schema = aiScreenSchema({ channel: plan.channel, screenIds: plan.screens.map(s => s.id), collectionIds: plan.collections.map(c => c.id) });
  const target = plan.screens.find(s => s.id === screen.id)!;
  const input = JSON.stringify({
    task: 'Fix ONLY these data-binding problems and return the full screen. For values nobody enters (existing/sample data), write realistic fictional literal text instead of {{state...}}. To show what the user entered elsewhere, use exactly one of the listed state keys. Use {{record...}} only if this screen receives a record.',
    problems: problems.map(i => i.path.replace(/^screen/, '') + ': ' + i.message), stateKeysEnteredInTheApp: writtenKeys, screensThatReceiveARecord: recordScreens,
    previousScreen: screen, context: JSON.parse(screenInput(plan, target)),
  });
  const call = await provider.complete({ purpose: 'repair', instructions: screenInstructions(plan.channel), input, schemaName: 'screen', schema, maxOutputTokens: 6000 });
  await onCall('repair', call);
  const next = { ...(stripNulls(call.json) as Screen), id: screen.id, title: screen.title } as Screen;
  return next;
}

/** Remove stray braces (a recurring model artifact such as "Reference #},{") outside valid bindings. */
export function stripArtifacts(screen: Screen, issues: Issue[]): Screen | null {
  if (!issues.some(i => i.code === 'quality.artifact')) return null;
  const clean = (s: string) => { const parts = s.split(/(\{\{[^}]*\}\})/); return parts.map(p => (p.startsWith('{{') ? p : p.replace(/[{}]/g, '').replace(/,\s*$/, ''))).join('').replace(/\s{2,}/g, ' ').trim(); };
  const visit = (v: any): any => typeof v === 'string' ? clean(v) : Array.isArray(v) ? v.map(visit) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)])) : v;
  return visit(screen);
}

/** If the only errors are over-long strings, shorten them (with an ellipsis) instead of paying for a repair. */
export function shortenTooLong(screen: Screen, issues: Issue[]): Screen | null {
  const errors = errorsOf(issues);
  if (!errors.length || errors.some(i => i.code !== 'schema.too_big' || !/<=\s*\d+ characters/.test(i.message))) return null;
  const copy: any = structuredClone(screen);
  for (const i of errors) {
    const max = Number(/<=\s*(\d+) characters/.exec(i.message)![1]);
    const keys = i.path.replace(/^screen\.?/, '').match(/[^.[\]]+/g) ?? [];
    let parent = copy;
    for (const k of keys.slice(0, -1)) parent = parent?.[/^\d+$/.test(k) ? Number(k) : k];
    const last = keys.at(-1)!, value = parent?.[/^\d+$/.test(last) ? Number(last) : last];
    if (typeof value !== 'string') return null;
    parent[/^\d+$/.test(last) ? Number(last) : last] = value.slice(0, max - 1).trimEnd() + '…';
  }
  return copy;
}

/** Deterministic, valid placeholder that keeps the journey navigable and says it needs attention. */
export function fallbackScreen(plan: Plan, s: PlanScreen, reason: string): Screen {
  const title = (id: string) => plan.screens.find(x => x.id === id)?.title ?? id;
  const children: NodeT[] = [
    { type: 'Heading', id: 'fallback-title', text: s.title, level: '2' },
    { type: 'Text', id: 'fallback-purpose', text: s.purpose.slice(0, 600) },
    { type: 'Notice', id: 'fallback-notice', tone: 'warning', title: 'This screen needs attention', body: 'AI generation did not pass validation. Regenerate this screen or edit it in the designer.' },
  ];
  if (s.template) children.push({ type: 'Template', id: 'fallback-template', template: s.template, ...(s.links[0] ? { next: s.links[0] } : {}) });
  s.links.slice(0, 4).forEach((id, i) => children.push({ type: 'Button', id: 'fallback-go-' + (i + 1), label: ('Go to ' + title(id)).slice(0, 40), variant: i ? 'secondary' : 'primary', actions: [{ type: 'navigate', screen: id }] }));
  void reason;
  return { id: s.id, title: s.title, shell: s.shell, children };
}
