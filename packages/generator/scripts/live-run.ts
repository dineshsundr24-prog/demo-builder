// Controlled live generation run (one job). Usage:
//   node scripts/live-run.ts <brief.md> <mobile|portal> "<App name>" [--supabase]
// Needs OPENAI_API_KEY (and SUPABASE_URL/SUPABASE_SECRET_KEY with --supabase). Prints a summary only.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { validateDocument, flowEdges } from '@demo/schema';
import { Generator, MemoryStore, SupabaseStore, OpenAIProvider, defaultConfig, type JobStore } from '../src/index.ts';

const [briefPath, channel, name] = process.argv.slice(2);
const useSupabase = process.argv.includes('--supabase');
const store: JobStore = useSupabase ? new SupabaseStore(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!) : new MemoryStore();
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const gen = new Generator(store, new OpenAIProvider(model, process.env.OPENAI_API_KEY!), { ...defaultConfig, monthlyBudgetUsd: Number(process.env.MONTHLY_AI_BUDGET_USD || 15) });
const t0 = Date.now();
const wait = async (id: string, statuses: string[]) => { for (;;) { const j = (await store.getJob(id))!; if (statuses.includes(j.status)) return j; await new Promise(r => setTimeout(r, 500)); } };
const job = await gen.startPlan({ name, company: name, channel: channel as 'mobile' | 'portal' }, readFileSync(briefPath, 'utf8'));
const planned = await wait(job.id, ['awaiting_plan_approval', 'failed']);
const tPlan = Date.now() - t0;
if (planned.status === 'failed') { console.log(JSON.stringify({ stage: 'plan', error: planned.error }, null, 1)); process.exit(1); }
console.log('plan ok in', tPlan, 'ms:', planned.plan.screens.length, 'screens; shell', planned.plan.shell.kind, '; collections', planned.plan.collections.map((c: any) => c.id + '(' + c.rows.length + ')').join(','));
await gen.approvePlan(job.id);
const done = await wait(job.id, ['completed', 'completed_with_warnings', 'failed']);
const screens = await store.listScreens(job.id);
const issues = done.document ? validateDocument(done.document) : [];
const out = {
  jobId: job.id, store: store.kind, status: done.status, error: done.error, model: done.model, totalMs: Date.now() - t0, planMs: tPlan,
  tokens: { input: done.input_tokens, output: done.output_tokens }, costUsd: Number(Number(done.cost_usd).toFixed(4)),
  screens: screens.map(s => ({ id: s.screen_id, status: s.status, attempts: s.attempts, components: JSON.stringify(s.screen ?? {}).match(/"type":/g)?.length ?? 0, issues: (s.issues as any[]).filter(i => i.severity !== 'warning').map(i => i.code + (i.path ? ' ' + i.path : '') + (i.message ? ': ' + String(i.message).slice(0, 120) : '')) })),
  documentErrors: issues.filter(i => i.severity === 'error').map(i => i.code + ' ' + i.path),
  documentWarnings: issues.filter(i => i.severity === 'warning').length,
  edges: done.document ? flowEdges(done.document).filter(e => !e.via.startsWith('Menu')).length : 0,
  warnings: done.warnings,
};
console.log(JSON.stringify(out, null, 1));
if (done.document) { mkdirSync(new URL('../fixtures/live/', import.meta.url), { recursive: true }); writeFileSync(new URL('../fixtures/live/' + channel + '-' + new Date().toISOString().slice(0, 10) + '.json', import.meta.url), JSON.stringify(done.document, null, 1)); }
