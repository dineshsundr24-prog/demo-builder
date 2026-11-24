// Generation job persistence. Completed screens survive restarts, retries and
// page refreshes (Decision D8). Supabase is accessed with the server-side key only.
import { randomUUID } from 'node:crypto';

export type JobStatus = 'planning' | 'awaiting_plan_approval' | 'generating' | 'linking' | 'completed' | 'completed_with_warnings' | 'failed' | 'cancelled';
export type ScreenStatus = 'pending' | 'running' | 'valid' | 'repaired' | 'fallback' | 'failed';
export type JobRow = {
  id: string; status: JobStatus; request: Record<string, unknown>; brief: string; plan: any | null; document: any | null;
  warnings: string[]; error: { category: string; message: string; traceId: string } | null; model: string | null;
  input_tokens: number; output_tokens: number; token_budget: number; cost_usd: number; trace_id: string;
  created_at: string; updated_at: string; finished_at: string | null;
};
export type ScreenRow = {
  job_id: string; screen_id: string; title: string; position: number; status: ScreenStatus; attempts: number;
  screen: any | null; issues: unknown[]; input_tokens: number; output_tokens: number; updated_at?: string;
};
export type UsageRow = { job_id: string | null; kind: 'plan' | 'screen' | 'repair' | 'assist'; model: string; input_tokens: number; cached_tokens: number; output_tokens: number; cost_usd: number };
export type NewJob = Pick<JobRow, 'status' | 'request' | 'brief' | 'token_budget' | 'trace_id'>;

export interface JobStore {
  readonly kind: string;
  createJob(job: NewJob): Promise<JobRow>;
  getJob(id: string): Promise<JobRow | null>;
  updateJob(id: string, patch: Partial<JobRow>): Promise<JobRow>;
  upsertScreens(rows: ScreenRow[]): Promise<void>;
  listScreens(jobId: string): Promise<ScreenRow[]>;
  addUsage(row: UsageRow): Promise<void>;
  costSince(since: Date): Promise<number>;
  listJobs(limit: number): Promise<JobSummary[]>;
}
export type JobSummary = Pick<JobRow, 'id' | 'status' | 'request' | 'cost_usd' | 'created_at' | 'finished_at'>;

const now = () => new Date().toISOString();
export class MemoryStore implements JobStore {
  readonly kind = 'memory';
  jobs = new Map<string, JobRow>(); screens = new Map<string, ScreenRow>(); usage: (UsageRow & { created_at: string })[] = [];
  async createJob(j: NewJob) {
    const row: JobRow = { id: randomUUID(), plan: null, document: null, warnings: [], error: null, model: null, input_tokens: 0, output_tokens: 0, cost_usd: 0, created_at: now(), updated_at: now(), finished_at: null, ...j };
    this.jobs.set(row.id, row); return structuredClone(row);
  }
  async getJob(id: string) { const j = this.jobs.get(id); return j ? structuredClone(j) : null; }
  async updateJob(id: string, patch: Partial<JobRow>) {
    const j = this.jobs.get(id); if (!j) throw Error('Job ' + id + ' not found');
    const next = { ...j, ...structuredClone(patch), updated_at: now() }; this.jobs.set(id, next); return structuredClone(next);
  }
  async upsertScreens(rows: ScreenRow[]) { for (const r of rows) this.screens.set(r.job_id + '/' + r.screen_id, { ...structuredClone(r), updated_at: now() }); }
  async listScreens(jobId: string) { return [...this.screens.values()].filter(r => r.job_id === jobId).sort((a, b) => a.position - b.position).map(r => structuredClone(r)); }
  async addUsage(row: UsageRow) { this.usage.push({ ...row, created_at: now() }); }
  async costSince(since: Date) { return this.usage.filter(u => new Date(u.created_at) >= since).reduce((s, u) => s + u.cost_usd, 0); }
  async listJobs(limit: number) {
    return [...this.jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)
      .map(({ id, status, request, cost_usd, created_at, finished_at }) => ({ id, status, request, cost_usd, created_at, finished_at }));
  }
}

export class StoreError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }

/** Supabase (PostgREST) store. The key is sent in the `apikey` header only. */
export class SupabaseStore implements JobStore {
  readonly kind = 'supabase';
  private url: string; private key: string;
  constructor(url: string, key: string) { this.url = url; this.key = key; if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw Error('SUPABASE_URL must look like https://<project>.supabase.co'); }
  private async req(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<any> {
    const headers: Record<string, string> = { apikey: this.key, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (this.key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + this.key; // legacy JWT service_role keys
    if (init.prefer) headers.Prefer = init.prefer;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url + '/rest/v1/' + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
      if (res.status >= 500 && attempt < 2) { await new Promise(r => setTimeout(r, 400 * (attempt + 1))); continue; }
      const text = await res.text();
      if (!res.ok) {
        let msg = text.slice(0, 300);
        try { const e = JSON.parse(text); msg = [e.code, e.message, e.hint].filter(Boolean).join(' · '); } catch { /* raw */ }
        throw new StoreError('Supabase ' + (init.method ?? 'GET') + ' ' + path.split('?')[0] + ' failed (' + res.status + '): ' + msg, res.status);
      }
      return text ? JSON.parse(text) : null;
    }
  }
  async createJob(j: NewJob) { return (await this.req('generation_jobs', { method: 'POST', body: j, prefer: 'return=representation' }))[0] as JobRow; }
  async getJob(id: string) { return ((await this.req('generation_jobs?id=eq.' + encodeURIComponent(id) + '&limit=1')) as JobRow[])[0] ?? null; }
  async updateJob(id: string, patch: Partial<JobRow>) {
    const rows = await this.req('generation_jobs?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: { ...patch, updated_at: now() }, prefer: 'return=representation' });
    if (!rows?.[0]) throw new StoreError('Job ' + id + ' not found', 404);
    return rows[0] as JobRow;
  }
  async upsertScreens(rows: ScreenRow[]) {
    if (!rows.length) return;
    await this.req('generation_screens?on_conflict=job_id,screen_id', { method: 'POST', body: rows.map(r => ({ ...r, updated_at: now() })), prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  async listScreens(jobId: string) { return (await this.req('generation_screens?job_id=eq.' + encodeURIComponent(jobId) + '&order=position.asc')) as ScreenRow[]; }
  async addUsage(row: UsageRow) { await this.req('usage_events', { method: 'POST', body: { ...row, cost_usd: Number(row.cost_usd.toFixed(5)) }, prefer: 'return=minimal' }); }
  async listJobs(limit: number) {
    return (await this.req('generation_jobs?select=id,status,request,cost_usd,created_at,finished_at&order=created_at.desc&limit=' + Math.max(1, Math.min(100, Math.floor(limit))))) as JobSummary[];
  }
  async costSince(since: Date) {
    const rows = (await this.req('usage_events?select=cost_usd&created_at=gte.' + encodeURIComponent(since.toISOString()) + '&limit=100000')) as { cost_usd: string | number }[];
    return rows.reduce((s, r) => s + Number(r.cost_usd), 0);
  }
}
