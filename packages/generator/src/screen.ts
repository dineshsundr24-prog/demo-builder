// One screen per call: strict schema -> validate -> at most one targeted repair -> marked fallback.
import { aiScreenSchema, componentGuide, stripNulls, validateScreen, documentContext, type DemoDocument, type Issue, type Screen, type NodeT } from '@demo/schema';
import type { LlmProvider, CompletionResult } from './provider.ts';
import { ProviderError } from './provider.ts';
import type { Plan, PlanScreen } from './plan.ts';
import { normalizeDesign, coverageIssues } from './design.ts';

export type ScreenOutcome = { screen: Screen; status: 'valid' | 'repaired' | 'fallback'; issues: Issue[]; calls: CompletionResult[]; failure?: string };

export function screenInstructions(channel: 'mobile' | 'portal', templateIds?: string[]) {
  // Static per channel, so the provider can cache this prefix across every screen call.
  return `You design ONE screen of a fictional ${channel === 'mobile' ? 'mobile banking app (390px wide)' : 'staff web portal (desktop)'} as a component tree for a declarative renderer.
Rules:
- Return the screen with the given id and title. Use only the schema's components and actions. Keep it focused: 3-12 top-level components.
- Put inputs inside a Form. A Button with {type:"submit"} validates its Form; a button outside the form must name it: {type:"submit", form:"<form id>"}. Then add {type:"navigate"} to continue.
- Navigate only to listed screen ids. Back/Cancel buttons use {type:"back"} or navigate to the right screen.
- Bindings are plain values only: no conditionals or loops ({{#if}}, {{else}}, {{#each}} are not supported). Show alternatives as separate literal text.
- Existing or sample data (balances, current employer, profile details) is literal text in RecordFields/Stat/Text. Use {{state...}} ONLY to show what the user typed on an earlier screen.
- Input "field" state keys are "<topic>.<name>" in camelCase with a business topic, e.g. customer.mobile, income.salary, review.makerComment. To show a value entered on an earlier screen use {{state.topic.name}}; on a screen opened from a table/list row use {{record.field}}.
- Tables and Lists only use the listed collections and their field ids. On a screen opened from a row, {{record.<field>}} must use that collection's exact field ids. Use rowAction/itemAction to open a details screen.
DESIGN: you choose designed patterns and write their content; the renderer owns the visual design. Compose like a senior product designer:
- Welcome/onboarding: Hero (showLogo true) + optional Promo or short value points + ActionBar (primary "Sign in" / secondary "Create account").
- Sign in / sign up: the sign-in / sign-up Template (next + alt), optionally a small Hero above it (showLogo true, illustration none).
- Dashboard/home: Heading greeting or ProfileHeader, BalanceCard, QuickActions (4 most relevant shortcuts, including links to the app's other key screens), TransactionList (4-5 recent items), optional Promo. No ActionBar on dashboards: QuickActions already lead onward.
- Update/edit forms: a Section with current values (RecordFields), then a Form with ALL fields the requirement needs (grouped logically) and an ActionBar inside the Form (primary submit+navigate, secondary back/cancel).
- Review/confirmation: Hero (illustration success, showLogo false) or Notice, RecordFields summary, ActionBar.
- Profile/settings: ProfileHeader + MenuList sections (personal details, security, notifications, help) with a danger "Sign out" item.
- Requests/history: TransactionList or List; details screens: StatusTimeline + RecordFields.
- Portal pages: Grid of Stat KPIs, Table with built-in search/filter, Cards with RecordFields, ActionBar.
- Sample people and companies get realistic, locale-appropriate fictional names (e.g. "Sara Al Mansoori", "Gulf Logistics LLC"), never "John Doe" or "Lorem ipsum".
- Never place buttons side by side yourself (use ActionBar), never wrap a single Stat in a Card, one logo per screen, one ActionBar per screen at the end, no empty sections.
- Cover every item in mustInclude.
- Use a Template node only from the listed templates and only when the screen is that step (set next, and alt for the secondary link). A requested "standard" sign-in/sign-up uses the sign-in/sign-up templates, never an identity-provider template.
- Everything external is simulated: say so in the UI. Use realistic FICTIONAL data for the brief's locale (UAE/AED unless stated). No real people, no real IDs.
- Mobile: single column, primary action last. Portal: use Grid for KPIs and side-by-side cards.
${componentGuide(channel, templateIds)}`;
}

function screenInput(plan: Plan, s: PlanScreen) {
  const title = (id: string) => plan.screens.find(x => x.id === id)?.title ?? id;
  return JSON.stringify({
    app: { name: plan.appName, channel: plan.channel, shell: plan.shell.kind, menu: plan.shell.items.map(i => i.label), globalRequirements: plan.globalContext.slice(0, 3000) },
    screen: { id: s.id, title: s.title, requirement: s.requirement, purpose: s.purpose, mustInclude: s.mustInclude ?? [], suggestedTemplate: s.template, leadsTo: s.links.map(id => ({ id, title: title(id) })), shell: s.shell },
    allScreens: plan.screens.map(x => ({ id: x.id, title: x.title })),
    collections: plan.collections.map(c => ({ id: c.id, label: c.label, key: c.key, fields: c.fields.map(f => f.id) })),
    sampleFactsToReuseExactly: plan.sampleFacts ?? [],
  });
}
export function planDocument(plan: Plan, screens: Screen[] = []): DemoDocument {
  return { schemaVersion: 2, id: 'generated', name: plan.appName, channel: plan.channel,
    theme: { ...plan.theme, radius: plan.channel === 'mobile' ? 'lg' : 'md', font: plan.brand?.font ?? 'inter', ...(plan.brand?.logo ? { logo: plan.brand.logo } : {}) },
    shell: plan.shell, collections: plan.collections,
    screens: screens.length ? screens : plan.screens.map(s => ({ id: s.id, title: s.title, shell: s.shell, children: [] })) };
}
const errorsOf = (issues: Issue[]) => issues.filter(i => i.severity === 'error');

export async function generateScreen(provider: LlmProvider, plan: Plan, target: PlanScreen, onCall: (kind: 'screen' | 'repair', call: CompletionResult) => Promise<void> = async () => {}): Promise<ScreenOutcome> {
  const schema = aiScreenSchema({ channel: plan.channel, screenIds: plan.screens.map(s => s.id), collectionIds: plan.collections.map(c => c.id), templateIds: plan.templates });
  const ctx = documentContext(planDocument(plan));
  const instructions = screenInstructions(plan.channel, plan.templates);
  const calls: CompletionResult[] = [];
  const check = (json: unknown) => {
    const raw = { ...(stripNulls(json) as Screen), id: target.id, title: target.title } as Screen; // the plan owns id and title
    const issues0 = validateScreen(raw, ctx, 'screen');
    if (errorsOf(issues0).some(i => i.code.startsWith('schema.'))) return { screen: raw, issues: issues0 };
    const { screen } = normalizeDesign(raw);
    return { screen, issues: [...validateScreen(screen, ctx, 'screen'), ...coverageIssues(screen, target.mustInclude)] };
  };
  // Missing requirement items trigger a repair, but never a fallback: after the repair they become warnings.
  const accept = (issues: Issue[]) => issues.map(i => (i.code === 'coverage.missing' ? { ...i, severity: 'warning' as const } : i));
  let first: ReturnType<typeof check> | null = null;
  let failure = '';
  try {
    const call = await provider.complete({ purpose: 'screen', instructions, input: screenInput(plan, target), schemaName: 'screen', schema, maxOutputTokens: 6000 });
    calls.push(call); await onCall('screen', call);
    first = check(call.json);
    if (!errorsOf(first.issues).length) return { screen: first.screen, status: 'valid', issues: first.issues, calls };
    const unblocked = stripBlockHelpers(first.screen, first.issues);
    if (unblocked) { const again = check(unblocked); if (!errorsOf(again.issues).length) return { screen: again.screen, status: 'valid', issues: again.issues, calls }; first = again; }
    const cleaned = stripArtifacts(first.screen, first.issues);
    if (cleaned) { const again = check(cleaned); if (!errorsOf(again.issues).length) return { screen: again.screen, status: 'valid', issues: again.issues, calls }; first = again; }
    const shortened = shortenTooLong(first.screen, first.issues);
    if (shortened) { const again = check(shortened); if (!errorsOf(again.issues).length) return { screen: again.screen, status: 'valid', issues: again.issues, calls }; first = again; }
    // Targeted repair: the exact problems, the previous output and the same requirement.
    const repairInput = JSON.stringify({ task: 'Fix ONLY these problems in the screen and return the full corrected screen.', problems: errorsOf(first.issues).map(i => i.path.replace(/^screen/, '') + ': ' + i.message), previousScreen: first.screen, context: JSON.parse(screenInput(plan, target)) });
    const fix = await provider.complete({ purpose: 'repair', instructions, input: repairInput, schemaName: 'screen', schema, maxOutputTokens: 6000 });
    calls.push(fix); await onCall('repair', fix);
    const second = check(fix.json);
    const reason: Issue = { path: 'screen', code: 'repair.reason', severity: 'warning', message: 'Repaired: ' + [...new Set(errorsOf(first.issues).map(i => i.code))].join(', ') };
    second.issues.push(reason);
    if (!errorsOf(second.issues).length) return { screen: second.screen, status: 'repaired', issues: second.issues, calls };
    if (!errorsOf(accept(second.issues)).length) return { screen: second.screen, status: 'repaired', issues: accept(second.issues), calls };
    if (!errorsOf(accept(first.issues)).length) return { screen: first.screen, status: 'valid', issues: accept(first.issues), calls };
    failure = 'Still invalid after one repair: ' + errorsOf(second.issues).slice(0, 3).map(i => i.code + ' at ' + i.path).join('; ');
  } catch (e) {
    if (e instanceof ProviderError && e.category === 'truncated' && !first) {
      // A cut-off answer is usually a runaway list: ask once for a concise screen.
      try {
        const retry = await provider.complete({ purpose: 'repair', instructions, input: JSON.stringify({ task: 'Your previous answer was too long and was cut off. Produce a CONCISE screen: at most 10 top-level components, lists of at most 6 items.', context: JSON.parse(screenInput(plan, target)) }), schemaName: 'screen', schema, maxOutputTokens: 6000 });
        calls.push(retry); await onCall('repair', retry);
        const again = check(retry.json);
        if (!errorsOf(accept(again.issues)).length) return { screen: again.screen, status: 'repaired', issues: accept(again.issues), calls };
        failure = 'Still invalid after a concise retry: ' + errorsOf(again.issues).slice(0, 3).map(i => i.code + ' at ' + i.path).join('; ');
        return { screen: fallbackScreen(plan, target, failure), status: 'fallback', issues: errorsOf(again.issues), calls, failure };
      } catch (e2) { e = e2; }
    }
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
  const schema = aiScreenSchema({ channel: plan.channel, screenIds: plan.screens.map(s => s.id), collectionIds: plan.collections.map(c => c.id), templateIds: plan.templates });
  const target = plan.screens.find(s => s.id === screen.id)!;
  const input = JSON.stringify({
    task: 'Fix ONLY these data-binding problems and return the full screen. For values nobody enters (existing/sample data), write realistic fictional literal text instead of {{state...}}. To show what the user entered elsewhere, use exactly one of the listed state keys. Use {{record...}} only if this screen receives a record.',
    problems: problems.map(i => i.path.replace(/^screen/, '') + ': ' + i.message), stateKeysEnteredInTheApp: writtenKeys, screensThatReceiveARecord: recordScreens,
    previousScreen: screen, context: JSON.parse(screenInput(plan, target)),
  });
  const call = await provider.complete({ purpose: 'repair', instructions: screenInstructions(plan.channel, plan.templates), input, schemaName: 'screen', schema, maxOutputTokens: 6000 });
  await onCall('repair', call);
  const next = { ...(stripNulls(call.json) as Screen), id: screen.id, title: screen.title } as Screen;
  return next;
}

/** Drop unsupported template block helpers ({{#if x}}, {{else}}, {{/if}}, {{#each}}), keeping the text around them. */
export function stripBlockHelpers(screen: Screen, issues: Issue[]): Screen | null {
  if (!issues.some(i => i.code === 'binding.syntax' && /\{\{\s*(#|\/|else\b)/.test(i.message))) return null;
  const clean = (s: string) => s.replace(/\{\{\s*(?:#\w+[^}]*|\/\w+|else)\s*\}\}/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const visit = (v: any): any => typeof v === 'string' ? clean(v) : Array.isArray(v) ? v.map(visit) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)])) : v;
  return visit(screen);
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
