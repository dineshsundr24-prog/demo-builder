// Demo Builder v2 API: job-based generation with persisted progress.
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { timingSafeEqual } from 'node:crypto';
import { Generator, JobError, ProviderError, StoreError, type GenerationRequest, type Plan, type Brand } from '@demo/generator';
import { LogoDataUrl } from '@demo/schema';

export type ServerOptions = { generator: Generator; accessToken: string; origins: string[]; model: string; logger?: boolean };

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
  await app.register(cors, { origin: opts.origins, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['content-type', 'x-builder-access'] });

  // Simple in-process rate limit for paid actions: 20 per minute per client.
  const hits = new Map<string, { t: number; n: number }>();
  const limited = (req: FastifyRequest) => {
    const key = String(req.headers['x-forwarded-for'] ?? req.ip).split(',')[0].trim();
    const now = Date.now(), h = hits.get(key) ?? { t: now, n: 0 };
    if (now - h.t > 60000) { h.t = now; h.n = 0; }
    h.n++; hits.set(key, h);
    return h.n > 20;
  };
  // Job and screen ids are validated before they reach the database layer.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  app.addHook('preHandler', async (req, reply) => {
    const p = (req.params ?? {}) as { id?: string; screenId?: string };
    if (p.id !== undefined && !UUID.test(p.id)) return reply.code(404).send({ error: 'Job not found', category: 'not_found' });
    if (p.screenId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(p.screenId)) return reply.code(404).send({ error: 'Screen not found', category: 'not_found' });
  });
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'OPTIONS' || req.url === '/health' || req.url === '/api/v2/status') return;
    if (!tokenOk(req.headers['x-builder-access'], opts.accessToken)) return reply.code(401).send({ error: 'Missing or invalid Demo Builder access token', category: 'auth' });
    if (req.method === 'POST' && limited(req)) return reply.code(429).send({ error: 'Too many generation requests; wait a minute', category: 'rate_limit' });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/api/v2/status', async () => {
    let budget: unknown = null;
    // Public endpoint: never expose storage error details here (they are logged server-side).
    let storage: 'connected' | 'unavailable' = 'connected';
    try { budget = await gen.budgetStatus(); }
    catch (e) { storage = 'unavailable'; budget = null; app.log.error({ detail: e instanceof Error ? e.message : String(e) }, 'status: storage check failed'); }
    return { ready: Boolean(opts.accessToken) && storage === 'connected', model: opts.model, store: gen.store.kind, storage, budget, maxScreensPerJob: gen.config.maxScreensPerJob };
  });

  app.post('/api/v2/jobs', async (req, reply) => {
    const body = req.body as { request?: GenerationRequest; brief?: string } | undefined;
    if (!body?.request || typeof body.brief !== 'string') return reply.code(400).send({ error: 'Send {request:{name, channel, company?, guidelines?}, brief}', category: 'bad_request' });
    const r = body.request;
    const brand = parseBrand((r as any).brand);
    if (typeof brand === 'string') return reply.code(400).send({ error: brand, category: 'bad_request' });
    const request: GenerationRequest = { name: String(r.name ?? '').slice(0, 120) || 'Demo', company: String(r.company ?? '').slice(0, 120), channel: r.channel, guidelines: String(r.guidelines ?? '').slice(0, 3000), ...(brand ? { brand } : {}) };
    try { return reply.code(202).send(await gen.startPlan(request, body.brief)); } catch (e) { return sendError(reply, e); }
  });
  app.get('/api/v2/jobs', async (req, reply) => {
    try {
      const jobs = await gen.store.listJobs(Number((req.query as any)?.limit) || 20);
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
