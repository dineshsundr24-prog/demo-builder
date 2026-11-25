// Launches from MEYON (Phase A2).
//   POST /api/v2/launch/exchange        {code}  -> consume the grant with MEYON (server-to-server), validate and record
//                                                 the package, return a Builder session scoped to that project.
//   GET  /api/v2/launches/:id                    -> what was launched, for the confirmation screen
//   POST /api/v2/launches/:id/confirm            -> Create: start the plan. Extend: verify and open the baseline.
//   POST /api/v2/launches/:id/cancel
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Generator } from '@demo/generator';
import { authorize, AuthError, issueSession, type Caller, type Op } from '../demos/auth.ts';
import { contentHash, demoErrorReply } from '../demos/routes.ts';
import { DemoConflict, DemoNotFound, type DemoStore, type LaunchRow } from '../demos/store.ts';
import { LaunchPackage, briefOf, channelLabel, requestOf } from './package.ts';
import type { MeyonClient } from './meyon.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What a MEYON session may do: work on demos of its project; never archive. */
export const LAUNCH_OPS: Op[] = ['read', 'edit', 'version', 'publish', 'fork', 'primary', 'create'];
const SESSION_TTL = 8 * 3600;

export type LaunchOptions = { store: DemoStore; generator: Generator; meyon?: MeyonClient; sessionSecret?: string };

/** Is the requested baseline usable: same tenant workspace, project and application type, and the version exists? */
async function baseCheck(store: DemoStore, l: LaunchRow) {
  if (l.mode !== 'extend' || !l.base_demo_id || !l.base_version) return null;
  const d = await store.getDemo(l.base_demo_id);
  if (!d || d.workspace_id !== l.workspace_id || d.project_ref !== l.project_ref || d.archived_at) return { ok: false as const, problem: 'The base demo was not found in this project. It may have been archived, or it belongs to another project.' };
  if (d.channel !== l.channel) return { ok: false as const, problem: 'The base demo is a ' + channelLabel(d.channel) + ', but this story was launched for the ' + channelLabel(l.channel) + '.' };
  const v = await store.getVersion(d.id, l.base_version);
  if (!v) return { ok: false as const, problem: 'Version ' + l.base_version + ' of "' + d.name + '" does not exist.' };
  return { ok: true as const, demoId: d.id, name: d.name, version: l.base_version, latestVersion: d.latest_version, newerExists: d.latest_version > l.base_version, contentHash: v.content_hash };
}

export function registerLaunchRoutes(app: FastifyInstance, opts: LaunchOptions) {
  const { store } = opts;
  type Req = FastifyRequest & { params: any; body: any };
  const route = (fn: (req: Req, c: Caller) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    try { if (!req.caller) throw new AuthError('Sign in required'); return await fn(req as Req, req.caller); } catch (e) { return demoErrorReply(reply, e); }
  };
  const launchFor = async (c: Caller, id: string, op: Op) => {
    if (!UUID.test(id)) throw new DemoNotFound('Not found');
    const l = await store.getLaunch(id);
    if (!l) throw new DemoNotFound('Not found');
    await authorize(store, c, op, l.workspace_id, { project_ref: l.project_ref });
    return l;
  };

  app.post('/api/v2/launch/exchange', async (req, reply) => {
    const fail = (status: number, error: string, category: string) => reply.code(status).send({ error, category });
    if (!opts.meyon || !opts.sessionSecret) return fail(503, 'Opening Demo Builder from MEYON is not configured on this server', 'not_configured');
    const code = (req.body as { code?: unknown } | undefined)?.code;
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(code)) return fail(400, 'This launch link is not valid. Open Demo Builder again from MEYON.', 'bad_request');
    const got = await opts.meyon.consumeGrant(code);
    if (!got.ok) return got.reason === 'unknown_or_used'
      ? fail(410, 'This launch link has expired or was already used. Open Demo Builder again from MEYON.', 'launch_expired')
      : fail(502, 'MEYON could not be reached to confirm this launch. Try again in a moment.', 'meyon_unavailable');
    const parsed = LaunchPackage.safeParse(got.package);
    if (!parsed.success) {
      req.log.warn({ issues: parsed.error.issues.slice(0, 5).map(i => i.path.join('.') + ': ' + i.message) }, 'invalid launch package');
      return fail(422, 'MEYON sent a launch that Demo Builder cannot accept (' + parsed.error.issues[0]?.path.join('.') + ': ' + parsed.error.issues[0]?.message + ').', 'invalid_package');
    }
    const p = parsed.data;
    if (Date.parse(p.expiresAt) < Date.now()) return fail(410, 'This launch link has expired. Open Demo Builder again from MEYON.', 'launch_expired');
    try {
      // The tenant is the workspace. MEYON's shared login is not an individual identity: until MEYON sends verified
      // users, everyone launching from a tenant acts as that tenant's single shared MEYON principal.
      const ws = await store.ensureWorkspace({ kind: 'meyon', name: p.tenant.name, external_ref: p.tenant.id });
      const principal = await store.upsertPrincipal({ provider: 'meyon', subject: p.actor.verified ? p.tenant.id + ':user:' + p.actor.ref : p.tenant.id + ':shared',
        display_name: p.actor.verified ? p.actor.name : 'MEYON (' + p.tenant.name + ')' });
      if (!(await store.role(ws.id, principal.id))) await store.addMember(ws.id, principal.id, 'editor');
      const launch = await store.createLaunch({ workspace_id: ws.id, principal_id: principal.id, grant_id: p.grantId, project_ref: p.project.id, story_ref: p.story.id,
        story_version: p.story.artifactVersion, mode: p.mode, channel: p.channel, base_demo_id: p.base?.demoId ?? null, base_version: p.base?.version ?? null,
        package: p as unknown as Record<string, unknown>, package_hash: contentHash(p) });
      const session = issueSession(opts.sessionSecret, { subject: principal.subject, ttlSeconds: SESSION_TTL, scope: { workspaceId: ws.id, projectRef: p.project.id, ops: LAUNCH_OPS, launchId: launch.id } });
      reply.header('cache-control', 'no-store');
      return { session, expiresAt: new Date(Date.now() + SESSION_TTL * 1000).toISOString(), launchId: launch.id };
    } catch (e) {
      if (e instanceof DemoConflict) return fail(409, 'This launch was already used. Open Demo Builder again from MEYON.', 'launch_replayed');
      return demoErrorReply(reply, e);
    }
  });

  app.get('/api/v2/launches/:id', route(async (req, c) => {
    const l = await launchFor(c, req.params.id, 'read');
    const p = l.package as unknown as LaunchPackage;
    return { launch: { id: l.id, status: l.status, mode: l.mode, channel: l.channel, createdAt: l.created_at, demoId: l.demo_id, jobId: l.job_id, packageHash: l.package_hash,
      tenant: p.tenant, actor: p.actor, project: p.project, story: p.story, feature: p.feature, prompt: p.prompt, approved: p.approved, suggestions: p.suggestions,
      branding: p.branding, sources: p.sources, base: p.base ? { ...p.base, check: await baseCheck(store, l) } : null } };
  }));

  app.post('/api/v2/launches/:id/confirm', route(async (req, c) => {
    const l = await launchFor(c, req.params.id, 'edit');
    if (l.status === 'confirmed') return { mode: l.mode, jobId: l.job_id, demoId: l.demo_id, already: true };
    if (l.status === 'cancelled') throw new DemoConflict('This launch was cancelled. Open Demo Builder again from MEYON.');
    const p = l.package as unknown as LaunchPackage;
    if (l.mode === 'extend') {
      const check = await baseCheck(store, l);
      if (!check?.ok) throw new DemoConflict(check?.problem ?? 'The base demo is not available');
      const done = await store.updateLaunch(l.id, { status: 'confirmed', demo_id: check.demoId, confirmed_at: new Date().toISOString() }, 'pending');
      if (!done) throw new DemoConflict('This launch is already being opened in another window');
      return { mode: 'extend', demoId: check.demoId, version: check.version, newerExists: check.newerExists };
    }
    await authorize(store, c, 'create', l.workspace_id, { project_ref: l.project_ref });
    // Claim first, so a double click cannot start two paid generations.
    if (!(await store.updateLaunch(l.id, { status: 'confirming' }, 'pending'))) throw new DemoConflict('This launch is already being started in another window');
    try {
      const job = await opts.generator.startPlan(requestOf(p), briefOf(p), c.principal.id);
      await store.updateLaunch(l.id, { status: 'confirmed', job_id: job.id, confirmed_at: new Date().toISOString() });
      return { mode: 'create', jobId: job.id };
    } catch (e) { await store.updateLaunch(l.id, { status: 'pending' }, 'confirming'); throw e; }
  }));

  app.post('/api/v2/launches/:id/cancel', route(async (req, c) => {
    const l = await launchFor(c, req.params.id, 'read');
    if (l.status === 'cancelled') return { status: 'cancelled' };
    if (!(await store.updateLaunch(l.id, { status: 'cancelled' }, 'pending'))) throw new DemoConflict('This launch was already confirmed');
    return { status: 'cancelled' };
  }));
}
