// Calls from MEYON to the Builder (server-to-server, integration key). Today: AI screen suggestions for the prompt
// MEYON's Demo tab is preparing (the hybrid preparation: MEYON composes the approved sections, the Builder suggests).
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { suggestionText, type Generator } from '@demo/generator';
import type { DemoStore } from '../demos/store.ts';

const Ref = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
const Item = z.object({ id: Ref, text: z.string().trim().min(1).max(600) });
const SuggestBody = z.object({
  tenantId: Ref, channel: z.enum(['mobile', 'portal']),
  project: z.object({ name: z.string().trim().min(1).max(120), goal: z.string().max(2000).default(''), personas: z.array(z.string().max(120)).max(20).default([]) }),
  story: z.object({ id: Ref, title: z.string().trim().min(1).max(200), text: z.string().max(4000).default('') }),
  criteria: z.array(Item).min(1).max(40), rules: z.array(Item).max(40).default([]), integrations: z.array(z.string().max(160)).max(20).default([]),
  baseDemoId: z.string().uuid().nullable().default(null),
});

export function registerIntegrationRoutes(app: FastifyInstance, opts: { store: DemoStore; generator: Generator; integrationKey?: string }) {
  const keyOk = (h: unknown) => {
    if (!opts.integrationKey) return false;
    const given = Buffer.from(String(/^Bearer\s+(.+)$/i.exec(String(h ?? ''))?.[1] ?? '')), want = Buffer.from(opts.integrationKey);
    return given.length === want.length && timingSafeEqual(given, want);
  };
  app.post('/api/v2/integration/suggest-screens', async (req, reply) => {
    if (!keyOk(req.headers.authorization)) return reply.code(401).send({ error: 'Invalid integration credential' });
    const p = SuggestBody.safeParse(req.body);
    if (!p.success) return reply.code(422).send({ error: 'Invalid request: ' + p.error.issues[0]?.path.join('.') + ' ' + p.error.issues[0]?.message });
    const b = p.data;
    let existingScreens: string[] = [];
    if (b.baseDemoId) {
      // Only a demo of the same MEYON tenant can inform the suggestion.
      const d = await opts.store.getDemo(b.baseDemoId).catch(() => null);
      const w = d ? await opts.store.getWorkspace(d.workspace_id) : null;
      if (d && w?.kind === 'meyon' && w.external_ref === b.tenantId) existingScreens = ((d.draft as { screens?: { title: string }[] }).screens ?? []).map(s => s.title);
    }
    try {
      const r = await opts.generator.suggest({ channel: b.channel, projectName: b.project.name, projectGoal: b.project.goal, personas: b.project.personas, story: b.story,
        criteria: b.criteria, rules: b.rules, integrations: b.integrations, existingScreens });
      return { text: suggestionText(r, b.criteria), screens: r.screens, journey: r.journey, gaps: r.gaps, costUsd: r.costUsd };
    } catch (e) {
      const cat = (e as { category?: string }).category;
      return reply.code(cat === 'budget' ? 402 : 502).send({ error: 'Screen suggestion failed: ' + (e instanceof Error ? e.message : String(e)) });
    }
  });
}
