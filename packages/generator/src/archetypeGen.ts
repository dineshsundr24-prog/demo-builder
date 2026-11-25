// Archetype path: the AI writes a small content contract; the archetype builder lays out the screen.
import { toStrictSchema, clampToSchema, stripNulls, validateScreen, documentContext, type Issue, type Screen } from '@demo/schema';
import type { LlmProvider, CompletionResult } from './provider.ts';
import { ProviderError } from './provider.ts';
import type { Plan, PlanScreen } from './plan.ts';
import { ARCHETYPES, buildArchetypeScreen, type BuildCtx } from './archetypes.ts';
import { planDocument } from './screen.ts';
import { uxIssues } from './uxLint.ts';

const SCREEN_KEYS = new Set(['next', 'target', 'signUpTarget', 'signInTarget', 'editTarget', 'detailTarget', 'signOutTarget']);
const FIELD_KEYS = new Set(['titleField', 'subtitleField', 'statusField', 'filterField']);
const FIELD_ARRAYS = new Set(['columns', 'summaryFields', 'fields']);

export function contentInstructions(channel: 'mobile' | 'portal') {
  return `You write the CONTENT of one screen of a fictional ${channel === 'mobile' ? 'mobile app' : 'staff web portal'}. A professional designer already fixed the layout for this screen type (archetype); you only fill its content fields.
Rules:
- Write like the product's UX writer: short, specific, real product copy for this brand and industry. Sentence case. Labels 1-3 words, buttons 1-3 words starting with a verb.
- Never write meta text ("sample", "example", "for clarity", "displayed here", "this screen"), never placeholders like "Lorem ipsum" or "John Doe".
- Reuse sampleFacts exactly (names, numbers, amounts). Fictional, locale-appropriate data (UAE/AED unless the brief says otherwise).
- Targets: only the given screen ids; choose the screen the action really leads to (see leadsTo). Never target the current screen.
- Field references (columns, titleField...) use only the given collection field ids.
- Forms: include every field the requirement and mustInclude ask for, with the right kind (email, phone, currency, date, select with options, upload...). No navigation items or success messages inside forms.
- Cover the requirement and mustInclude with content; navigation (tabs, back) is handled by the app, never add "Home"/"Menu"/"Back" actions.
- Everything external (UAE PASS, eKYC, payments, SMS) is simulated.`;
}

function input(plan: Plan, s: PlanScreen, collection: BuildCtx['collection']) {
  const title = (id: string) => plan.screens.find(x => x.id === id)?.title ?? id;
  return JSON.stringify({
    app: { name: plan.brandName, channel: plan.channel, globalRequirements: plan.globalContext.slice(0, 2500) },
    archetype: { id: s.archetype, description: ARCHETYPES[s.archetype!].description },
    screen: { id: s.id, title: s.title, requirement: s.requirement, purpose: s.purpose, mustInclude: s.mustInclude ?? [], leadsTo: s.links.map(id => ({ id, title: title(id) })) },
    allScreens: plan.screens.map(x => ({ id: x.id, title: x.title, type: x.archetype })),
    collection: collection ? { id: collection.id, label: collection.label, fields: collection.fields.map(f => ({ id: f.id, label: f.label })), sampleRow: collection.rows[0] } : null,
    sampleFactsToReuseExactly: plan.sampleFacts ?? [],
  });
}

/** Drop invalid references deterministically (a wrong target must never become a broken button). */
export function sanitizeContent(v: any, ctx: BuildCtx): any {
  const ids = new Set(ctx.plan.screens.map(s => s.id).filter(id => id !== ctx.screen.id));
  const fields = new Set(ctx.collection?.fields.map(f => f.id) ?? []);
  const nextDefault = ctx.screen.links[0] ?? ctx.plan.screens[ctx.plan.screens.findIndex(s => s.id === ctx.screen.id) + 1]?.id ?? ctx.plan.screens[0].id;
  const walk = (x: any): any => {
    if (Array.isArray(x)) return x.map(walk);
    if (!x || typeof x !== 'object') return x;
    const out: any = {};
    for (const [k, val] of Object.entries(x)) {
      if (SCREEN_KEYS.has(k) && typeof val === 'string') { if (ids.has(val)) out[k] = val; else if (k === 'next') out[k] = nextDefault; continue; }
      if (FIELD_KEYS.has(k) && typeof val === 'string') { if (fields.has(val)) out[k] = val; else if (k === 'titleField' && ctx.collection) out[k] = ctx.collection.fields[0].id; continue; }
      if (FIELD_ARRAYS.has(k) && Array.isArray(val) && val.every(e => typeof e === 'string')) { out[k] = val.filter(e => fields.has(e)); continue; }
      out[k] = walk(val);
    }
    return out;
  };
  return walk(v);
}

export type ArchetypeOutcome = { screen: Screen; status: 'valid' | 'repaired' | 'fallback'; issues: Issue[]; calls: CompletionResult[]; failure?: string };

export async function generateArchetypeScreen(provider: LlmProvider, plan: Plan, target: PlanScreen, onCall: (kind: 'screen' | 'repair', call: CompletionResult) => Promise<void>): Promise<ArchetypeOutcome> {
  const a = ARCHETYPES[target.archetype!];
  const collection = plan.collections.find(c => c.id === target.collection) ?? undefined;
  const ctx: BuildCtx = { plan, screen: target, channel: plan.channel, collection };
  const docCtx = documentContext(planDocument(plan));
  const errors = (i: Issue[]) => i.filter(x => x.severity === 'error');
  const build = (content: any) => {
    const parsed = a.content.safeParse(clampToSchema(a.content, sanitizeContent(stripNulls(content), ctx)));
    if (!parsed.success) return { screen: null as Screen | null, issues: [{ path: 'content.' + parsed.error.issues[0].path.join('.'), code: 'content.invalid', severity: 'error', message: parsed.error.issues[0].message } as Issue] };
    const screen = buildArchetypeScreen(a.id, parsed.data, ctx);
    return { screen, issues: [...validateScreen(screen, docCtx, 'screen'), ...uxIssues(screen, plan.channel)] };
  };
  const calls: CompletionResult[] = [];
  const schema = toStrictSchema(a.content, { screen: plan.screens.map(s => s.id).filter(id => id !== target.id), field: collection?.fields.map(f => f.id) ?? [] });
  let failure = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const call = await provider.complete({ purpose: attempt ? 'repair' : 'screen', instructions: contentInstructions(plan.channel), input: input(plan, target, collection), schemaName: 'content_' + a.id.replace(/-/g, '_'), schema, maxOutputTokens: 3000 });
      calls.push(call); await onCall(attempt ? 'repair' : 'screen', call);
      const out = build(call.json);
      if (out.screen && !errors(out.issues).length) return { screen: out.screen, status: attempt ? 'repaired' : 'valid', issues: out.issues, calls };
      failure = errors(out.issues).slice(0, 3).map(i => i.code + ' at ' + i.path + ': ' + i.message).join('; ');
    } catch (e) {
      if (e instanceof ProviderError && !['truncated', 'parse', 'refusal'].includes(e.category)) throw e;
      failure = e instanceof Error ? e.message : String(e);
    }
  }
  // Fallback: the archetype with default content is still a proper, navigable screen.
  const def = build(a.defaults(ctx));
  if (def.screen && !errors(def.issues).length) return { screen: def.screen, status: 'fallback', issues: [{ path: 'screen', code: 'content.default', severity: 'warning', message: 'Default content used: ' + failure.slice(0, 200) }], calls, failure };
  throw Object.assign(Error('Archetype "' + a.id + '" default content is invalid: ' + errors(def.issues).map(i => i.code + ' ' + i.path + ' ' + i.message).join('; ')), { category: 'internal' });
}
