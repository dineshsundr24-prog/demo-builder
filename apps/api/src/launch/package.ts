// The launch package (contract v1): what MEYON hands the Builder for one reviewed demo request.
// MEYON returns it only server-to-server, when the Builder consumes a launch grant with its integration key.
// Everything here is validated; unknown fields are dropped. Approved content (story, acceptance criteria,
// business rules) is kept separate from optional AI suggestions, which are never treated as requirements.
import { z } from 'zod';
import type { GenerationRequest, Requirement } from '@demo/generator';

const Ref = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/, 'must be a stable reference such as US-014');
const Text = (max: number) => z.string().trim().min(1).max(max);
const When = z.string().datetime({ offset: true });
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const Item = z.object({ id: Ref, text: Text(600) });

export const LaunchPackage = z.object({
  packageVersion: z.literal(1),
  grantId: Ref,
  issuedAt: When, expiresAt: When,
  tenant: z.object({ id: Ref, name: Text(120) }),
  // MEYON's current shared login is not an individual identity: verified stays false until MEYON has real sign-in.
  actor: z.object({ ref: Ref, name: Text(120), verified: z.boolean() }),
  project: z.object({ id: Ref, name: Text(120), goal: z.string().trim().max(2000).default(''), personas: z.array(Text(120)).max(20).default([]) }),
  story: z.object({ id: Ref, title: Text(200), artifactVersion: z.number().int().positive(), contentHash: z.string().regex(/^[0-9a-f]{64}$/) }),
  feature: z.object({ id: Ref, name: Text(120) }).nullable().default(null),
  mode: z.enum(['create', 'extend']),
  channel: z.enum(['mobile', 'portal']),
  // Extend: the baseline is resolved by these stable ids; the URL is only shown to the user.
  base: z.object({ demoId: z.string().uuid(), version: z.number().int().positive(), url: z.string().url().max(500) }).nullable().default(null),
  prompt: z.object({ revision: z.number().int().positive(), text: z.string().trim().min(15).max(20000), reviewedAt: When }),
  approved: z.object({
    acceptanceCriteria: z.array(Item).min(1).max(40),
    businessRules: z.array(Item).max(40).default([]),
    actors: z.array(Text(120)).max(20).default([]),
    integrations: z.array(Text(160)).max(20).default([]),
  }),
  suggestions: z.array(Text(600)).max(30).default([]),
  branding: z.object({ company: z.string().trim().max(120).default(''), primary: Hex.optional(), secondary: Hex.optional(), accent: Hex.optional(),
    font: z.enum(['system', 'inter', 'serif', 'rounded']).optional() }).default({ company: '' }),
  sources: z.array(z.object({ kind: Text(40), ref: Ref, version: z.string().max(40), hash: z.string().max(128) })).max(50).default([]),
}).superRefine((p, ctx) => {
  if (p.mode === 'extend' && !p.base) ctx.addIssue({ code: 'custom', path: ['base'], message: 'Extend needs a base demo' });
  if (p.mode === 'create' && p.base) ctx.addIssue({ code: 'custom', path: ['base'], message: 'Create must not name a base demo' });
  if (Date.parse(p.expiresAt) <= Date.parse(p.issuedAt)) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'expires before it was issued' });
  const ids = p.approved.acceptanceCriteria.map(c => c.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['approved', 'acceptanceCriteria'], message: 'criterion ids must be unique' });
});
export type LaunchPackage = z.infer<typeof LaunchPackage>;

export const channelLabel = (c: 'mobile' | 'portal') => (c === 'mobile' ? 'Mobile App' : 'Staff Portal');

/** The approved requirements, as the generator's traceability input. */
export function requirementsOf(p: LaunchPackage): Requirement[] {
  return [{ story: p.story.id, title: p.story.title, criteria: p.approved.acceptanceCriteria.map(c => ({ id: c.id, text: c.text })) }];
}

/**
 * The generation brief: the prompt the user reviewed in MEYON, followed by the approved items, labelled as such.
 * Deterministic: the same package always gives the same brief.
 */
export function briefOf(p: LaunchPackage): string {
  const parts = [p.prompt.text.trim()];
  const list = (title: string, items: string[]) => { if (items.length) parts.push(title + '\n' + items.map(i => '- ' + i).join('\n')); };
  parts.push('Approved user story ' + p.story.id + ' (version ' + p.story.artifactVersion + '): ' + p.story.title);
  list('Approved acceptance criteria (each must be demonstrated):', p.approved.acceptanceCriteria.map(c => '[' + c.id + '] ' + c.text));
  list('Approved business rules:', p.approved.businessRules.map(r => '[' + r.id + '] ' + r.text));
  list('Actors:', p.approved.actors);
  list('Integrations to simulate (demo only, never real):', p.approved.integrations);
  if (p.project.goal) parts.push('Project goal: ' + p.project.goal);
  list('Optional AI suggestions (not approved requirements; use only where they help):', p.suggestions);
  return parts.join('\n\n').slice(0, 60000);
}

export function requestOf(p: LaunchPackage): GenerationRequest {
  const b = p.branding;
  const brand = { ...(b.primary ? { primary: b.primary.toUpperCase() } : {}), ...(b.secondary ? { secondary: b.secondary.toUpperCase() } : {}), ...(b.accent ? { accent: b.accent.toUpperCase() } : {}), ...(b.font ? { font: b.font } : {}) };
  return { name: (p.project.name + ' ' + channelLabel(p.channel)).slice(0, 120), company: b.company, channel: p.channel, guidelines: '',
    ...(Object.keys(brand).length ? { brand } : {}), requirements: requirementsOf(p) };
}
