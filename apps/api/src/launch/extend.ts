// EXTEND (Phase A3) for a confirmed MEYON "extend" launch.
//   POST /api/v2/launches/:id/extend/plan   {base?: 'latest'}            -> change plan against the exact baseline version
//   POST /api/v2/launches/:id/extend/apply  {planId, approved, mode?}    -> apply approved items in the background
//   GET  /api/v2/extend-tasks/:taskId                                    -> progress and result
// The baseline is the version MEYON named (or, after "Refresh", the latest version). Applying checks that the demo
// has not moved since the plan was made: otherwise the user chooses Refresh (re-plan), Fork (apply to a new demo
// from the planned version) or Cancel. The result is saved as the draft and, when every journey still works, as a
// new version. Published versions are never changed.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { validateDocument, type DemoDocument } from '@demo/schema';
import type { ChangePlan, Generator, JourneyCheck } from '@demo/generator';
import { authorize, AuthError, type Caller } from '../demos/auth.ts';
import { contentHash, demoErrorReply, traceSummary } from '../demos/routes.ts';
import { DemoConflict, DemoNotFound, type DemoStore } from '../demos/store.ts';
import type { LaunchPackage } from './package.ts';
import { Sync } from '../sync/events.ts';
import { versionEvent } from '../demos/routes.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL = 2 * 3600_000;
type PlanEntry = { launchId: string; principalId: string; demoId: string; baseVersion: number; plan: ChangePlan; at: number };
type Task = { principalId: string; status: 'running' | 'done' | 'failed'; done: number; total: number; label: string; at: number; error?: string;
  result?: { demoId: string; version: number | null; forked: boolean; journey: JourneyCheck; applied: { key: string; summary: string[] }[]; costUsd: number } };

export function registerExtendRoutes(app: FastifyInstance, opts: { store: DemoStore; generator: Generator; sync?: Sync }) {
  const { store, generator } = opts, sync = opts.sync ?? new Sync(opts.store, undefined);
  // Plans and running tasks are short-lived and kept in memory: after a restart the user simply proposes again.
  const plans = new Map<string, PlanEntry>(), tasks = new Map<string, Task>();
  const sweep = () => { const now = Date.now(); for (const [k, v] of plans) if (now - v.at > TTL) plans.delete(k); for (const [k, v] of tasks) if (now - v.at > TTL) tasks.delete(k); };
  type Req = FastifyRequest & { params: any; body: any };
  const route = (fn: (req: Req, c: Caller, reply: FastifyReply) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    try { if (!req.caller) throw new AuthError('Sign in required'); return await fn(req as Req, req.caller, reply); }
    catch (e) {
      const cat = (e as { category?: string }).category;
      if (cat === 'budget') return reply.code(402).send({ error: (e as Error).message, category: 'budget' });
      if (cat === 'parse' || cat === 'bad_request') return reply.code(422).send({ error: (e as Error).message, category: cat });
      return demoErrorReply(reply, e);
    }
  };
  /** The launch (extend, confirmed) and its base demo, authorized for editing and versioning. */
  const context = async (c: Caller, id: string) => {
    if (!UUID.test(id)) throw new DemoNotFound('Not found');
    const l = await store.getLaunch(id);
    if (!l) throw new DemoNotFound('Not found');
    await authorize(store, c, 'read', l.workspace_id, { project_ref: l.project_ref });
    if (l.mode !== 'extend' || l.status !== 'confirmed' || !l.base_demo_id) throw new DemoConflict('This launch is not a confirmed Extend launch');
    const demo = await store.getDemo(l.base_demo_id);
    if (!demo || demo.workspace_id !== l.workspace_id || demo.project_ref !== l.project_ref) throw new DemoNotFound('Not found');
    await authorize(store, c, 'edit', demo.workspace_id, demo);
    await authorize(store, c, 'version', demo.workspace_id, demo);
    return { launch: l, demo, pkg: l.package as unknown as LaunchPackage };
  };
  const baseState = async (demoId: string, version: number) => {
    const demo = (await store.getDemo(demoId))!, v = await store.getVersion(demoId, version);
    if (!v) throw new DemoConflict('Version ' + version + ' of this demo does not exist');
    return { demo, v, latestVersion: demo.latest_version, changed: demo.latest_version !== version || contentHash(demo.draft) !== v.content_hash };
  };

  app.post('/api/v2/launches/:id/extend/plan', route(async (req, c) => {
    sweep();
    const { launch, demo, pkg } = await context(c, req.params.id);
    const version = req.body?.base === 'latest' ? demo.latest_version : launch.base_version!;
    if (!version) throw new DemoConflict('Save a version of this demo before extending it');
    const s = await baseState(demo.id, version);
    const { plan, costUsd } = await generator.planExtension(s.v.document as unknown as DemoDocument, {
      story: { id: pkg.story.id, title: pkg.story.title, version: pkg.story.artifactVersion },
      criteria: pkg.approved.acceptanceCriteria, rules: pkg.approved.businessRules, prompt: pkg.prompt.text });
    const planId = randomUUID();
    plans.set(planId, { launchId: launch.id, principalId: c.principal.id, demoId: demo.id, baseVersion: version, plan, at: Date.now() });
    return { planId, plan, base: { demoId: demo.id, name: demo.name, version, latestVersion: s.latestVersion, changedSince: s.changed }, costUsd };
  }));

  app.post('/api/v2/launches/:id/extend/apply', route(async (req, c, reply) => {
    sweep();
    const { launch, demo, pkg } = await context(c, req.params.id);
    const b = (req.body ?? {}) as { planId?: string; approved?: unknown; mode?: string };
    const entry = typeof b.planId === 'string' ? plans.get(b.planId) : undefined;
    if (!entry || entry.launchId !== launch.id || entry.principalId !== c.principal.id) throw Object.assign(new DemoConflict('This change plan has expired. Propose the changes again.'), { status: 410 });
    const approved = Array.isArray(b.approved) ? b.approved.filter((k): k is string => typeof k === 'string' && entry.plan.items.some(i => i.key === k)) : [];
    if (!approved.length) throw Object.assign(new DemoConflict('Choose at least one change to apply'), { status: 422 });
    const fork = b.mode === 'fork';
    const s = await baseState(demo.id, entry.baseVersion);
    if (!fork && s.changed) return reply.code(409).send({ error: 'This demo changed after the change plan was made (now version ' + s.latestVersion + (contentHash(s.demo.draft) !== s.v.content_hash ? ', with unsaved draft changes' : '') + ').',
      category: 'base_changed', baseVersion: entry.baseVersion, latestVersion: s.latestVersion });
    if (fork) await authorize(store, c, 'fork', demo.workspace_id, demo);
    const taskId = randomUUID(), task: Task = { principalId: c.principal.id, status: 'running', done: 0, total: approved.length, label: 'Starting', at: Date.now() };
    tasks.set(taskId, task);
    const baseDoc = s.v.document as unknown as DemoDocument, startRevision = s.demo.draft_revision;
    void (async () => {
      try {
        const r = await generator.applyExtension(baseDoc, entry.plan, approved, pkg.approved.acceptanceCriteria, (done, total, label) => Object.assign(task, { done, total, label }));
        task.label = 'Saving';
        let target = fork ? await store.fork(s.v.id, c.principal.id, (demo.name + ' + ' + pkg.story.id).slice(0, 120)) : s.demo;
        if (fork) await sync.emit('demo.created', target.workspace_id, { demo: Sync.demo(target), forkedFrom: { demoId: demo.id, version: entry.baseVersion } }, c);
        // Compare-and-swap on the draft revision captured before applying: a concurrent edit is never overwritten.
        target = await store.saveDraft(target.id, fork ? target.draft_revision : startRevision, r.document as unknown as Record<string, unknown>, c.principal.id);
        let version: number | null = null;
        if (r.journey.passed) {
          const issues = validateDocument(r.document);
          const v = await store.saveVersion(target.id, c.principal.id, target.draft_revision, contentHash(r.document), ('Extended with ' + pkg.story.id + ' (story v' + pkg.story.artifactVersion + ')').slice(0, 500), {
            validation: { errors: issues.filter(i => i.severity === 'error').length, warnings: issues.filter(i => i.severity === 'warning').length }, screens: r.document.screens.length, savedVia: c.via,
            trace: traceSummary(r.document), extend: { launchId: launch.id, story: pkg.story.id, storyVersion: pkg.story.artifactVersion, baseVersion: entry.baseVersion, forkedFrom: fork ? demo.id : null,
              applied: r.applied.map(a => entry.plan.items.find(i => i.key === a.key)?.kind + ': ' + (entry.plan.items.find(i => i.key === a.key)?.title ?? '')), journey: r.journey } });
          version = v.number;
          await sync.emit('demo.version_saved', target.workspace_id, { demo: Sync.demo({ ...target, latest_version: v.number }), version: versionEvent(v, r.document) }, c);
        }
        task.result = { demoId: target.id, version, forked: fork, journey: r.journey, applied: r.applied, costUsd: r.costUsd };
        task.status = 'done'; task.done = task.total; task.label = 'Done';
      } catch (e) {
        task.status = 'failed';
        task.error = e instanceof DemoConflict ? 'The demo was changed while the changes were being applied. Nothing was saved; propose again.' : e instanceof Error ? e.message : String(e);
        req.log.warn({ detail: task.error }, 'extend apply failed');
      }
    })();
    return reply.code(202).send({ taskId });
  }));

  app.get('/api/v2/extend-tasks/:taskId', route(async (req, c) => {
    const t = tasks.get(String(req.params.taskId));
    if (!t || t.principalId !== c.principal.id) throw new DemoNotFound('Not found');
    return { status: t.status, done: t.done, total: t.total, label: t.label, error: t.error ?? null, result: t.result ?? null };
  }));
}
