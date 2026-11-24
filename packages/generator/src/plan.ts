// Planning: brief -> reviewable plan (screens, shell, data, templates, links).
import { z } from 'zod';
import { toStrictSchema, templates, ScreenRef, TemplateRef, type Collection, type Shell } from '@demo/schema';
import { parseBrief, briefColours, type ParsedBrief } from './briefParser.ts';
import type { LlmProvider, CompletionResult } from './provider.ts';

export type GenerationRequest = { name: string; company?: string; channel: 'mobile' | 'portal'; guidelines?: string };
export type PlanScreen = { id: string; title: string; requirement: string; purpose: string; template: string | null; links: string[]; shell: 'default' | 'hidden'; locked: boolean };
export type Plan = {
  appName: string; channel: 'mobile' | 'portal';
  theme: { primary: string; secondary: string; accent: string };
  shell: Shell; collections: Collection[]; screens: PlanScreen[];
  sampleFacts: { label: string; value: string }[];
  globalContext: string; notes: string[];
};
export const ICONS = ['home', 'list', 'user', 'layout-dashboard', 'folder', 'check', 'bar-chart', 'settings', 'bell', 'credit-card', 'file'] as const;
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Slug = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);

function planModel(locked: boolean) {
  const screenId = locked ? ScreenRef : Slug;
  const link = locked ? ScreenRef : Slug;
  return z.object({
    theme: z.object({ primary: Hex, secondary: Hex, accent: Hex }),
    sampleFacts: z.array(z.object({ label: z.string().min(1).max(40), value: z.string().min(1).max(80) })).max(12),
    shellKind: z.enum(['tabs', 'drawer', 'sidebar', 'none']),
    menu: z.array(z.object({ label: z.string().min(1).max(24), icon: z.enum(ICONS), screen: link })).max(6),
    collections: z.array(z.object({
      id: Slug, label: z.string().min(1).max(60), key: z.string().min(1).max(40),
      fields: z.array(z.object({ id: z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/), label: z.string().min(1).max(40) })).min(2).max(10),
      rows: z.array(z.array(z.string().max(120))).min(2).max(12),
    })).max(6),
    screens: z.array(z.object({
      id: screenId, title: z.string().min(1).max(85), purpose: z.string().min(1).max(400),
      template: TemplateRef.nullable(), links: z.array(link).max(6), shell: z.enum(['default', 'hidden']),
    })).min(1).max(60),
  });
}

const PLAN_INSTRUCTIONS = `You plan a clickable, fictional banking/business demo app that a renderer builds from declarative components.
Return the plan only. Rules:
- Screens: when a screen list is provided, return exactly those screens, same ids and order. Otherwise propose 3-12 screens (ids are lowercase-hyphen slugs).
- purpose: one or two sentences describing the content and controls of that screen, faithful to its requirement.
- links: the screens this screen's buttons, rows or templates lead to, following the journeys.
- shell: "hidden" for focused flows (welcome, sign-in/up, OTP, verification); "default" where the app menu (tabs/sidebar) shows.
- shellKind: mobile -> tabs (or drawer); portal -> sidebar. menu: 3-5 main destinations.
- template: use a template id when a screen is mainly that simulated step (UAE PASS, OTP, eKYC, face, upload, maker/checker); else null.
- collections: sample data tables needed by lists/tables (e.g. applications, service requests, transactions), with realistic FICTIONAL UAE data; key = the field that uniquely identifies a row; rows align with fields.
- sampleFacts: 6-12 shared FICTIONAL facts every screen must reuse for consistency (customer name, account number, employer, current salary, balance, reference numbers...).
- theme: use brand colours from the brief when given; otherwise a professional banking palette.
- Never claim real integrations; never use real personal data.`;

export async function createPlan(provider: LlmProvider, req: GenerationRequest, brief: string, opts: { maxScreens: number }): Promise<{ plan: Plan; call: CompletionResult }> {
  const parsed: ParsedBrief | null = parseBrief(brief);
  const locked = !!parsed;
  const lockedIds = parsed?.screens.map(s => s.id) ?? [];
  if (parsed && parsed.screens.length > opts.maxScreens) throw Object.assign(Error('The brief lists ' + parsed.screens.length + ' screens; this workspace allows up to ' + opts.maxScreens + ' per generation. Split the journey or raise MAX_SCREENS_PER_JOB.'), { category: 'budget' });
  const tmpl = templates.filter(t => t.channels.includes(req.channel));
  const schema = toStrictSchema(planModel(locked), { screen: lockedIds, template: tmpl.map(t => t.id) });
  const input = JSON.stringify({
    project: { name: req.name, company: req.company ?? '', channel: req.channel, designGuidelines: (req.guidelines ?? '').slice(0, 1500) },
    templates: tmpl.map(t => ({ id: t.id, description: t.description })),
    ...(parsed ? { screenList: parsed.screens.map(s => ({ id: s.id, title: s.title, requirement: s.requirement })), globalRequirements: parsed.globalContext } : { brief: brief.slice(0, 12000) }),
  });
  const call = await provider.complete({ purpose: 'plan', instructions: PLAN_INSTRUCTIONS, input, schemaName: 'plan', schema, maxOutputTokens: 8000 });
  // The plan schema has no optional fields; null is meaningful (e.g. template: null), so do not strip it.
  const result = planModel(locked).safeParse(call.json);
  if (!result.success) throw Object.assign(Error('The plan did not match the plan schema at ' + (result.error.issues[0]?.path ?? []).join('.') + ': ' + result.error.issues[0]?.message), { category: 'parse' });
  return { plan: normalizePlan(result.data, req, brief, parsed), call };
}

/** Enforce the BA's list, valid references and channel conventions, deterministically. */
export function normalizePlan(p: z.infer<ReturnType<typeof planModel>>, req: GenerationRequest, brief: string, parsed: ParsedBrief | null): Plan {
  const notes = [...(parsed?.notes ?? [])];
  let screens: PlanScreen[];
  if (parsed) {
    const byId = new Map(p.screens.map(s => [s.id, s]));
    screens = parsed.screens.map(l => {
      const s = byId.get(l.id);
      if (!s) notes.push('Planner omitted "' + l.title + '"; it was kept with its original requirement');
      return { id: l.id, title: l.title, requirement: l.requirement, purpose: s?.purpose ?? l.requirement.slice(0, 400), template: s?.template ?? null, links: s?.links ?? [], shell: s?.shell ?? 'default', locked: true };
    });
    for (const s of p.screens) if (!parsed.screens.some(l => l.id === s.id)) notes.push('Ignored unlisted screen "' + s.title + '"');
  } else {
    const used = new Set<string>();
    screens = p.screens.map(s => {
      let id = s.id, n = 2; while (used.has(id)) id = s.id + '-' + n++; used.add(id);
      return { id, title: s.title, requirement: s.purpose, purpose: s.purpose, template: s.template, links: s.links, shell: s.shell, locked: false };
    });
  }
  const ids = new Set(screens.map(s => s.id));
  for (const s of screens) s.links = [...new Set(s.links.filter(l => ids.has(l) && l !== s.id))];
  const colours = briefColours(brief + ' ' + (req.guidelines ?? ''));
  const theme = { primary: (colours[0] ?? p.theme.primary).toUpperCase(), secondary: (colours[1] ?? p.theme.secondary).toUpperCase(), accent: (colours[2] ?? p.theme.accent).toUpperCase() };
  let kind = p.shellKind;
  if (req.channel === 'mobile' && kind === 'sidebar') kind = 'tabs';
  if (req.channel === 'portal' && (kind === 'tabs' || kind === 'drawer')) kind = 'sidebar';
  const seenMenu = new Set<string>();
  const items = p.menu.filter(m => ids.has(m.screen) && !seenMenu.has(m.screen) && seenMenu.add(m.screen)).map((m, i) => ({ id: 'menu-' + (i + 1), label: m.label, icon: m.icon, screen: m.screen }));
  const collections: Collection[] = p.collections.map(c => {
    const fields = c.fields.filter((f, i, all) => all.findIndex(x => x.id === f.id) === i);
    const key = fields.some(f => f.id === c.key) ? c.key : fields[0].id;
    const seenKeys = new Set<string>();
    const rows = c.rows.map(r => Object.fromEntries(fields.map((f, i) => [f.id, String(r[i] ?? '')]))).filter(r => r[key] && !seenKeys.has(r[key]) && seenKeys.add(r[key]));
    return { id: c.id, label: c.label, key, fields, rows };
  });
  return { appName: req.name, channel: req.channel, theme, shell: { kind: items.length ? kind : 'none', brand: (req.company || req.name).slice(0, 60), showBack: true, items },
    collections, screens, sampleFacts: p.sampleFacts, globalContext: parsed?.globalContext ?? brief.slice(0, 4000), notes };
}
