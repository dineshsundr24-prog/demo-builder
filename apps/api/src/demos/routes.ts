// Demo persistence API: workspaces, demos (working draft), immutable versions, primary baselines,
// forks and read-only publications. Every route authorizes the caller against the demo's workspace.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { DemoDocument, validateDocument } from '@demo/schema';
import { JobError } from '@demo/generator';
import { authorize, AuthError, newToken, sha256, type Caller, type Op } from './auth.ts';
import { DemoConflict, DemoNotFound, DemoStoreError, type DemoRow, type DemoStore } from './store.ts';
import { Sync } from '../sync/events.ts';

declare module 'fastify' { interface FastifyRequest { caller?: Caller } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
/** Canonical content hash of a document (key order independent). */
export function contentHash(doc: unknown): string {
  const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v;
  return sha256(JSON.stringify(canon(doc)));
}

/** Requirement coverage of a document: story -> criterion -> screens that demonstrate it (with the best confidence). */
export function traceSummary(doc: unknown) {
  const rank = { high: 3, medium: 2, low: 1 } as const;
  const stories: Record<string, Record<string, { screens: string[]; confidence: 'high' | 'medium' | 'low' }>> = {};
  for (const s of ((doc as any)?.screens ?? []) as { id: string; trace?: { story: string; criteria: string[]; confidence: 'high' | 'medium' | 'low' }[] }[]) {
    for (const t of s.trace ?? []) for (const c of t.criteria) {
      const e = ((stories[t.story] ??= {})[c] ??= { screens: [], confidence: t.confidence });
      if (!e.screens.includes(s.id)) e.screens.push(s.id);
      if (rank[t.confidence] > rank[e.confidence]) e.confidence = t.confidence;
    }
  }
  return stories;
}
/** What MEYON needs to know about a saved version: number, fingerprint, note, quality and story coverage. */
export function versionEvent(v: { number: number; content_hash: string; note: string; created_at: string; metadata: Record<string, unknown> }, doc: unknown) {
  const m = v.metadata as { validation?: unknown; screens?: number; extend?: unknown };
  return { number: v.number, contentHash: v.content_hash, note: v.note, createdAt: v.created_at, screens: m.screens ?? null, validation: m.validation ?? null, coverage: traceSummary(doc), ...(m.extend ? { extend: m.extend } : {}) };
}
/** A published copy carries the demo only: traceability references stay internal. */
const publicDocument = (doc: Record<string, unknown>) => ({ ...doc, screens: ((doc.screens ?? []) as Record<string, unknown>[]).map(({ trace: _t, ...s }) => (void _t, s)) });

export function demoErrorReply(reply: FastifyReply, e: unknown) {
  if (e instanceof AuthError) return reply.code(e.status).send({ error: e.message, category: e.status === 401 ? 'auth' : e.status === 403 ? 'forbidden' : 'not_found' });
  if (e instanceof DemoConflict) { const s = (e as { status?: number }).status ?? 409; return reply.code(s).send({ error: e.message, category: s === 422 ? 'invalid' : 'conflict' }); }
  if (e instanceof JobError) return reply.code(e.status).send({ error: e.message, category: e.category });
  if (e instanceof DemoNotFound) return reply.code(404).send({ error: 'Not found', category: 'not_found' });
  if (e instanceof DemoStoreError) {
    const ref = 'err_' + Math.random().toString(36).slice(2, 10);
    reply.log.error({ ref, detail: e.message }, 'demo storage error');
    return reply.code(503).send({ error: 'Demo storage is temporarily unavailable (reference ' + ref + ')', category: 'storage' });
  }
  reply.log.error(e);
  return reply.code(500).send({ error: 'Unexpected server error', category: 'internal' });
}

export function registerDemoRoutes(app: FastifyInstance, opts: { store: DemoStore; publicBaseUrl?: string; sync?: Sync }) {
  const store = opts.store, sync = opts.sync ?? new Sync(opts.store, undefined);
  const caller = (req: FastifyRequest) => { if (!req.caller) throw new AuthError('Sign in required'); return req.caller; };
  type Req = FastifyRequest & { params: any; body: any; query: any };
  const route = (fn: (req: Req, c: Caller) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try { return await fn(req as Req, caller(req)); } catch (e) { return demoErrorReply(reply, e); }
    };
  /** Load a demo and authorize; unknown and unauthorized look the same (404). */
  const demoFor = async (c: Caller, id: string, op: Op): Promise<DemoRow> => {
    if (!UUID.test(id)) throw new DemoNotFound('Not found');
    const d = await store.getDemo(id);
    if (!d) throw new DemoNotFound('Not found');
    await authorize(store, c, op, d.workspace_id, d);
    return d;
  };
  const parseDoc = (raw: unknown, channel?: string) => {
    const p = DemoDocument.safeParse(raw);
    if (!p.success) throw Object.assign(new DemoConflict('Not a valid demo document: ' + (p.error.issues[0]?.message ?? '')), { status: 422 });
    if (channel && p.data.channel !== channel) throw new DemoConflict('This demo is a ' + (channel === 'mobile' ? 'mobile app' : 'staff portal') + '; the document is not');
    return p.data;
  };
  const versionView = (d: DemoRow) => ({ id: d.id, workspaceId: d.workspace_id, name: d.name, channel: d.channel, projectRef: d.project_ref, isPrimary: d.is_primary,
    forkedFromVersionId: d.forked_from_version_id, latestVersion: d.latest_version, draftRevision: d.draft_revision, draftBaseVersion: d.draft_base_version,
    draftUpdatedAt: d.draft_updated_at, createdAt: d.created_at, archived: !!d.archived_at });

  app.get('/api/v2/me', route(async (_req, c) => {
    const workspaces = c.scope ? (await store.workspacesOf(c.principal.id)).filter(w => w.id === c.scope!.workspaceId) : await store.workspacesOf(c.principal.id);
    return { principal: { id: c.principal.id, provider: c.principal.provider, name: c.principal.display_name, email: c.principal.email }, via: c.via,
      scope: c.scope ?? null, defaultWorkspaceId: c.defaultWorkspaceId, workspaces: workspaces.map(w => ({ id: w.id, name: w.name, kind: w.kind, role: w.role })) };
  }));

  app.get('/api/v2/demos', route(async (req, c) => {
    const q = req.query as { workspace?: string; project?: string; archived?: string };
    const mine = await store.workspacesOf(c.principal.id);
    let ids = mine.map(w => w.id);
    if (c.scope) ids = ids.filter(id => id === c.scope!.workspaceId);
    if (q.workspace) ids = ids.filter(id => id === q.workspace);
    const project = c.scope ? c.scope.projectRef : typeof q.project === 'string' ? q.project.slice(0, 200) : undefined;
    const demos = await store.listDemos(ids, { projectRef: project, includeArchived: q.archived === '1' });
    return { demos: demos.map(d => versionView({ ...d, draft: {} } as DemoRow)) };
  }));

  app.post('/api/v2/demos', route(async (req, c) => {
    const b = (req.body ?? {}) as { workspaceId?: string; name?: string; projectRef?: string; document?: unknown; primary?: boolean; launchId?: string };
    const workspaceId = typeof b.workspaceId === 'string' && UUID.test(b.workspaceId) ? b.workspaceId : c.defaultWorkspaceId;
    const projectRef = c.scope ? c.scope.projectRef : text(b.projectRef, 200);
    await authorize(store, c, 'create', workspaceId, { project_ref: projectRef });
    const doc = parseDoc(b.document);
    const name = text(b.name, 120) || doc.name.slice(0, 120) || 'Untitled demo';
    let d = await store.createDemo({ workspace_id: workspaceId, name, channel: doc.channel, project_ref: projectRef, draft: doc as unknown as Record<string, unknown>, created_by: c.principal.id });
    // The first demo of a project + type becomes its primary baseline automatically.
    const siblings = (await store.listDemos([workspaceId], { projectRef })).filter(x => x.channel === d.channel && x.is_primary);
    if (b.primary === true || !siblings.length) { await authorize(store, c, 'primary', workspaceId, d); await store.setPrimary(d.id); d = (await store.getDemo(d.id))!; }
    // The demo generated from a MEYON launch is linked to it (once; only by that launch's own session).
    if (c.scope?.launchId && b.launchId === c.scope.launchId) {
      const l = await store.getLaunch(b.launchId);
      if (l && l.workspace_id === workspaceId && l.mode === 'create' && l.status === 'confirmed' && !l.demo_id) await store.updateLaunch(l.id, { demo_id: d.id }, 'confirmed');
    }
    await sync.emit('demo.created', d.workspace_id, { demo: Sync.demo(d) }, c);
    return { demo: versionView(d), document: d.draft };
  }));

  app.get('/api/v2/demos/:id', route(async (req, c) => {
    const d = await demoFor(c, req.params.id, 'read');
    const [versions, publications, role] = [await store.listVersions(d.id), await store.listPublications(d.id), await store.role(d.workspace_id, c.principal.id)];
    return { demo: versionView(d), document: d.draft, role,
      versions: versions.map(v => ({ id: v.id, number: v.number, note: v.note, createdAt: v.created_at, contentHash: v.content_hash, metadata: v.metadata })),
      publications: publications.map(p => ({ id: p.id, versionId: p.version_id, version: versions.find(v => v.id === p.version_id)?.number ?? null, createdAt: p.created_at, revoked: !!p.revoked_at })) };
  }));

  app.patch('/api/v2/demos/:id', route(async (req, c) => {
    const b = (req.body ?? {}) as { name?: string; archived?: boolean };
    const patch: { name?: string; archived_at?: string | null } = {};
    if (b.name !== undefined) { const n = text(b.name, 120); if (!n) throw new DemoConflict('Name cannot be empty'); await demoFor(c, req.params.id, 'edit'); patch.name = n; }
    if (b.archived !== undefined) { await demoFor(c, req.params.id, 'archive'); patch.archived_at = b.archived ? new Date().toISOString() : null; }
    if (!Object.keys(patch).length) await demoFor(c, req.params.id, 'read');
    return { demo: versionView(await store.updateDemo(req.params.id, patch)) };
  }));

  app.put('/api/v2/demos/:id/draft', route(async (req, c) => {
    const b = (req.body ?? {}) as { expectedRevision?: number; document?: unknown };
    const d = await demoFor(c, req.params.id, 'edit');
    if (!Number.isInteger(b.expectedRevision)) throw new DemoConflict('expectedRevision is required');
    const doc = parseDoc(b.document, d.channel);
    const saved = await store.saveDraft(d.id, b.expectedRevision!, doc as unknown as Record<string, unknown>, c.principal.id);
    return { demo: versionView(saved) };
  }));

  app.post('/api/v2/demos/:id/versions', route(async (req, c) => {
    const b = (req.body ?? {}) as { expectedRevision?: number; note?: string };
    const d = await demoFor(c, req.params.id, 'version');
    if (!Number.isInteger(b.expectedRevision)) throw new DemoConflict('expectedRevision is required');
    const issues = validateDocument(d.draft);
    const metadata = { validation: { errors: issues.filter(i => i.severity === 'error').length, warnings: issues.filter(i => i.severity === 'warning').length },
      screens: Array.isArray((d.draft as any).screens) ? (d.draft as any).screens.length : 0, savedVia: c.via, trace: traceSummary(d.draft) };
    const v = await store.saveVersion(d.id, c.principal.id, b.expectedRevision!, contentHash(d.draft), text(b.note, 500), metadata);
    await sync.emit('demo.version_saved', d.workspace_id, { demo: Sync.demo({ ...d, latest_version: v.number }), version: versionEvent(v, d.draft) }, c);
    return { version: { id: v.id, number: v.number, note: v.note, createdAt: v.created_at, contentHash: v.content_hash, metadata: v.metadata } };
  }));

  app.get('/api/v2/demos/:id/versions/:n', route(async (req, c) => {
    const d = await demoFor(c, req.params.id, 'read');
    const n = Number(req.params.n);
    const v = Number.isInteger(n) && n > 0 ? await store.getVersion(d.id, n) : null;
    if (!v) throw new DemoNotFound('Not found');
    return { version: { id: v.id, number: v.number, note: v.note, createdAt: v.created_at, contentHash: v.content_hash, metadata: v.metadata }, document: v.document };
  }));

  app.post('/api/v2/demos/:id/primary', route(async (req, c) => {
    const d = await demoFor(c, req.params.id, 'primary');
    await store.setPrimary(d.id);
    await sync.emit('demo.primary_changed', d.workspace_id, { demo: Sync.demo({ ...d, is_primary: true }) }, c);
    return { demo: versionView((await store.getDemo(d.id))!) };
  }));

  app.post('/api/v2/demos/:id/fork', route(async (req, c) => {
    const b = (req.body ?? {}) as { version?: number; name?: string };
    const d = await demoFor(c, req.params.id, 'read');
    await authorize(store, c, 'fork', d.workspace_id, d);
    const v = Number.isInteger(b.version) ? await store.getVersion(d.id, b.version!) : null;
    if (!v) throw new DemoConflict('Choose a saved version to fork from');
    const f = await store.fork(v.id, c.principal.id, text(b.name, 120) || (d.name + ' (fork of v' + v.number + ')').slice(0, 120));
    await sync.emit('demo.created', f.workspace_id, { demo: Sync.demo(f), forkedFrom: { demoId: d.id, version: v.number } }, c);
    return { demo: versionView(f), document: f.draft };
  }));

  app.post('/api/v2/demos/:id/versions/:n/publish', route(async (req, c) => {
    const d = await demoFor(c, req.params.id, 'publish');
    const v = await store.getVersion(d.id, Number(req.params.n));
    if (!v) throw new DemoNotFound('Not found');
    if (Number((v.metadata as any)?.validation?.errors ?? 0) > 0) throw new DemoConflict('This version has validation errors; fix them and save a new version before publishing');
    const token = newToken();
    const p = await store.createPublication({ demo_id: d.id, workspace_id: d.workspace_id, version_id: v.id, token_hash: sha256(token), created_by: c.principal.id });
    // The link itself is never sent or stored; MEYON learns that version N is published (and later revoked).
    await sync.emit('demo.published', d.workspace_id, { demo: Sync.demo(d), publication: { id: p.id, version: v.number, createdAt: p.created_at } }, c);
    // The token is shown once; only its hash is stored.
    return { publication: { id: p.id, version: v.number, createdAt: p.created_at }, token, url: (opts.publicBaseUrl ?? '') + '/?p=' + token };
  }));

  app.post('/api/v2/demos/:id/publications/:pid/revoke', route(async (req, c) => {
    const d = await demoFor(c, req.params.id, 'publish');
    if (!UUID.test(req.params.pid)) throw new DemoNotFound('Not found');
    const list = await store.listPublications(d.id);
    if (!list.some(p => p.id === req.params.pid)) throw new DemoNotFound('Not found');
    const p = await store.revokePublication(req.params.pid);
    await sync.emit('demo.publication_revoked', d.workspace_id, { demo: Sync.demo(d), publication: { id: p!.id, version: (await store.listVersions(d.id)).find(v => v.id === p!.version_id)?.number ?? null, revokedAt: p!.revoked_at } }, c);
    return { publication: { id: p!.id, revoked: !!p!.revoked_at } };
  }));

  // Public, read-only: anyone with the link sees exactly the published version (no editing, no other versions).
  app.get('/api/v2/public/:token', async (req: FastifyRequest<{ Params: { token: string } }>, reply) => {
    try {
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(req.params.token)) return reply.code(404).send({ error: 'This demo link is not available', category: 'not_found' });
      const hit = await store.publicationByHash(sha256(req.params.token));
      if (!hit || hit.demo.archived_at) return reply.code(404).send({ error: 'This demo link is not available', category: 'not_found' });
      reply.header('cache-control', 'no-store');
      return { name: hit.demo.name, channel: hit.demo.channel, version: hit.version.number, publishedAt: hit.publication.created_at, document: publicDocument(hit.version.document) };
    } catch (e) { return demoErrorReply(reply, e); }
  });
}
