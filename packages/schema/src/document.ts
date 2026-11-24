import { z } from 'zod';
import { ID, Color, ScreenRef } from './primitives.ts';
import { Node } from './registry.ts';

export const Screen = z.object({
  id: ID, title: z.string().min(1).max(85), subtitle: z.string().max(160).optional(),
  // 'hidden' removes the app shell (tabs/sidebar) for focused flows such as sign-in.
  shell: z.enum(['default', 'hidden']),
  children: z.array(Node).max(40),
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

export const Theme = z.object({ primary: Color, secondary: Color, accent: Color, radius: z.enum(['sm', 'md', 'lg']), font: z.enum(['system', 'inter', 'serif']) });

export const DemoDocument = z.object({
  schemaVersion: z.literal(2),
  id: ID, name: z.string().min(1).max(120), channel: z.enum(['mobile', 'portal']),
  theme: Theme, shell: Shell,
  collections: z.array(Collection).max(30),
  screens: z.array(Screen).min(1), // no fixed upper limit (budgets are enforced by generation jobs)
});
export type DemoDocument = z.infer<typeof DemoDocument>;
