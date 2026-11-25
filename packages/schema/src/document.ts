import { z } from 'zod';
import { ID, Color, ScreenRef } from './primitives.ts';
import { Node } from './registry.ts';

// Requirement traceability: which approved story and acceptance criteria a screen demonstrates.
// Ids are MEYON's stable references (story "US-014", criterion "US-014:ac-3f9a2b"). Never shown on published links.
export const TraceRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/, 'Use a story or criterion reference such as US-014');
export const TraceLink = z.object({
  story: TraceRef,
  criteria: z.array(TraceRef).max(40),
  // high: planned and visibly shown on the screen; medium: planned, only partly visible; low: planned, not visible yet.
  confidence: z.enum(['high', 'medium', 'low']),
  source: z.enum(['generated', 'manual']),
});
export type TraceLink = z.infer<typeof TraceLink>;

export const Screen = z.object({
  id: ID, title: z.string().min(1).max(85), subtitle: z.string().max(160).optional(),
  // 'hidden' removes the app shell (tabs/sidebar) for focused flows such as sign-in.
  shell: z.enum(['default', 'hidden']),
  children: z.array(Node).max(40),
  trace: z.array(TraceLink).max(10).optional(),
});
export type Screen = z.infer<typeof Screen>;

const MenuItem = z.object({ id: ID, label: z.string().min(1).max(30), icon: z.string().max(30), screen: ScreenRef });
export const Shell = z.object({
  kind: z.enum(['tabs', 'drawer', 'sidebar', 'none']),
  brand: z.string().min(1).max(60),
  showBack: z.boolean(),
  // Portal sidebars may group pages one level deep.
  items: z.array(MenuItem.extend({ children: z.array(MenuItem).max(10).optional() })).max(12),
});
export type Shell = z.infer<typeof Shell>;

export const Collection = z.object({
  id: ID, label: z.string().min(1).max(60),
  key: z.string().min(1).max(40), // field that uniquely identifies a row (used to pass records)
  fields: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(40) })).min(1).max(16),
  rows: z.array(z.record(z.string(), z.string().max(300))).max(500),
});
export type Collection = z.infer<typeof Collection>;

// logo: optional uploaded brand logo as a data URL (rendered with <img>, so SVG scripts never run).
export const LogoDataUrl = z.string().max(400_000).regex(/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/, 'Logo must be a PNG, JPEG, WebP or SVG image');
export const Theme = z.object({ primary: Color, secondary: Color, accent: Color, radius: z.enum(['sm', 'md', 'lg']), font: z.enum(['system', 'inter', 'serif', 'rounded']), logo: LogoDataUrl.optional() });

export const DemoDocument = z.object({
  schemaVersion: z.literal(2),
  id: ID, name: z.string().min(1).max(120), channel: z.enum(['mobile', 'portal']),
  theme: Theme, shell: Shell,
  collections: z.array(Collection).max(30),
  screens: z.array(Screen).min(1), // no fixed upper limit (budgets are enforced by generation jobs)
});
export type DemoDocument = z.infer<typeof DemoDocument>;
