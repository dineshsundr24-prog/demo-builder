// Job orchestration: plan -> (review) -> bounded-concurrency screen generation
// -> assemble. Budgets are enforced before every paid call; completed screens
// are persisted immediately and never regenerated unless asked.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Screen } from '@demo/schema';
import { ProviderError, costUsd, type LlmProvider, type CompletionResult } from './provider.ts';
import { createPlan, type GenerationRequest, type Plan } from './plan.ts';
import { generateScreen, refineBindings } from './screen.ts';
import { validateScreen, documentContext } from '@demo/schema';
import { assemble } from './assemble.ts';
import type { JobRow, JobStore, ScreenRow } from './store.ts';

export type GeneratorConfig = { concurrency: number; maxScreensPerJob: number; jobTokenBudget: number; monthlyBudgetUsd: number; retryDelaysMs: number[]; maxBindingRefinements: number };
export const defaultConfig: GeneratorConfig = { concurrency: 4, maxScreensPerJob: 40, jobTokenBudget: 600_000, monthlyBudgetUsd: 15, retryDelaysMs: [2000, 6000], maxBindingRefinements: 6 };
export class JobError extends Error { category: string; status: number; constructor(category: string, message: string, status = 400) { super(message); this.category = category; this.status = status; } }

export class Generator {
  readonly events = new EventEmitter();
  private running = new Set<string>();
  readonly store: JobStore; readonly provider: LlmProvider; readonly config: GeneratorConfig;
  constructor(store: JobStore, provider: LlmProvider, config: GeneratorConfig = defaultConfig) { this.store = store; this.provider = provider; this.config = config; this.events.setMaxListeners(200); }

  private emit(jobId: string, type: string, data: unknown = {}) { this.events.emit(jobId, { type, data, at: new Date().toISOString() }); }
  private monthStart() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
  async budgetStatus() { const spent = await this.store.costSince(this.monthStart()); return { spentUsd: spent, limitUsd: this.config.monthlyBudgetUsd, remainingUsd: Math.max(0, this.config.monthlyBudgetUsd - spent) }; }
  private async assertBudget(job: JobRow) {
    const b = await this.budgetStatus();
    if (b.remainingUsd <= 0) throw new ProviderError('budget', 'Monthly AI budget of USD ' + b.limitUsd + ' is used up (USD ' + b.spentUsd.toFixed(2) + ' spent). Raise MONTHLY_AI_BUDGET_USD to continue.', false);
    const fresh = (await this.store.getJob(job.id))!;
    if (fresh.input_tokens + fresh.output_tokens >= fresh.token_budget) throw new ProviderError('budget', 'This job reached its token budget (' + fresh.token_budget + '). Completed screens are kept.', false);
    if (fresh.status === 'cancelled') throw new JobError('cancelled', 'Job was cancelled');
  }
  private async record(jobId: string, kind: 'plan' | 'screen' | 'repair', call: CompletionResult) {
    const cost = costUsd(call.model, call.usage);
    await this.store.addUsage({ job_id: jobId, kind, model: call.model, input_tokens: call.usage.inputTokens, cached_tokens: call.usage.cachedTokens, output_tokens: call.usage.outputTokens, cost_usd: cost });
    const j = (await this.store.getJob(jobId))!;
    await this.store.updateJob(jobId, { input_tokens: j.input_tokens + call.usage.inputTokens, output_tokens: j.output_tokens + call.usage.outputTokens, cost_usd: Number(j.cost_usd) + cost, model: call.model });
  }
  /** Retry transient provider failures with backoff; never retry invalid requests. */
  private async withRetry<T>(job: JobRow, work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.assertBudget(job);
      try { return await work(); }
      catch (e) {
        if (!(e instanceof ProviderError) || !e.retryable || attempt >= this.config.retryDelaysMs.length) throw e;
        await new Promise(r => setTimeout(r, this.config.retryDelaysMs[attempt]));
      }
    }
  }
  private async fail(jobId: string, e: unknown) {
    const job = await this.store.getJob(jobId);
    const category = e instanceof ProviderError || e instanceof JobError ? e.category : (e as any)?.category ?? 'internal';
    const message = e instanceof Error ? e.message : 'Unexpected error';
    if (job?.status === 'cancelled') return;
    await this.store.updateJob(jobId, { status: 'failed', error: { category, message, traceId: job?.trace_id ?? '' }, finished_at: new Date().toISOString() });
    this.emit(jobId, 'failed', { category, message });
  }

  /** Step 1: create a job and produce a reviewable plan (one AI call). */
  async startPlan(request: GenerationRequest, brief: string): Promise<JobRow> {
    if (!['mobile', 'portal'].includes(request.channel)) throw new JobError('bad_request', 'Channel must be mobile or portal');
    if (typeof brief !== 'string' || brief.trim().length < 15 || brief.length > 60000) throw new JobError('bad_request', 'The brief must be 15-60,000 characters');
    const job = await this.store.createJob({ status: 'planning', request: { name: request.name, company: request.company ?? '', channel: request.channel, guidelines: request.guidelines ?? '' }, brief, token_budget: this.config.jobTokenBudget, trace_id: 'trc_' + randomUUID().slice(0, 12) });
    this.emit(job.id, 'planning');
    void (async () => {
      try {
        const { plan, call } = await this.withRetry(job, () => createPlan(this.provider, request, brief, { maxScreens: this.config.maxScreensPerJob }));
        await this.record(job.id, 'plan', call);
        await this.store.updateJob(job.id, { status: 'awaiting_plan_approval', plan, warnings: plan.notes });
        await this.store.upsertScreens(plan.screens.map((s, i) => ({ job_id: job.id, screen_id: s.id, title: s.title, position: i, status: 'pending', attempts: 0, screen: null, issues: [], input_tokens: 0, output_tokens: 0 })));
        this.emit(job.id, 'plan_ready', { screens: plan.screens.length });
      } catch (e) { await this.fail(job.id, e); }
    })();
    return job;
  }

  /** Step 2: optionally edit, then approve the plan; generation runs in the background. */
  async approvePlan(jobId: string, edited?: Plan): Promise<JobRow> {
    const job = await this.mustGet(jobId);
    if (job.status !== 'awaiting_plan_approval') throw new JobError('conflict', 'Job is ' + job.status + ', not awaiting plan approval', 409);
    let plan: Plan = job.plan;
    if (edited) {
      const ids = edited.screens?.map(s => s.id) ?? [];
      if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(id))) throw new JobError('bad_request', 'Edited plan must have unique, valid screen ids');
      if (ids.length > this.config.maxScreensPerJob) throw new JobError('budget', 'Plan has ' + ids.length + ' screens; the limit per job is ' + this.config.maxScreensPerJob);
      plan = { ...job.plan, ...edited, screens: edited.screens.map(s => ({ ...s, links: (s.links ?? []).filter(l => ids.includes(l)) })) };
      await this.store.upsertScreens(plan.screens.map((s, i) => ({ job_id: jobId, screen_id: s.id, title: s.title, position: i, status: 'pending', attempts: 0, screen: null, issues: [], input_tokens: 0, output_tokens: 0 })));
    }
    const updated = await this.store.updateJob(jobId, { status: 'generating', plan });
    this.emit(jobId, 'generating');
    void this.generate(jobId, plan.screens.map(s => s.id));
    return updated;
  }

  /** Generate (or regenerate) the given screens, then assemble the document. */
  async generate(jobId: string, screenIds: string[]): Promise<void> {
    if (this.running.has(jobId)) return;
    this.running.add(jobId);
    try {
      const job = await this.mustGet(jobId);
      const plan: Plan = job.plan;
      const rows = new Map((await this.store.listScreens(jobId)).map(r => [r.screen_id, r]));
      const queue = plan.screens.filter(s => screenIds.includes(s.id));
      let fatal: unknown = null;
      const worker = async () => {
        for (let s = queue.shift(); s && !fatal; s = queue.shift()) {
          const base: ScreenRow = rows.get(s.id) ?? { job_id: jobId, screen_id: s.id, title: s.title, position: plan.screens.indexOf(s), status: 'pending', attempts: 0, screen: null, issues: [], input_tokens: 0, output_tokens: 0 };
          const running: ScreenRow = { ...base, status: 'running', attempts: base.attempts + 1 };
          await this.store.upsertScreens([running]);
          this.emit(jobId, 'screen_started', { screenId: s.id });
          try {
            const out = await this.withRetry(job, () => generateScreen(this.provider, plan, s, (kind, call) => this.record(jobId, kind, call)));
            const tokens = out.calls.reduce((a, c) => ({ i: a.i + c.usage.inputTokens, o: a.o + c.usage.outputTokens }), { i: 0, o: 0 });
            await this.store.upsertScreens([{ ...running, status: out.status, screen: out.screen, issues: out.status === 'fallback' ? [{ code: 'generation.fallback', message: out.failure ?? 'Fallback used' }, ...out.issues] : out.issues, input_tokens: base.input_tokens + tokens.i, output_tokens: base.output_tokens + tokens.o }]);
            this.emit(jobId, 'screen_done', { screenId: s.id, status: out.status });
          } catch (e) {
            await this.store.upsertScreens([{ ...running, status: 'failed', issues: [{ code: 'provider.' + ((e as any)?.category ?? 'error'), message: e instanceof Error ? e.message : String(e) }] }]);
            this.emit(jobId, 'screen_failed', { screenId: s.id });
            fatal = e; // budget, auth, bad request, cancel or exhausted retries: stop starting new screens
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(this.config.concurrency, queue.length || 1) }, worker));
      if (fatal) { await this.fail(jobId, fatal); return; }
      await this.finish(jobId);
    } catch (e) { await this.fail(jobId, e); }
    finally { this.running.delete(jobId); }
  }

  private async finish(jobId: string) {
    const job = await this.mustGet(jobId);
    await this.store.updateJob(jobId, { status: 'linking' });
    let rows = await this.store.listScreens(jobId);
    const missing = rows.filter(r => !r.screen);
    if (missing.length) throw new JobError('incomplete', missing.length + ' screen(s) have no result: ' + missing.map(r => r.title).join(', '));
    let { document, issues, fixes } = assemble(job.plan, rows.map(r => r.screen as Screen));
    // Cross-screen pass: one targeted call per screen whose bindings nothing satisfies (bounded).
    const bindingCodes = ['binding.state-unwritten', 'binding.no-record'];
    const affected = [...new Set(issues.filter(i => bindingCodes.includes(i.code) && i.screenId).map(i => i.screenId!))].slice(0, this.config.maxBindingRefinements);
    if (affected.length) {
      const ctx = documentContext(document);
      let improved = false;
      await Promise.all(affected.map(async id => {
        const current = document.screens.find(s => s.id === id)!;
        const problems = issues.filter(i => i.screenId === id && bindingCodes.includes(i.code)).map(i => ({ ...i, path: i.path.replace(/^doc\.screens\[\d+\]/, 'screen') }));
        try {
          await this.assertBudget(job);
          const next = await refineBindings(this.provider, job.plan, current, problems, [...ctx.stateKeys], [...ctx.recordScreens], (kind, call) => this.record(jobId, kind, call));
          const after = next ? validateScreen(next, ctx) : [];
          if (next && !after.some(i => i.severity === 'error') && after.filter(i => bindingCodes.includes(i.code)).length < problems.length) {
            const row = rows.find(r => r.screen_id === id)!;
            await this.store.upsertScreens([{ ...row, screen: next, status: row.status === 'valid' ? 'repaired' : row.status, issues: after }]);
            improved = true;
          }
        } catch { /* keep the original screen; warnings stay visible */ }
      }));
      if (improved) { rows = await this.store.listScreens(jobId); ({ document, issues, fixes } = assemble(job.plan, rows.map(r => r.screen as Screen))); fixes.push('Refined data bindings on ' + affected.length + ' screen(s)'); }
    }
    const fallbacks = rows.filter(r => r.status === 'fallback');
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = [...(job.plan.notes ?? []), ...fixes, ...fallbacks.map(r => '"' + r.title + '" needs attention (fallback used)'), ...issues.map(i => (i.severity === 'error' ? 'Error: ' : '') + i.message)];
    await this.store.updateJob(jobId, { status: fallbacks.length || errors.length ? 'completed_with_warnings' : 'completed', document, warnings, finished_at: new Date().toISOString() });
    this.emit(jobId, 'completed', { fallbacks: fallbacks.length, warnings: warnings.length });
  }

  async regenerateScreen(jobId: string, screenId: string) {
    const job = await this.mustGet(jobId);
    if (!['completed', 'completed_with_warnings', 'failed'].includes(job.status)) throw new JobError('conflict', 'Job is ' + job.status, 409);
    if (!job.plan?.screens?.some((s: any) => s.id === screenId)) throw new JobError('not_found', 'Screen ' + screenId + ' is not in this plan', 404);
    await this.store.updateJob(jobId, { status: 'generating', error: null });
    void this.generate(jobId, [screenId]);
  }
  /** Regenerate only screens that failed or fell back; valid screens are kept. */
  async retry(jobId: string) {
    const job = await this.mustGet(jobId);
    if (!['completed_with_warnings', 'failed'].includes(job.status)) throw new JobError('conflict', 'Nothing to retry for a ' + job.status + ' job', 409);
    const redo = (await this.store.listScreens(jobId)).filter(r => ['failed', 'fallback', 'pending', 'running'].includes(r.status)).map(r => r.screen_id);
    if (!redo.length) throw new JobError('conflict', 'All screens are already valid', 409);
    await this.store.updateJob(jobId, { status: 'generating', error: null });
    void this.generate(jobId, redo);
    return redo;
  }
  async cancel(jobId: string) {
    const job = await this.mustGet(jobId);
    if (['completed', 'completed_with_warnings', 'failed', 'cancelled'].includes(job.status)) return job;
    const out = await this.store.updateJob(jobId, { status: 'cancelled', finished_at: new Date().toISOString() });
    this.emit(jobId, 'cancelled'); return out;
  }
  async snapshot(jobId: string) {
    const job = await this.mustGet(jobId);
    const screens = await this.store.listScreens(jobId);
    return { job, screens: screens.map(({ screen, ...r }) => ({ ...r, hasResult: !!screen })) };
  }
  private async mustGet(id: string) { const j = await this.store.getJob(id); if (!j) throw new JobError('not_found', 'Job not found', 404); return j; }
}
