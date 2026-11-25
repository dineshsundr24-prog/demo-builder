// Simulated MEYON (testing and UAT only; MEYON_SIMULATOR=on). It behaves like the MEYON side of the contract:
//   * a signed-in Builder user prepares a launch from a sample approved story (the Demo tab's role) and gets
//     an opaque, single-use launch code that expires in 5 minutes;
//   * the Builder API consumes the code server-to-server with the integration key and receives the package.
// Grants live in memory: a restart simply invalidates open launch links, like an expired grant.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DemoStore } from '../demos/store.ts';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
export const SIM_TENANT = { id: 'sim-tenant', name: 'Simulated MEYON tenant' };
export const SIM_PROJECT = { id: 'PRJ-NEXA', name: 'Nexa Bank', goal: 'Digital retail banking for UAE customers: everyday banking, cards and personal finance, with staff operations in a back-office portal.', personas: ['Retail customer', 'Branch operations officer (maker)', 'Credit supervisor (checker)'] };

type Scenario = { story: { id: string; title: string; text: string; version: number }; channel: 'mobile' | 'portal'; feature: { id: string; name: string };
  criteria: string[]; rules: string[]; actors: string[]; integrations: string[]; suggestions: string[] };
export const SCENARIOS: Scenario[] = [
  { story: { id: 'US-101', version: 3, title: 'Apply for a personal loan in the mobile app', text: 'As a retail customer I want to check my eligibility, choose a loan amount and tenure, see the monthly instalment and submit a personal loan application with my salary certificate, so that I can get financing without visiting a branch.' },
    channel: 'mobile', feature: { id: 'FE-LOANS', name: 'Personal loans' },
    criteria: ['The customer chooses a loan amount between AED 10,000 and AED 500,000 and a tenure of 12 to 48 months', 'The monthly instalment and total repayable amount update as the amount or tenure changes', 'The customer uploads a salary certificate before submitting', 'The customer reviews all application details and accepts the terms before submitting', 'After submission the customer sees an application reference number and the next steps'],
    rules: ['Maximum debt burden ratio is 50% of monthly salary', 'Minimum monthly salary is AED 8,000'], actors: ['Retail customer'], integrations: ['UAE PASS sign-in', 'Al Etihad Credit Bureau score check'],
    suggestions: ['Show an eligibility indicator before the application form', 'Offer to save the application as a draft'] },
  { story: { id: 'US-102', version: 2, title: 'Review personal loan applications (maker-checker)', text: 'As a credit operations officer I want to review submitted personal loan applications, check documents and the credit bureau result, and recommend approval or rejection, so that a supervisor can make the final decision.' },
    channel: 'portal', feature: { id: 'FE-LOANS', name: 'Personal loans' },
    criteria: ['Officers see a queue of submitted applications with reference, customer, amount, status and submitted date', 'Officers can filter the queue by status', 'Opening an application shows customer details, requested amount, tenure, salary and uploaded documents', 'The maker records a recommendation with a mandatory comment', 'A checker approves or rejects a recommended application and the status updates in the queue'],
    rules: ['The checker must be a different person from the maker', 'Applications above AED 250,000 need a credit supervisor as checker'], actors: ['Operations officer (maker)', 'Credit supervisor (checker)'], integrations: ['Core banking customer lookup', 'Al Etihad Credit Bureau report'],
    suggestions: ['Show an SLA indicator for applications waiting more than 2 days'] },
  { story: { id: 'US-103', version: 1, title: 'Freeze and unfreeze a debit card', text: 'As a retail customer I want to temporarily freeze my debit card and unfreeze it later, so that I can protect my account if I misplace my card.' },
    channel: 'mobile', feature: { id: 'FE-CARDS', name: 'Card management' },
    criteria: ['The customer sees each card with its masked number and current status', 'The customer can freeze an active card after confirming', 'The customer can unfreeze a frozen card', 'A confirmation message shows the new card status'],
    rules: ['Only the last four digits of a card number are ever shown'], actors: ['Retail customer'], integrations: ['Card management system'], suggestions: [] },
];

/** The deterministic prompt MEYON's Demo tab would compose for review. */
export function composePrompt(s: Scenario): string {
  return ['Build a ' + (s.channel === 'mobile' ? 'mobile banking app' : 'staff portal') + ' demo for ' + SIM_PROJECT.name + ' that demonstrates the approved user story below.',
    s.story.id + ': ' + s.story.title, s.story.text, 'Personas: ' + SIM_PROJECT.personas.join(', ') + '.'].join('\n\n');
}

type Grant = { codeHash: string; expiresAt: number; pkg: Record<string, unknown> };

export function registerMeyonSimulator(app: FastifyInstance, opts: { integrationKey: string; demoStore: DemoStore; publicBaseUrl?: string; allowSharedToken?: boolean }) {
  const grants = new Map<string, Grant>();
  const keyOk = (h: unknown) => { const given = Buffer.from(String(/^Bearer\s+(.+)$/i.exec(String(h ?? ''))?.[1] ?? '')), want = Buffer.from(opts.integrationKey); return given.length === want.length && timingSafeEqual(given, want); };
  /** The simulator's "Demo tab" is for signed-in Builder users only (never the shared UAT token or MEYON sessions). */
  const user = (req: FastifyRequest) => (req.caller?.via === 'supabase' || (opts.allowSharedToken && req.caller?.via === 'uat') ? req.caller : null);
  const simWorkspace = () => opts.demoStore.ensureWorkspace({ kind: 'meyon', name: SIM_TENANT.name, external_ref: SIM_TENANT.id });

  app.get('/sim/meyon/scenarios', async (req, reply) => {
    if (!user(req)) return reply.code(403).send({ error: 'Sign in to use the MEYON simulator', category: 'forbidden' });
    return { project: SIM_PROJECT, tenant: SIM_TENANT, scenarios: SCENARIOS.map(s => ({ storyId: s.story.id, title: s.story.title, version: s.story.version, channel: s.channel, feature: s.feature.name, criteria: s.criteria.length, prompt: composePrompt(s) })) };
  });
  // Existing demos of the simulated tenant, so Extend can be tried (MEYON learns these through sync events).
  app.get('/sim/meyon/baselines', async (req, reply) => {
    if (!user(req)) return reply.code(403).send({ error: 'Sign in to use the MEYON simulator', category: 'forbidden' });
    const ws = await simWorkspace();
    const demos = await opts.demoStore.listDemos([ws.id], { projectRef: SIM_PROJECT.id });
    return { baselines: demos.filter(d => d.latest_version > 0).map(d => ({ demoId: d.id, name: d.name, channel: d.channel, isPrimary: d.is_primary, latestVersion: d.latest_version })) };
  });
  app.post('/sim/meyon/grants', async (req, reply) => {
    const u = user(req);
    if (!u) return reply.code(403).send({ error: 'Sign in to use the MEYON simulator', category: 'forbidden' });
    const b = (req.body ?? {}) as { storyId?: string; mode?: string; baseDemoId?: string; baseVersion?: number; prompt?: string; expiresInSeconds?: number };
    const s = SCENARIOS.find(x => x.story.id === b.storyId);
    if (!s) return reply.code(400).send({ error: 'Choose a sample story', category: 'bad_request' });
    const mode = b.mode === 'extend' ? 'extend' : 'create';
    if (mode === 'extend' && (typeof b.baseDemoId !== 'string' || !Number.isInteger(b.baseVersion))) return reply.code(400).send({ error: 'Choose a base demo and version to extend', category: 'bad_request' });
    const code = randomBytes(32).toString('base64url');
    const now = Date.now(), ttl = Math.min(Math.max(Number(b.expiresInSeconds) || 300, 1), 300) * 1000;
    const prompt = typeof b.prompt === 'string' && b.prompt.trim().length >= 15 ? b.prompt.trim().slice(0, 20000) : composePrompt(s);
    const storyHash = sha(s.story.id + '\n' + s.story.version + '\n' + s.story.text + '\n' + s.criteria.join('\n'));
    const pkg = {
      packageVersion: 1, grantId: 'sim-' + randomBytes(9).toString('hex'), issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + ttl).toISOString(),
      tenant: SIM_TENANT, actor: { ref: 'meyon-web-user', name: 'MEYON Web User', verified: false },
      project: SIM_PROJECT, story: { id: s.story.id, title: s.story.title, artifactVersion: s.story.version, contentHash: storyHash }, feature: s.feature,
      mode, channel: s.channel,
      base: mode === 'extend' ? { demoId: b.baseDemoId, version: b.baseVersion, url: (opts.publicBaseUrl ?? 'https://demo-builder.invalid') + '/?demo=' + b.baseDemoId + '&v=' + b.baseVersion } : null,
      prompt: { revision: 1, text: prompt, reviewedAt: new Date(now).toISOString() },
      approved: { acceptanceCriteria: s.criteria.map((text, i) => ({ id: s.story.id + ':ac-' + sha(text).slice(0, 6) + (i + 1), text })),
        businessRules: s.rules.map((text, i) => ({ id: 'BR-' + s.story.id.slice(3) + '-' + (i + 1), text })), actors: s.actors, integrations: s.integrations },
      suggestions: s.suggestions,
      branding: { company: SIM_PROJECT.name, primary: '#0B3D91', secondary: '#1E88E5', accent: '#F9A825', font: 'inter' },
      sources: [{ kind: 'FINAL_USER_STORY', ref: s.story.id, version: String(s.story.version), hash: storyHash }, { kind: 'FEATURE', ref: s.feature.id, version: '1', hash: sha(s.feature.name) }],
    };
    for (const [k, g] of grants) if (g.expiresAt < now) grants.delete(k);
    grants.set(sha(code), { codeHash: sha(code), expiresAt: now + ttl, pkg });
    return { code, expiresAt: pkg.expiresAt, grantId: pkg.grantId };
  });
  // MEYON's server-to-server endpoint: integration key required, single use, expiry enforced.
  app.post('/sim/meyon/demo-builder/v1/launch-grants/consume', async (req, reply) => {
    if (!keyOk(req.headers.authorization)) return reply.code(401).send({ error: 'Invalid integration credential' });
    const code = String((req.body as { code?: unknown } | undefined)?.code ?? '');
    const h = sha(code), g = grants.get(h);
    grants.delete(h); // consumed (or unknown) in one step: a second attempt always fails
    if (!g || g.expiresAt < Date.now()) return reply.code(410).send({ error: 'Launch grant expired, already used or unknown' });
    return g.pkg;
  });
}
