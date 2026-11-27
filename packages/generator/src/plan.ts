// Planning: brief -> reviewable plan (screens, shell, data, templates, links).
import { z } from 'zod';
import { toStrictSchema, clampToSchema, templates, allowedTemplates, ScreenRef, TemplateRef, type Collection, type Shell } from '@demo/schema';
import { parseBrief, briefColours, type ParsedBrief } from './briefParser.ts';
import type { LlmProvider, CompletionResult } from './provider.ts';
import { ARCHETYPES, archetypesFor } from './archetypes.ts';

export type Brand = { logo?: string; primary?: string; secondary?: string; accent?: string; font?: 'system' | 'inter' | 'serif' | 'rounded' };
/** Approved requirements a demo must demonstrate (from a MEYON launch). Ids are stable MEYON references. */
export type Requirement = { story: string; title?: string; criteria: { id: string; text: string }[] };
export type GenerationRequest = { name: string; company?: string; channel: 'mobile' | 'portal'; guidelines?: string; brand?: Brand; requirements?: Requirement[] };
export type PlanScreen = { id: string; title: string; requirement: string; purpose: string; template: string | null; links: string[]; shell: 'default' | 'hidden'; locked: boolean; mustInclude?: string[]; archetype?: string; collection?: string | null;
  /** Acceptance-criterion ids this screen demonstrates. */ criteria?: string[] };
export type Plan = {
  appName: string; brandName: string; channel: 'mobile' | 'portal';
  theme: { primary: string; secondary: string; accent: string };
  shell: Shell; collections: Collection[]; screens: PlanScreen[];
  sampleFacts: { label: string; value: string }[];
  brand?: { logo?: string; font?: Brand['font'] }; // applied to the document, never sent to the AI
  templates: string[];               // templates allowed for this brief (journey templates need a mention)
  globalContext: string; notes: string[];
  /** Approved requirements (copied from the request; never editable through plan approval). */ requirements?: Requirement[];
};
/** All criterion ids of the requirements, with their story. */
export const criteriaOf = (reqs: Requirement[] = []) => reqs.flatMap(r => r.criteria.map(c => ({ ...c, story: r.story })));
export const ICONS = ['home', 'list', 'user', 'layout-dashboard', 'folder', 'check', 'bar-chart', 'settings', 'bell', 'credit-card', 'file'] as const;
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Slug = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);

function planModel(locked: boolean, channel: 'mobile' | 'portal' = 'mobile', criteriaIds: string[] = []) {
  const archetype = z.enum([...archetypesFor(channel).map(a => a.id), 'custom'] as unknown as [string, ...string[]]);
  const screenId = locked ? ScreenRef : Slug;
  const link = locked ? ScreenRef : Slug;
  return z.object({
    brandName: z.string().min(1).max(30).optional(),
    theme: z.object({ primary: Hex, secondary: Hex, accent: Hex }),
    sampleFacts: z.array(z.object({ label: z.string().min(1).max(40), value: z.string().min(1).max(80) })).max(12),
    shellKind: z.enum(['tabs', 'drawer', 'sidebar', 'none']),
    menu: z.array(z.object({ label: z.string().min(1).max(24), icon: z.enum(ICONS), screen: link })).max(6),
    collections: z.array(z.object({
      id: Slug, label: z.string().min(1).max(60), key: z.string().min(1).max(40),
      fields: z.array(z.object({ id: z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/), label: z.string().min(1).max(40) })).min(2).max(10),
      // Each cell names its field: a merged or missing value cannot shift the other columns.
      rows: z.array(z.array(z.object({ field: z.string().min(1).max(40), value: z.string().max(120) })).min(1).max(10)).min(2).max(12),
    })).max(6),
    screens: z.array(z.object({
      id: screenId, title: z.string().min(1).max(85), purpose: z.string().min(1).max(400),
      archetype: archetype.optional(), collection: Slug.nullable().optional(),
      template: TemplateRef.nullable(), links: z.array(link).max(6), shell: z.enum(['default', 'hidden']),
      mustInclude: z.array(z.string().min(2).max(48)).max(10),
      ...(criteriaIds.length ? { criteria: z.array(z.enum(criteriaIds as [string, ...string[]])).max(20) } : {}),
    })).min(1).max(60),
  });
}

const PLAN_INSTRUCTIONS_BASE = `You plan a clickable, fictional demo application (any industry) that a renderer builds from professionally designed components.
Return the plan only. Rules:
- brandName: the SHORT brand the customer sees, 1-2 words, without generic words such as Digital, Banking, App, Portal (brief "Nexa Digital Banking" -> "Nexa"; "Kapiko Bank" -> "Kapiko Bank"). Shown in the app header and logo.
- archetype: the standard screen type this screen IS (each has a professionally designed layout):
ARCHETYPE_LIST
  Use "custom" only when none fits. A dashboard/home is "dashboard"; a records/history/requests/inbox screen is "list"; its drill-down is "detail".
  Banking (the default domain): money transfer, paying a supplier/vendor/person or sending money -> "transfer"; bill/utility payment -> "bill-payment"; card management/freeze/limits -> "card-controls"; loan/finance offer or calculator -> "loan-offer"; one account's details/IBAN/statement -> "account-details"; confirm-before-submit -> "review"; receipt/confirmation -> "success"; beneficiaries/transactions/requests -> "list".
  Staff portal: a staff view of one customer -> "customer-360"; maker review, checker approval, KYC/AML or any staff decision on a record -> "approval" (never a read-only summary); queues -> "list" with the records collection.
- collection: the id of the collection a list/detail/dashboard/report/approval screen shows; otherwise null. Each list gets its own collection with fields matching that list (e.g. transactions: date, description, amount, status).
- Screens: when a screen list is provided, return exactly those screens, same ids, titles and order; never add screens. Otherwise propose only the screens the brief needs (3-12; ids are lowercase-hyphen slugs).
- purpose: one or two sentences describing the content and controls of that screen, faithful to its requirement.
- links: the screens this screen's buttons, rows or templates lead to, following the journeys.
- shell: "hidden" for focused flows (welcome, sign-in/up, OTP, verification); "default" where the app menu (tabs/sidebar) shows.
- shellKind: mobile -> tabs (or drawer); portal -> sidebar. menu: 3-5 main destinations.
- template: only from the provided templates list, and only when the screen IS that step: a standard sign-in screen -> "sign-in", registration -> "sign-up". Never replace a requested standard form with an identity-provider template. Otherwise null.
- mustInclude: 3-8 short content items (2-6 words each) for the screen: what its requirement asks for PLUS what a real, regulated product would need, e.g. an income update form: ["new monthly salary", "allowances", "employment status", "effective date", "salary certificate upload"]. Content only: never navigation ("home", "menu", "back") or outcome messages.
- purpose: describe the content concretely (sections, fields, actions) the way a product designer would brief a UI designer.
- collections: every field the list, detail, review and approval screens of that collection show (e.g. a loan application: reference, customer, amount, tenure, monthly salary, documents, bureau score, status, submitted date), up to 10 fields; sample data tables needed by lists/tables (e.g. applications, transactions, requests), with realistic FICTIONAL data for the brief's locale (UAE/AED unless the brief says otherwise); key = the field that uniquely identifies a row; rows: 3-8 records; EVERY row has one {field, value} cell for EVERY field, in field order, with a realistic non-empty value (one value per cell, never two values in one cell).
- Dates in data are realistic relative to "today": history within the last 90 days, upcoming items within the next 30 days; format "YYYY-MM-DD".
- sampleFacts: 6-12 shared FICTIONAL facts every screen must reuse for consistency (customer name, account number, employer, current salary, balance, reference numbers...).
- theme: use brand colours from the brief when given; otherwise a professional banking palette.
- Never claim real integrations; never use real personal data.
- Plan the journey of the story itself: start where the user starts it (a registration, sign-up or onboarding story starts at the welcome screen, before sign-in; otherwise the home/dashboard or work queue). Add sign-in, dashboard or profile screens only when the story needs them.
- When the requirements describe the system validating, checking or assessing something (field validation, duplicate or existing registration, eligibility, sanctions, credit bureau), include an "assessment" screen after data entry that runs those checks and shows a failure message; never leave such checks invisible.
- acceptanceCriteria (when given) are APPROVED requirements: every one must be demonstrated by at least one screen. criteria: the ids of the acceptance criteria each screen demonstrates (often one or two per screen; [] for screens that demonstrate none). Never invent ids, never reword or drop approved criteria.`;
const planInstructions = (channel: 'mobile' | 'portal') => PLAN_INSTRUCTIONS_BASE.replace('ARCHETYPE_LIST', archetypesFor(channel).map(a => '  - ' + a.id + ': ' + a.description).join('\n'));

export async function createPlan(provider: LlmProvider, req: GenerationRequest, brief: string, opts: { maxScreens: number }): Promise<{ plan: Plan; call: CompletionResult }> {
  const parsed: ParsedBrief | null = parseBrief(brief);
  const locked = !!parsed;
  const lockedIds = parsed?.screens.map(s => s.id) ?? [];
  if (parsed && parsed.screens.length > opts.maxScreens) throw Object.assign(Error('The brief lists ' + parsed.screens.length + ' screens; this workspace allows up to ' + opts.maxScreens + ' per generation. Split the journey or raise MAX_SCREENS_PER_JOB.'), { category: 'budget' });
  const allowed = allowedTemplates(req.channel, brief + '\n' + (req.guidelines ?? ''));
  const tmpl = templates.filter(t => allowed.includes(t.id));
  const criteria = criteriaOf(req.requirements);
  const criteriaIds = criteria.map(c => c.id);
  const schema = toStrictSchema(planModel(locked, req.channel, criteriaIds), { screen: lockedIds, template: allowed });
  const input = JSON.stringify({
    today: new Date().toISOString().slice(0, 10),
    project: { name: req.name, company: req.company ?? '', channel: req.channel, designGuidelines: (req.guidelines ?? '').slice(0, 1500) },
    templates: tmpl.map(t => ({ id: t.id, description: t.description })),
    ...(criteria.length ? { acceptanceCriteria: criteria.map(c => ({ id: c.id, story: c.story, text: c.text })) } : {}),
    ...(parsed ? { screenList: parsed.screens.map(s => ({ id: s.id, title: s.title, requirement: s.requirement })), globalRequirements: parsed.globalContext } : { brief: brief.slice(0, 12000) }),
  });
  const call = await provider.complete({ purpose: 'plan', instructions: planInstructions(req.channel), input, schemaName: 'plan', schema, maxOutputTokens: 8000 });
  // The plan schema has no optional fields; null is meaningful (e.g. template: null), so do not strip it.
  const model = planModel(locked, req.channel, criteriaIds);
  const raw: any = structuredClone(call.json);
  if (raw && raw.brandName === null) delete raw.brandName;
  for (const s of raw?.screens ?? []) if (s && s.archetype === null) delete s.archetype;
  // Older/fake planners return positional rows: name each cell by its field.
  for (const c of raw?.collections ?? []) if (Array.isArray(c?.rows)) c.rows = c.rows.map((r: unknown) => Array.isArray(r) && r.every(v => typeof v !== 'object') ? r.map((v, i) => ({ field: c.fields?.[i]?.id ?? 'f' + i, value: String(v ?? '') })) : r);
  // Unknown criterion ids are dropped rather than failing the plan (the approved list is authoritative).
  for (const s of raw?.screens ?? []) if (s && Array.isArray(s.criteria)) s.criteria = s.criteria.filter((id: unknown) => criteriaIds.includes(String(id)));
  for (const s of raw?.screens ?? []) if (s && !criteriaIds.length) delete s.criteria;
  const result = model.safeParse(clampToSchema(model, raw));
  if (!result.success) throw Object.assign(Error('The plan did not match the plan schema at ' + (result.error.issues[0]?.path ?? []).join('.') + ': ' + result.error.issues[0]?.message), { category: 'parse' });
  return { plan: normalizePlan(result.data, req, brief, parsed, allowed), call };
}

/** Enforce the BA's list, valid references and channel conventions, deterministically. */
export function normalizePlan(p: z.infer<ReturnType<typeof planModel>>, req: GenerationRequest, brief: string, parsed: ParsedBrief | null, allowed: string[] = allowedTemplates(req.channel, brief)): Plan {
  const notes = [...(parsed?.notes ?? [])];
  let screens: PlanScreen[];
  if (parsed) {
    const byId = new Map(p.screens.map(s => [s.id, s]));
    screens = parsed.screens.map(l => {
      const s = byId.get(l.id);
      if (!s) notes.push('Planner omitted "' + l.title + '"; it was kept with its original requirement');
      return { id: l.id, title: l.title, requirement: l.requirement, purpose: s?.purpose ?? l.requirement.slice(0, 400), template: s?.template ?? null, links: s?.links ?? [], shell: s?.shell ?? 'default', locked: true, mustInclude: s?.mustInclude ?? [], archetype: s?.archetype ?? 'custom', collection: s?.collection ?? null, criteria: (s as { criteria?: string[] } | undefined)?.criteria ?? [] };
    });
    for (const s of p.screens) if (!parsed.screens.some(l => l.id === s.id)) notes.push('Ignored unlisted screen "' + s.title + '"');
  } else {
    const used = new Set<string>();
    screens = p.screens.map(s => {
      let id = s.id, n = 2; while (used.has(id)) id = s.id + '-' + n++; used.add(id);
      return { id, title: s.title, requirement: s.purpose, purpose: s.purpose, template: s.template, links: s.links, shell: s.shell, locked: false, mustInclude: s.mustInclude, archetype: s.archetype, collection: s.collection, criteria: (s as { criteria?: string[] }).criteria ?? [] };
    });
  }
  for (const s of screens) if (s.template && !allowed.includes(s.template)) { notes.push('Ignored template "' + s.template + '" for "' + s.title + '" (not requested in the brief)'); s.template = null; }
  const ids = new Set(screens.map(s => s.id));
  const colIds = new Set(p.collections.map(c => c.id));
  // Banking safety net: generic choices for clearly banking screens get the designed banking type.
  for (const s of screens) {
    if (!['form', 'custom', 'info', undefined].includes(s.archetype as any)) continue;
    const text = (s.title + ' ' + s.requirement).toLowerCase();
    const pick = /\b(review|confirm|receipt|success|history|list|statement)\b/.test(s.title.toLowerCase()) ? null
      : /\b(transfer|send money|remittance|pay (a |the )?(supplier|vendor|beneficiary|someone|person|contact)|supplier payment)\b/.test(text) ? 'transfer'
      : /\b(pay (bills?|utilities)|bill payment|utility|dewa|etisalat|salik|addc)\b/.test(text) ? 'bill-payment'
      : /\b(my cards?|card (controls|management|settings)|freeze|unfreeze)\b/.test(text) ? 'card-controls'
      : /\b(emi|instal?ment calculator|loan calculator|finance offer|loan offer)\b/.test(text) || (/\bamount\b/.test(text) && /\btenure\b/.test(text) && /\b(instal?ment|emi|repay)/.test(text)) ? 'loan-offer'
      : /\b(eligibility|duplicate|validation|verification) (check|checks|assessment|result)s?\b|\b(checking|assessing) (your )?(details|eligibility)\b/.test(s.title.toLowerCase()) && !/\b(review|summary|success)\b/.test(s.title.toLowerCase()) ? 'assessment'
      // Only a screen that IS the upload step (by its title); a form that also takes an upload stays a form.
      : /^(upload|attach)\b|\b(upload|supporting) (documents?|certificates?)\b|^documents?\b/.test(s.title.toLowerCase()) ? 'document-upload' : null;
    if (pick && ARCHETYPES[pick]?.channels.includes(req.channel)) { notes.push('"' + s.title + '" uses the ' + ARCHETYPES[pick].label.toLowerCase() + ' layout'); s.archetype = pick; }
  }
  for (const s of screens) {
    const a = ARCHETYPES[s.archetype ?? 'custom'];
    if (!a || !a.channels.includes(req.channel)) s.archetype = 'custom';
    else s.shell = a.shell(req.channel);           // the archetype decides the chrome
    if (s.collection && !colIds.has(s.collection)) s.collection = null;
    if (!s.collection && ['list', 'detail', 'approval'].includes(s.archetype!) && p.collections[0]) s.collection = p.collections[0].id;
    if (s.archetype === 'list' && !s.collection) s.archetype = 'custom';
  }
  for (const s of screens) s.links = [...new Set(s.links.filter(l => ids.has(l) && l !== s.id))];
  notes.push(...traceNotes(screens, req.requirements));
  // Colour priority: uploaded brand > colours written in the brief > the planner's palette.
  const colours = briefColours(brief + ' ' + (req.guidelines ?? ''));
  const b = req.brand ?? {};
  const theme = { primary: (b.primary ?? colours[0] ?? p.theme.primary).toUpperCase(), secondary: (b.secondary ?? colours[1] ?? p.theme.secondary).toUpperCase(), accent: (b.accent ?? colours[2] ?? p.theme.accent).toUpperCase() };
  let kind = p.shellKind;
  if (req.channel === 'mobile' && kind === 'sidebar') kind = 'tabs';
  if (req.channel === 'portal' && (kind === 'tabs' || kind === 'drawer')) kind = 'sidebar';
  const seenMenu = new Set<string>();
  // The app menu lists destinations (home, lists, profile...), never steps of a journey (form, upload, review, success).
  const STEP = new Set(['form', 'document-upload', 'assessment', 'review', 'success', 'otp', 'verification', 'sign-in', 'sign-up', 'welcome', 'transfer', 'bill-payment']);
  const archetypeOf = new Map(screens.map(s => [s.id, s.archetype ?? 'custom']));
  const items = p.menu.filter(m => ids.has(m.screen) && !STEP.has(archetypeOf.get(m.screen)!) && !seenMenu.has(m.screen) && seenMenu.add(m.screen)).map((m, i) => ({ id: 'menu-' + (i + 1), label: m.label, icon: m.icon, screen: m.screen }));
  const collections: Collection[] = p.collections.map(c => {
    const fields = c.fields.filter((f, i, all) => all.findIndex(x => x.id === f.id) === i);
    const key = fields.some(f => f.id === c.key) ? c.key : fields[0].id;
    const seenKeys = new Set<string>();
    const rows = c.rows.map(r => { const byField = new Map(r.map(cell => [cell.field, cell.value])); return Object.fromEntries(fields.map(f => [f.id, String(byField.get(f.id) ?? '')])); }).filter(r => r[key] && !seenKeys.has(r[key]) && seenKeys.add(r[key]));
    return { id: c.id, label: c.label, key, fields, rows };
  });
  const brandName = (p.brandName || req.company || req.name).trim().slice(0, 30);
  return { ...(req.requirements?.length ? { requirements: req.requirements } : {}), appName: req.name, brandName, channel: req.channel, theme, shell: { kind: items.length >= 2 ? kind : 'none', brand: brandName.slice(0, 60), showBack: true, items: items.length >= 2 ? items : [] },
    collections, screens, sampleFacts: p.sampleFacts, templates: allowed, ...(b.logo || b.font ? { brand: { ...(b.logo ? { logo: b.logo } : {}), ...(b.font ? { font: b.font } : {}) } } : {}), globalContext: parsed?.globalContext ?? brief.slice(0, 4000), notes };
}

/** Keep only known criterion ids on each screen; note approved criteria no screen demonstrates. Mutates `screens`. */
export function traceNotes(screens: PlanScreen[], requirements: Requirement[] = []): string[] {
  const all = criteriaOf(requirements);
  if (!all.length) { for (const s of screens) delete s.criteria; return []; }
  const known = new Set(all.map(c => c.id));
  for (const s of screens) s.criteria = [...new Set((s.criteria ?? []).filter(id => known.has(id)))];
  const used = new Set(screens.flatMap(s => s.criteria ?? []));
  return all.filter(c => !used.has(c.id)).map(c => 'Acceptance criterion ' + c.id + ' ("' + c.text.slice(0, 80) + '") is not demonstrated by any screen yet');
}
