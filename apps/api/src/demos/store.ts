// Persistent demos, immutable versions, publications and principals (migration 0002).
// MemoryDemoStore mirrors the database rules exactly (used by tests and the zero-cost dev server);
// SupabaseDemoStore talks to PostgREST with the server-side secret key and uses the database
// functions for the operations that must be atomic.
import { randomUUID } from 'node:crypto';

export type Channel = 'mobile' | 'portal';
export type Role = 'owner' | 'editor' | 'viewer';
export type Provider = 'supabase' | 'meyon' | 'uat' | 'oidc';
export type Principal = { id: string; provider: Provider; subject: string; display_name: string; email: string | null };
export type Workspace = { id: string; name: string; kind: 'personal' | 'team' | 'meyon' | 'uat'; external_ref: string | null };
export type DemoRow = {
  id: string; workspace_id: string; name: string; channel: Channel; project_ref: string; is_primary: boolean;
  forked_from_version_id: string | null; latest_version: number; draft: Record<string, unknown>; draft_revision: number;
  draft_base_version: number; draft_updated_by: string | null; draft_updated_at: string; created_by: string | null; created_at: string; archived_at: string | null;
};
export type DemoSummary = Omit<DemoRow, 'draft'>;
export type VersionRow = { id: string; demo_id: string; workspace_id: string; number: number; document: Record<string, unknown>; content_hash: string; parent_version_id: string | null; note: string; metadata: Record<string, unknown>; created_by: string | null; created_at: string };
export type VersionSummary = Omit<VersionRow, 'document'>;
export type PublicationRow = { id: string; demo_id: string; workspace_id: string; version_id: string; token_hash: string; created_by: string | null; created_at: string; revoked_at: string | null };

export type LaunchStatus = 'pending' | 'confirming' | 'confirmed' | 'cancelled';
/** A launch from MEYON (migration 0004): the validated launch package and what became of it. */
export type LaunchRow = {
  id: string; workspace_id: string; principal_id: string | null; grant_id: string; project_ref: string; story_ref: string; story_version: number;
  mode: 'create' | 'extend'; channel: Channel; base_demo_id: string | null; base_version: number | null;
  package: Record<string, unknown>; package_hash: string; status: LaunchStatus; demo_id: string | null; job_id: string | null; created_at: string; confirmed_at: string | null;
};
export type NewLaunch = Omit<LaunchRow, 'id' | 'status' | 'demo_id' | 'job_id' | 'created_at' | 'confirmed_at'>;
export type LaunchPatch = Partial<Pick<LaunchRow, 'status' | 'demo_id' | 'job_id' | 'confirmed_at'>>;

/** Domain errors the API maps to HTTP statuses. */
export class DemoConflict extends Error { readonly status = 409; }
export class DemoNotFound extends Error { readonly status = 404; }
export class DemoStoreError extends Error { status: number; constructor(m: string, status = 503) { super(m); this.status = status; } }

export interface DemoStore {
  readonly kind: 'memory' | 'supabase';
  upsertPrincipal(p: { provider: Provider; subject: string; display_name?: string; email?: string | null }): Promise<Principal>;
  ensureWorkspace(w: { kind: Workspace['kind']; name: string; external_ref?: string | null; owner?: string }): Promise<Workspace>;
  personalWorkspace(principalId: string, name: string): Promise<Workspace>;
  addMember(workspaceId: string, principalId: string, role: Role): Promise<void>;
  role(workspaceId: string, principalId: string): Promise<Role | null>;
  workspacesOf(principalId: string): Promise<(Workspace & { role: Role })[]>;
  createDemo(d: { workspace_id: string; name: string; channel: Channel; project_ref: string; draft: Record<string, unknown>; created_by: string }): Promise<DemoRow>;
  getDemo(id: string): Promise<DemoRow | null>;
  listDemos(workspaceIds: string[], opts?: { projectRef?: string; includeArchived?: boolean }): Promise<DemoSummary[]>;
  updateDemo(id: string, patch: { name?: string; archived_at?: string | null }): Promise<DemoRow>;
  /** Compare-and-swap save of the working draft; returns the new revision or throws DemoConflict. */
  saveDraft(id: string, expectedRevision: number, draft: Record<string, unknown>, by: string): Promise<DemoRow>;
  saveVersion(id: string, by: string, expectedRevision: number, contentHash: string, note: string, metadata: Record<string, unknown>): Promise<VersionRow>;
  listVersions(demoId: string): Promise<VersionSummary[]>;
  getVersion(demoId: string, number: number): Promise<VersionRow | null>;
  setPrimary(demoId: string): Promise<void>;
  fork(versionId: string, by: string, name: string): Promise<DemoRow>;
  createPublication(p: { demo_id: string; workspace_id: string; version_id: string; token_hash: string; created_by: string }): Promise<PublicationRow>;
  listPublications(demoId: string): Promise<PublicationRow[]>;
  revokePublication(id: string): Promise<PublicationRow | null>;
  publicationByHash(hash: string): Promise<{ publication: PublicationRow; version: VersionRow; demo: DemoSummary } | null>;
  /** Record a launch; a grant id that was already recorded throws DemoConflict (replay). */
  createLaunch(l: NewLaunch): Promise<LaunchRow>;
  getLaunch(id: string): Promise<LaunchRow | null>;
  /** Update a launch; with `ifStatus`, only when it is currently in that status (returns null otherwise). */
  updateLaunch(id: string, patch: LaunchPatch, ifStatus?: LaunchStatus): Promise<LaunchRow | null>;
}

const now = () => new Date().toISOString();
const summary = ({ draft: _d, ...rest }: DemoRow): DemoSummary => (void _d, rest);
const vsummary = ({ document: _d, ...rest }: VersionRow): VersionSummary => (void _d, rest);
const clone = <T>(v: T): T => structuredClone(v);

export class MemoryDemoStore implements DemoStore {
  readonly kind = 'memory' as const;
  principals = new Map<string, Principal>(); workspaces = new Map<string, Workspace>(); members = new Map<string, Role>();
  demos = new Map<string, DemoRow>(); versions = new Map<string, VersionRow>(); publications = new Map<string, PublicationRow>();
  async upsertPrincipal(p: { provider: Provider; subject: string; display_name?: string; email?: string | null }) {
    const found = [...this.principals.values()].find(x => x.provider === p.provider && x.subject === p.subject);
    if (found) { if (p.display_name) found.display_name = p.display_name; if (p.email !== undefined) found.email = p.email; return clone(found); }
    const row: Principal = { id: randomUUID(), provider: p.provider, subject: p.subject, display_name: p.display_name ?? '', email: p.email ?? null };
    this.principals.set(row.id, row); return clone(row);
  }
  async ensureWorkspace(w: { kind: Workspace['kind']; name: string; external_ref?: string | null; owner?: string }) {
    let ws = w.external_ref ? [...this.workspaces.values()].find(x => x.kind === w.kind && x.external_ref === w.external_ref) : undefined;
    if (!ws) { ws = { id: randomUUID(), name: w.name, kind: w.kind, external_ref: w.external_ref ?? null }; this.workspaces.set(ws.id, ws); }
    if (w.owner && !this.members.has(ws.id + '/' + w.owner)) this.members.set(ws.id + '/' + w.owner, 'owner');
    return clone(ws);
  }
  async personalWorkspace(principalId: string, name: string) {
    const mine = [...this.members.entries()].filter(([k, r]) => k.endsWith('/' + principalId) && r === 'owner').map(([k]) => this.workspaces.get(k.split('/')[0])!).find(w => w?.kind === 'personal');
    return mine ? clone(mine) : this.ensureWorkspace({ kind: 'personal', name, owner: principalId });
  }
  async addMember(workspaceId: string, principalId: string, role: Role) { this.members.set(workspaceId + '/' + principalId, role); }
  async role(workspaceId: string, principalId: string) { return this.members.get(workspaceId + '/' + principalId) ?? null; }
  async workspacesOf(principalId: string) {
    return [...this.members.entries()].filter(([k]) => k.endsWith('/' + principalId)).map(([k, role]) => ({ ...clone(this.workspaces.get(k.split('/')[0])!), role }));
  }
  async createDemo(d: { workspace_id: string; name: string; channel: Channel; project_ref: string; draft: Record<string, unknown>; created_by: string }) {
    const row: DemoRow = { id: randomUUID(), workspace_id: d.workspace_id, name: d.name, channel: d.channel, project_ref: d.project_ref, is_primary: false, forked_from_version_id: null,
      latest_version: 0, draft: clone(d.draft), draft_revision: 1, draft_base_version: 0, draft_updated_by: d.created_by, draft_updated_at: now(), created_by: d.created_by, created_at: now(), archived_at: null };
    this.demos.set(row.id, row); return clone(row);
  }
  async getDemo(id: string) { const d = this.demos.get(id); return d ? clone(d) : null; }
  async listDemos(workspaceIds: string[], opts: { projectRef?: string; includeArchived?: boolean } = {}) {
    return [...this.demos.values()].filter(d => workspaceIds.includes(d.workspace_id) && (opts.includeArchived || !d.archived_at) && (opts.projectRef === undefined || d.project_ref === opts.projectRef))
      .sort((a, b) => b.draft_updated_at.localeCompare(a.draft_updated_at)).map(d => summary(clone(d)));
  }
  async updateDemo(id: string, patch: { name?: string; archived_at?: string | null }) {
    const d = this.demos.get(id); if (!d) throw new DemoNotFound('Demo not found');
    if (patch.name !== undefined) d.name = patch.name;
    if (patch.archived_at !== undefined) { d.archived_at = patch.archived_at; if (patch.archived_at) d.is_primary = false; }
    return clone(d);
  }
  async saveDraft(id: string, expectedRevision: number, draft: Record<string, unknown>, by: string) {
    const d = this.demos.get(id); if (!d) throw new DemoNotFound('Demo not found');
    if (d.archived_at) throw new DemoConflict('This demo is archived');
    if (d.draft_revision !== expectedRevision) throw new DemoConflict('The draft was changed elsewhere');
    Object.assign(d, { draft: clone(draft), draft_revision: d.draft_revision + 1, draft_updated_by: by, draft_updated_at: now() });
    return clone(d);
  }
  async saveVersion(id: string, by: string, expectedRevision: number, contentHash: string, note: string, metadata: Record<string, unknown>) {
    const d = this.demos.get(id); if (!d) throw new DemoNotFound('Demo not found');
    if (d.archived_at) throw new DemoConflict('This demo is archived');
    if (d.draft_revision !== expectedRevision) throw new DemoConflict('The draft was changed elsewhere');
    const parent = [...this.versions.values()].find(v => v.demo_id === id && v.number === d.latest_version);
    const v: VersionRow = { id: randomUUID(), demo_id: id, workspace_id: d.workspace_id, number: d.latest_version + 1, document: clone(d.draft), content_hash: contentHash,
      parent_version_id: parent?.id ?? null, note, metadata: clone(metadata), created_by: by, created_at: now() };
    this.versions.set(v.id, v); d.latest_version = v.number; d.draft_base_version = v.number;
    return clone(v);
  }
  async listVersions(demoId: string) { return [...this.versions.values()].filter(v => v.demo_id === demoId).sort((a, b) => b.number - a.number).map(v => vsummary(clone(v))); }
  async getVersion(demoId: string, number: number) { const v = [...this.versions.values()].find(x => x.demo_id === demoId && x.number === number); return v ? clone(v) : null; }
  async setPrimary(demoId: string) {
    const d = this.demos.get(demoId); if (!d) throw new DemoNotFound('Demo not found');
    if (d.archived_at) throw new DemoConflict('This demo is archived');
    for (const x of this.demos.values()) if (x.workspace_id === d.workspace_id && x.project_ref === d.project_ref && x.channel === d.channel) x.is_primary = x.id === demoId;
  }
  async fork(versionId: string, by: string, name: string) {
    const v = this.versions.get(versionId); if (!v) throw new DemoNotFound('Version not found');
    const src = this.demos.get(v.demo_id)!;
    const d = await this.createDemo({ workspace_id: src.workspace_id, name, channel: src.channel, project_ref: src.project_ref, draft: v.document, created_by: by });
    this.demos.get(d.id)!.forked_from_version_id = v.id;
    return clone(this.demos.get(d.id)!);
  }
  async createPublication(p: { demo_id: string; workspace_id: string; version_id: string; token_hash: string; created_by: string }) {
    const row: PublicationRow = { id: randomUUID(), ...p, created_at: now(), revoked_at: null };
    this.publications.set(row.id, row); return clone(row);
  }
  async listPublications(demoId: string) { return [...this.publications.values()].filter(p => p.demo_id === demoId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(clone); }
  async revokePublication(id: string) { const p = this.publications.get(id); if (!p) return null; p.revoked_at ??= now(); return clone(p); }
  async publicationByHash(hash: string) {
    const p = [...this.publications.values()].find(x => x.token_hash === hash && !x.revoked_at);
    if (!p) return null;
    const v = this.versions.get(p.version_id)!, d = this.demos.get(p.demo_id)!;
    return { publication: clone(p), version: clone(v), demo: summary(clone(d)) };
  }
  launches = new Map<string, LaunchRow>();
  async createLaunch(l: NewLaunch) {
    if ([...this.launches.values()].some(x => x.grant_id === l.grant_id)) throw new DemoConflict('This launch was already used');
    const row: LaunchRow = { ...clone(l), id: randomUUID(), status: 'pending', demo_id: null, job_id: null, created_at: now(), confirmed_at: null };
    this.launches.set(row.id, row); return clone(row);
  }
  async getLaunch(id: string) { const l = this.launches.get(id); return l ? clone(l) : null; }
  async updateLaunch(id: string, patch: LaunchPatch, ifStatus?: LaunchStatus) {
    const l = this.launches.get(id);
    if (!l || (ifStatus && l.status !== ifStatus)) return null;
    Object.assign(l, patch); return clone(l);
  }
}

const enc = encodeURIComponent;
const SUMMARY_COLS = 'id,workspace_id,name,channel,project_ref,is_primary,forked_from_version_id,latest_version,draft_revision,draft_base_version,draft_updated_by,draft_updated_at,created_by,created_at,archived_at';
const VSUMMARY_COLS = 'id,demo_id,workspace_id,number,content_hash,parent_version_id,note,metadata,created_by,created_at';

export class SupabaseDemoStore implements DemoStore {
  readonly kind = 'supabase' as const;
  private url: string; private key: string;
  constructor(url: string, key: string) { this.url = url; this.key = key; }
  private async req(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<any> {
    const headers: Record<string, string> = { apikey: this.key, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + this.key;
    if (init.prefer) headers.Prefer = init.prefer;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url + '/rest/v1/' + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
      if (res.status >= 500 && attempt < 2) { await new Promise(r => setTimeout(r, 300 * (attempt + 1))); continue; }
      const text = await res.text();
      if (!res.ok) {
        let code = '', msg = text.slice(0, 300);
        try { const e = JSON.parse(text); code = String(e.code ?? ''); msg = [e.code, e.message].filter(Boolean).join(' · '); } catch { /* raw */ }
        if (code === '40001') throw new DemoConflict('The draft was changed elsewhere');
        if (code === 'P0002') throw new DemoNotFound('Not found');
        if (code === 'P0001' || code === '23505') throw new DemoConflict(msg.replace(/^P0001 · /, ''));
        throw new DemoStoreError('Supabase ' + (init.method ?? 'GET') + ' ' + path.split('?')[0] + ' failed (' + res.status + '): ' + msg);
      }
      return text ? JSON.parse(text) : null;
    }
  }
  async upsertPrincipal(p: { provider: Provider; subject: string; display_name?: string; email?: string | null }) {
    const body: Record<string, unknown> = { provider: p.provider, subject: p.subject, last_seen_at: now() };
    if (p.display_name) body.display_name = p.display_name.slice(0, 120);
    if (p.email !== undefined) body.email = p.email;
    const rows = await this.req('principals?on_conflict=provider,subject&select=id,provider,subject,display_name,email', { method: 'POST', body, prefer: 'resolution=merge-duplicates,return=representation' });
    return rows[0] as Principal;
  }
  async ensureWorkspace(w: { kind: Workspace['kind']; name: string; external_ref?: string | null; owner?: string }) {
    let ws: Workspace | undefined;
    if (w.external_ref) ws = (await this.req('workspaces?kind=eq.' + w.kind + '&external_ref=eq.' + enc(w.external_ref) + '&limit=1'))[0];
    if (!ws) {
      try { ws = (await this.req('workspaces', { method: 'POST', body: { kind: w.kind, name: w.name.slice(0, 120), external_ref: w.external_ref ?? null }, prefer: 'return=representation' }))[0]; }
      catch (e) { if (!(e instanceof DemoConflict) || !w.external_ref) throw e; ws = (await this.req('workspaces?kind=eq.' + w.kind + '&external_ref=eq.' + enc(w.external_ref) + '&limit=1'))[0]; } // created concurrently
    }
    if (w.owner) await this.req('workspace_members?on_conflict=workspace_id,principal_id', { method: 'POST', body: { workspace_id: ws!.id, principal_id: w.owner, role: 'owner' }, prefer: 'resolution=ignore-duplicates,return=minimal' });
    return ws!;
  }
  async personalWorkspace(principalId: string, name: string) {
    const mine = (await this.workspacesOf(principalId)).find((w: Workspace & { role: Role }) => w.kind === 'personal' && w.role === 'owner');
    if (mine) { const { role: _r, ...ws } = mine; void _r; return ws; }
    return this.ensureWorkspace({ kind: 'personal', name, owner: principalId });
  }
  async addMember(workspaceId: string, principalId: string, role: Role) {
    await this.req('workspace_members?on_conflict=workspace_id,principal_id', { method: 'POST', body: { workspace_id: workspaceId, principal_id: principalId, role }, prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  async role(workspaceId: string, principalId: string) {
    const rows = await this.req('workspace_members?select=role&workspace_id=eq.' + enc(workspaceId) + '&principal_id=eq.' + enc(principalId) + '&limit=1');
    return (rows[0]?.role ?? null) as Role | null;
  }
  async workspacesOf(principalId: string) {
    const rows = await this.req('workspace_members?select=role,workspaces(id,name,kind,external_ref)&principal_id=eq.' + enc(principalId));
    return rows.map((r: any) => ({ ...r.workspaces, role: r.role }));
  }
  async createDemo(d: { workspace_id: string; name: string; channel: Channel; project_ref: string; draft: Record<string, unknown>; created_by: string }) {
    return (await this.req('demos', { method: 'POST', body: { ...d, draft_updated_by: d.created_by }, prefer: 'return=representation' }))[0] as DemoRow;
  }
  async getDemo(id: string) { return ((await this.req('demos?id=eq.' + enc(id) + '&limit=1')) as DemoRow[])[0] ?? null; }
  async listDemos(workspaceIds: string[], opts: { projectRef?: string; includeArchived?: boolean } = {}) {
    if (!workspaceIds.length) return [];
    return await this.req('demos?select=' + SUMMARY_COLS + '&workspace_id=in.(' + workspaceIds.map(enc).join(',') + ')' + (opts.includeArchived ? '' : '&archived_at=is.null')
      + (opts.projectRef === undefined ? '' : '&project_ref=eq.' + enc(opts.projectRef)) + '&order=draft_updated_at.desc&limit=200') as DemoSummary[];
  }
  async updateDemo(id: string, patch: { name?: string; archived_at?: string | null }) {
    const body: Record<string, unknown> = { ...patch };
    if (patch.archived_at) body.is_primary = false;
    const rows = await this.req('demos?id=eq.' + enc(id), { method: 'PATCH', body, prefer: 'return=representation' });
    if (!rows[0]) throw new DemoNotFound('Demo not found');
    return rows[0] as DemoRow;
  }
  async saveDraft(id: string, expectedRevision: number, draft: Record<string, unknown>, by: string) {
    const rows = await this.req('demos?id=eq.' + enc(id) + '&draft_revision=eq.' + expectedRevision + '&archived_at=is.null', { method: 'PATCH', body: { draft, draft_revision: expectedRevision + 1, draft_updated_by: by, draft_updated_at: now() }, prefer: 'return=representation' });
    if (rows[0]) return rows[0] as DemoRow;
    const current = await this.getDemo(id);
    if (!current) throw new DemoNotFound('Demo not found');
    throw new DemoConflict(current.archived_at ? 'This demo is archived' : 'The draft was changed elsewhere');
  }
  async saveVersion(id: string, by: string, expectedRevision: number, contentHash: string, note: string, metadata: Record<string, unknown>) {
    return await this.req('rpc/demo_save_version', { method: 'POST', body: { p_demo: id, p_principal: by, p_expected_revision: expectedRevision, p_content_hash: contentHash, p_note: note, p_metadata: metadata } }) as VersionRow;
  }
  async listVersions(demoId: string) { return await this.req('demo_versions?select=' + VSUMMARY_COLS + '&demo_id=eq.' + enc(demoId) + '&order=number.desc&limit=500') as VersionSummary[]; }
  async getVersion(demoId: string, number: number) { return ((await this.req('demo_versions?demo_id=eq.' + enc(demoId) + '&number=eq.' + number + '&limit=1')) as VersionRow[])[0] ?? null; }
  async setPrimary(demoId: string) { await this.req('rpc/demo_set_primary', { method: 'POST', body: { p_demo: demoId } }); }
  async fork(versionId: string, by: string, name: string) { return await this.req('rpc/demo_fork', { method: 'POST', body: { p_version: versionId, p_principal: by, p_name: name } }) as DemoRow; }
  async createPublication(p: { demo_id: string; workspace_id: string; version_id: string; token_hash: string; created_by: string }) {
    return (await this.req('demo_publications', { method: 'POST', body: p, prefer: 'return=representation' }))[0] as PublicationRow;
  }
  async listPublications(demoId: string) { return await this.req('demo_publications?demo_id=eq.' + enc(demoId) + '&order=created_at.desc&limit=100') as PublicationRow[]; }
  async revokePublication(id: string) {
    const rows = await this.req('demo_publications?id=eq.' + enc(id) + '&revoked_at=is.null', { method: 'PATCH', body: { revoked_at: now() }, prefer: 'return=representation' });
    return (rows[0] as PublicationRow) ?? ((await this.req('demo_publications?id=eq.' + enc(id) + '&limit=1'))[0] ?? null);
  }
  async publicationByHash(hash: string) {
    const p = ((await this.req('demo_publications?token_hash=eq.' + enc(hash) + '&revoked_at=is.null&limit=1')) as PublicationRow[])[0];
    if (!p) return null;
    const v = ((await this.req('demo_versions?id=eq.' + enc(p.version_id) + '&limit=1')) as VersionRow[])[0];
    const d = ((await this.req('demos?select=' + SUMMARY_COLS + '&id=eq.' + enc(p.demo_id) + '&limit=1')) as DemoSummary[])[0];
    return v && d ? { publication: p, version: v, demo: d } : null;
  }
  async createLaunch(l: NewLaunch) {
    try { return ((await this.req('demo_launches', { method: 'POST', body: l, prefer: 'return=representation' })) as LaunchRow[])[0]; }
    catch (e) { if (e instanceof DemoConflict) throw new DemoConflict('This launch was already used'); throw e; }
  }
  async getLaunch(id: string) { return ((await this.req('demo_launches?id=eq.' + enc(id) + '&limit=1')) as LaunchRow[])[0] ?? null; }
  async updateLaunch(id: string, patch: LaunchPatch, ifStatus?: LaunchStatus) {
    const rows = await this.req('demo_launches?id=eq.' + enc(id) + (ifStatus ? '&status=eq.' + ifStatus : ''), { method: 'PATCH', body: patch, prefer: 'return=representation' }) as LaunchRow[];
    return rows[0] ?? null;
  }
}
