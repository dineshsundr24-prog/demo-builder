// AI assistance for prompt preparation (MEYON Demo tab): propose the screens and journey that demonstrate an
// approved story. The output is a labelled SUGGESTION the user reviews and edits; it never changes approved
// requirements. Rendered as a numbered screen list, which the brief parser then keeps exactly (titles and order).
import { z } from 'zod';
import { toStrictSchema, clampToSchema } from '@demo/schema';
import type { CompletionResult, LlmProvider } from './provider.ts';

export type SuggestInput = {
  channel: 'mobile' | 'portal'; projectName: string; projectGoal?: string; personas?: string[];
  story: { id: string; title: string; text: string };
  criteria: { id: string; text: string }[]; rules?: { id: string; text: string }[]; integrations?: string[];
  /** Screens the base demo already has (Extend), so the suggestion adds to them instead of rebuilding. */ existingScreens?: string[];
};
export type ScreenSuggestion = { title: string; purpose: string; details: string[]; criteria: string[] };
export type Suggestion = { screens: ScreenSuggestion[]; journey: string; gaps: string[] };

const INSTRUCTIONS = `You are a senior banking product designer preparing a clickable demo of ONE approved user story.
Propose the screens that demonstrate it, in journey order. Rules:
- Cover every acceptance criterion; list the ids each screen demonstrates (criteria). A criterion may span screens.
- Real product structure: an entry point (home/dashboard or the relevant menu), the task screens, a review step before any submission, a success screen with a reference number, and where the customer or staff later tracks the outcome. Do not add unrelated features.
- A NEW app (no existingScreens) starts with its home screen (mobile: dashboard showing the entry point to this task; portal: the work queue or dashboard) and includes where the outcome is tracked afterwards (e.g. "My Applications" with statuses); these count towards the total.
- Use a calculator step for amounts with tenure/instalments, a dedicated upload step for documents, never a form field for computed figures.
- 4-9 screens for a mobile app, 3-8 for a staff portal. Short titles (2-4 words), title case, no app name.
- purpose: one or two sentences of what the screen shows and lets the user do.
- details: 3-6 concrete content items (fields, figures, statuses, actions), consistent with the business rules (use their exact limits and values).
- Respect the business rules exactly; never invent new rules, fees or limits. If something needed for a convincing demo is not specified (e.g. interest rate, document formats), list it under gaps as a short question instead of inventing it.
- Integrations are simulated in the demo; show them as steps or statuses, never as real connections.
- When existingScreens are given, the app already has them: propose only new or changed screens, and name existing screens exactly when they change.`;

function model(criteriaIds: string[]) {
  return z.object({
    journey: z.string().min(1).max(400),
    screens: z.array(z.object({ title: z.string().min(2).max(40), purpose: z.string().min(5).max(300), details: z.array(z.string().min(2).max(100)).min(2).max(6),
      criteria: z.array(criteriaIds.length ? z.enum(criteriaIds as [string, ...string[]]) : z.string().max(80)).max(10) })).min(2).max(10),
    gaps: z.array(z.string().min(5).max(160)).max(5),
  });
}

export async function suggestScreens(provider: LlmProvider, input: SuggestInput): Promise<{ suggestion: Suggestion; call: CompletionResult }> {
  const ids = input.criteria.map(c => c.id);
  const m = model(ids);
  const call = await provider.complete({ purpose: 'plan', instructions: INSTRUCTIONS, schemaName: 'screen_suggestion', schema: toStrictSchema(m), maxOutputTokens: 3000,
    input: JSON.stringify({ channel: input.channel === 'mobile' ? 'mobile banking app' : 'staff (back-office) web portal', project: { name: input.projectName, goal: input.projectGoal ?? '', personas: input.personas ?? [] },
      story: input.story, acceptanceCriteria: input.criteria, businessRules: input.rules ?? [], integrationsToSimulate: input.integrations ?? [], existingScreens: input.existingScreens ?? [] }) });
  const raw: any = structuredClone(call.json);
  for (const s of raw?.screens ?? []) if (Array.isArray(s?.criteria)) s.criteria = s.criteria.filter((c: unknown) => !ids.length || ids.includes(String(c)));
  const parsed = m.safeParse(clampToSchema(m, raw));
  if (!parsed.success) throw Object.assign(Error('The screen suggestion did not match its schema: ' + parsed.error.issues[0]?.message), { category: 'parse' });
  // Unique titles, so the numbered list stays unambiguous.
  const seen = new Set<string>();
  const screens = parsed.data.screens.filter(s => { const k = s.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { suggestion: { screens, journey: parsed.data.journey, gaps: parsed.data.gaps }, call };
}

/** The suggestion as a prompt section: a numbered screen list (kept exactly by the brief parser). */
export function suggestionText(s: Suggestion, criteria: { id: string }[]): string {
  const label = (id: string) => { const i = criteria.findIndex(c => c.id === id); return i >= 0 ? 'AC' + (i + 1) : id; };
  const lines = ['Screens to build (AI suggestion, reviewed and edited by the user):', ''];
  s.screens.forEach((x, i) => {
    lines.push((i + 1) + '. **' + x.title + ':** ' + x.purpose);
    for (const d of x.details) lines.push('   - ' + d);
    if (x.criteria.length) lines.push('   - Demonstrates ' + x.criteria.map(label).join(', '));
  });
  lines.push('', 'Journey: ' + s.journey);
  if (s.gaps.length) lines.push('', 'Open questions (not requirements; confirm or answer before launching):', ...s.gaps.map(g => '- ' + g));
  return lines.join('\n');
}
