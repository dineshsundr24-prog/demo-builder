// Demo Builder v2 API: job-based generation with persisted progress.
import { DemoDocument, LogoDataUrl } from '@demo/schema';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { timingSafeEqual } from 'node:crypto';
import { Generator, JobError, ProviderError, StoreError, type GenerationRequest, type Plan, type Brand } from '@demo/generator';
import { resolveCaller, AuthError, type VerifyUser } from './demos/auth.ts';
import { registerDemoRoutes } from './demos/routes.ts';
import { MemoryDemoStore, type DemoStore } from './demos/store.ts';
import { registerLaunchRoutes } from './launch/routes.ts';
import { registerMeyonSimulator } from './launch/simulator.ts';
import type { MeyonClient } from './launch/meyon.ts';

export type ServerOptions = {
  generator: Generator; accessToken: string; origins: string[]; model: string; logger?: boolean;
  /** Persistent demos (defaults to in-memory). */ demoStore?: DemoStore;
  /** Supabase Auth verification for standalone users (absent: shared UAT token only). */ verifyUser?: VerifyUser;
  /** HMAC secret for Builder sessions (MEYON launches). */ sessionSecret?: string;
  /** Studio origin used to build public demo links. */ publicBaseUrl?: string;
  /** false: the legacy shared UAT token is rejected everywhere (sign-in only). Default true. */ allowUatToken?: boolean;
  /** MEYON server-to-server client (launch grants). Absent: launches from MEYON are not available. */ meyon?: MeyonClient;
  /** Requests per minute per client for paid actions and for launch exchanges (default 20). */ rateLimitPerMinute?: number;
  /** Simulated MEYON for testing/UAT (never with a real MEYON). */ meyonSimulator?: { integrationKey: string; /** tests only: the shared UAT token may prepare launches */ allowSharedToken?: boolean };
};

function tokenOk(given: unknown, expected: string) {
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** Optional brand assets: validated logo data URL, hex colours and a known font. Returns an error message on bad input. */
function parseBrand(b: unknown): Brand | undefined | string {
  if (b === undefined || b === null) return undefined;
  if (typeof b !== 'object') return 'brand must be an object';
  const x = b as Record<string, unknown>, out: Brand = {};
  if (x.logo !== undefined && x.logo !== '') { const ok = LogoDataUrl.safeParse(x.logo); if (!ok.success) return 'Logo must be a PNG, JPEG, WebP or SVG image under 300 KB'; out.logo = ok.data; }
  for (const k of ['primary', 'secondary', 'accent'] as const) if (x[k] !== undefined && x[k] !== '') { if (typeof x[k] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(x[k] as string)) return k + ' colour must look like #17365D'; out[k] = (x[k] as string).toUpperCase(); }
  if (x.font !== undefined && x.font !== '') { if (!['system', 'inter', 'serif', 'rounded'].includes(String(x.font))) return 'Unknown font'; out.font = x.font as Brand['font']; }
  return Object.keys(out).length ? out : undefined;
}
function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof JobError) return reply.code(e.status).send({ error: e.message, category: e.category });
  if (e instanceof ProviderError) return reply.code(502).send({ error: e.message, category: e.category });
  if (e instanceof StoreError) {
    // Database details stay in server logs; clients get a reference they can quote.
    const ref = 'err_' + Math.random().toString(36).slice(2, 10);
    reply.log.error({ ref, status: e.status, detail: e.message }, 'storage error');
    return reply.code(503).send({ error: 'Job storage is temporarily unavailable (reference ' + ref + ')', category: 'storage' });
  }
  reply.log.error(e);
  return reply.code(500).send({ error: 'Unexpected server error', category: 'internal' });
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 }); // room for an optional logo
  const gen = opts.generator;
  await app.register(cors, { origin: opts.origins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'], allowedHeaders: ['content-type', 'x-builder-access', 'authorization'] });
  const demoStore = opts.demoStore ?? new MemoryDemoStore();

  // Simple in-process rate limits per client: paid actions (generation, assistant, launch confirmation) and
  // launch-code exchanges are counted separately (default 20 per minute each).
  const perMinute = opts.rateLimitPerMinute ?? 20;
  const hits = new Map<string, { t: number; n: number }>();
  const limited = (req: FastifyRequest, bucket: 'paid' | 'launch' = 'paid') => {
    const key = bucket + ':' + String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0].trim();
    const now = Date.now(), h = hits.get(key) ?? { t: now, n: 0 };
    if (now - h.t > 60000) { h.t = now; h.n = 0; }
    h.n++; hits.set(key, h);
    return h.n > perMinute;
  };
  // Job and screen ids are validated before they reach the database layer.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.addHook('preHandler', async (req, reply) => {
    const p = (req.params ?? {}) as { id?: string; screenId?: string };
    if (p.id !== undefined && !UUID.test(p.id)) return reply.code(404).send({ error: 'Job not found', category: 'not_found' });
    if (p.screenId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(p.screenId)) return reply.code(404).send({ error: 'Screen not found', category: 'not_found' });
  });
  // Every route except health, status and public demo links needs a caller: a Supabase sign-in, a Builder
  // session (MEYON launch) or the shared UAT token (confined to its own UAT workspace).
  const paid = (url: string) => /^\/api\/v2\/(jobs|assist)|^\/api\/v2\/launches\/[^/]+\/confirm$/.test(url);
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS' || req.url === '/health' || req.url === '/api/v2/status' || req.url.startsWith('/api/v2/public/')) return;
    // Launch codes are exchanged before any session exists (rate-limited); MEYON's own endpoint checks its integration key.
    if (req.url === '/api/v2/launch/exchange') { if (req.method === 'POST' && limited(req, 'launch')) return reply.code(429).send({ error: 'Too many launch attempts; wait a minute', category: 'rate_limit' }); return; }
    if (opts.meyonSimulator && req.url.startsWith('/sim/meyon/demo-builder/')) return;
    try { req.caller = await resolveCaller({ store: demoStore, uatToken: opts.allowUatToken === false ? undefined : opts.accessToken, sessionSecret: opts.sessionSecret, verifyUser: opts.verifyUser }, req.headers); }
    catch (e) {
      if (e instanceof AuthError) return reply.code(e.status).send({ error: e.message, category: 'auth' });
      reply.log.error(e); return reply.code(503).send({ error: 'Sign-in could not be verified right now; try again shortly', category: 'auth_unavailable' });
    }
    if (req.method === 'POST' && paid(req.url) && limited(req)) return reply.code(429).send({ error: 'Too many generation requests; wait a minute', category: 'rate_limit' });
  });
  // Generation jobs belong to whoever started them; legacy unowned jobs stay visible to the UAT token only.
  const ownsJob = (job: { principal_id?: string | null }, req: FastifyRequest) =>
    !!req.caller && (job.principal_id === req.caller.principal.id || (!job.principal_id && req.caller.via === 'uat'));
  app.addHook('preHandler', async (req, reply) => {
    const id = (req.params as { id?: string } | undefined)?.id;
    if (!id || !req.url.startsWith('/api/v2/jobs/')) return;
    const job = await gen.store.getJob(id).catch(() => null);
    if (job && !ownsJob(job, req)) return reply.code(404).send({ error: 'Job not found', category: 'not_found' });
  });
  registerDemoRoutes(app, { store: demoStore, publicBaseUrl: opts.publicBaseUrl });
  registerLaunchRoutes(app, { store: demoStore, generator: gen, meyon: opts.meyon, sessionSecret: opts.sessionSecret });
  if (opts.meyonSimulator) registerMeyonSimulator(app, { integrationKey: opts.meyonSimulator.integrationKey, allowSharedToken: opts.meyonSimulator.allowSharedToken, demoStore, generator: gen, publicBaseUrl: opts.publicBaseUrl });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/api/v2/status', async () => {
    let budget: unknown = null;
    // Public endpoint: never expose storage error details here (they are logged server-side).
    let storage: 'connected' | 'unavailable' = 'connected';
    try { budget = await gen.budgetStatus(); }
    catch (e) { storage = 'unavailable'; budget = null; app.log.error({ detail: e instanceof Error ? e.message : String(e) }, 'status: storage check failed'); }
    return { ready: Boolean(opts.accessToken) && storage === 'connected', launches: !!(opts.meyon && opts.sessionSecret), meyonSimulator: !!opts.meyonSimulator, model: opts.model, store: gen.store.kind, storage, budget, maxScreensPerJob: gen.config.maxScreensPerJob };
  });

  app.post('/api/v2/jobs', async (req, reply) => {
    const body = req.body as { request?: GenerationRequest; brief?: string } | undefined;
    if (!body?.request || typeof body.brief !== 'string') return reply.code(400).send({ error: 'Send {request:{name, channel, company?, guidelines?}, brief}', category: 'bad_request' });
    const r = body.request;
    const brand = parseBrand((r as any).brand);
    if (typeof brand === 'string') return reply.code(400).send({ error: brand, category: 'bad_request' });
    const request: GenerationRequest = { name: String(r.name ?? '').slice(0, 120) || 'Demo', company: String(r.company ?? '').slice(0, 120), channel: r.channel, guidelines: String(r.guidelines ?? '').slice(0, 3000), ...(brand ? { brand } : {}) };
    try { return reply.code(202).send(await gen.startPlan(request, body.brief, req.caller!.principal.id)); } catch (e) { return sendError(reply, e); }
  });
  // Studio AI assistant: add a new screen or change one, on the document the user is editing (it stays client-side).
  app.post('/api/v2/assist', async (req, reply) => {
    const body = req.body as { document?: unknown; instruction?: unknown; history?: unknown; currentScreen?: unknown; mode?: unknown; from?: unknown; to?: unknown; addToMenu?: unknown } | undefined;
    const parsed = DemoDocument.safeParse(body?.document);
    if (!parsed.success) return reply.code(400).send({ error: 'Send {document, instruction}: the document is not a valid v2 document (' + (parsed.error.issues[0]?.message ?? '') + ')', category: 'bad_request' });
    if (typeof body?.instruction !== 'string' || body.instruction.trim().length < 3) return reply.code(400).send({ error: 'Describe what you want to add or change', category: 'bad_request' });
    const mode = body.mode === 'add' || body.mode === 'modify' || body.mode === 'flow' ? body.mode : 'auto';
    if (mode === 'add' && parsed.data.screens.length >= gen.config.maxScreensPerJob) return reply.code(400).send({ error: 'This demo already has ' + parsed.data.screens.length + ' screens (limit ' + gen.config.maxScreensPerJob + ')', category: 'budget' });
    const ref = (v: unknown) => (typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(v) ? v : null);
    try { return await gen.assist(parsed.data, { instruction: body.instruction, history: Array.isArray(body.history) ? body.history.filter((h): h is string => typeof h === 'string').slice(-6).map(h => h.slice(0, 300)) : [], currentScreen: ref(body.currentScreen), mode, from: ref(body.from), to: ref(body.to), addToMenu: body.addToMenu === true }); }
    catch (e) { const c = (e as any)?.category; if (c === 'parse' || c === 'bad_request') return reply.code(422).send({ error: (e as Error).message, category: c }); return sendError(reply, e); }
  });
  app.get('/api/v2/jobs', async (req, reply) => {
    try {
      const jobs = await gen.store.listJobs(Number((req.query as any)?.limit) || 20, { principalId: req.caller!.principal.id, includeLegacy: req.caller!.via === 'uat' });
      // Keep the list light: logos are not needed to pick a job.
      return { jobs: jobs.map(j => ({ ...j, request: { ...j.request, brand: undefined } })) };
    } catch (e) { return sendError(reply, e); }
  });
  app.get('/api/v2/jobs/:id', async (req, reply) => {
    try { return await gen.snapshot((req.params as any).id); } catch (e) { return sendError(reply, e); }
  });
  app.get('/api/v2/jobs/:id/document', async (req, reply) => {
    try {
      const { job } = await gen.snapshot((req.params as any).id);
      if (!job.document) return reply.code(409).send({ error: 'Job is ' + job.status + '; no document yet', category: 'conflict' });
      return job.document;
    } catch (e) { return sendError(reply, e); }
  });
  app.post('/api/v2/jobs/:id/approve', async (req, reply) => {
    try { return await gen.approvePlan((req.params as any).id, (req.body as { plan?: Plan } | undefined)?.plan); } catch (e) { return sendError(reply, e); }
  });
  app.post('/api/v2/jobs/:id/retry', async (req, reply) => {
    try { return { regenerating: await gen.retry((req.params as any).id) }; } catch (e) { return sendError(reply, e); }
  });
  app.post('/api/v2/jobs/:id/screens/:screenId/regenerate', async (req, reply) => {
    const p = req.params as { id: string; screenId: string };
    try { await gen.regenerateScreen(p.id, p.screenId); return { regenerating: [p.screenId] }; } catch (e) { return sendError(reply, e); }
  });
  app.post('/api/v2/jobs/:id/cancel', async (req, reply) => {
    try { return await gen.cancel((req.params as any).id); } catch (e) { return sendError(reply, e); }
  });
  // Server-sent events: snapshot first, then live updates; fetch() clients can send the access header.
  app.get('/api/v2/jobs/:id/events', async (req, reply) => {
    const id = (req.params as any).id as string;
    let snap;
    try { snap = await gen.snapshot(id); } catch (e) { return sendError(reply, e); }
    reply.hijack();
    const origin = req.headers.origin;
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...(origin && opts.origins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) });
    const send = (type: string, data: unknown) => reply.raw.write('event: ' + type + '\ndata: ' + JSON.stringify(data) + '\n\n');
    send('snapshot', snap);
    const onEvent = (ev: { type: string; data: unknown }) => send(ev.type, ev.data);
    gen.events.on(id, onEvent);
    const beat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15000);
    req.raw.on('close', () => { clearInterval(beat); gen.events.off(id, onEvent); });
  });
  return app;
}
