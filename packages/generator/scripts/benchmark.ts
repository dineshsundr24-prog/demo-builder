// Quality benchmark: runs every brief in fixtures/benchmark/briefs.json through the full
// generator (plan -> approve -> screens) with one model and saves documents + job summaries.
// Usage: node scripts/benchmark.ts <outDir> [model]     (needs OPENAI_API_KEY; ~USD 0.02-0.15 per brief)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Generator, MemoryStore, OpenAIProvider, defaultConfig } from '../src/index.ts';

const [outDir, model = process.env.OPENAI_MODEL || 'gpt-4.1-mini'] = process.argv.slice(2);
const base = new URL('../fixtures/benchmark/', import.meta.url);
const briefs: { file: string; channel: 'mobile' | 'portal'; name: string }[] = JSON.parse(readFileSync(new URL('briefs.json', base), 'utf8'));
mkdirSync(outDir, { recursive: true });
const store = new MemoryStore();
const gen = new Generator(store, new OpenAIProvider(model, process.env.OPENAI_API_KEY!), { ...defaultConfig, monthlyBudgetUsd: 5 });
const wait = async (id: string, s: string[]) => { for (;;) { const j = (await store.getJob(id))!; if (s.includes(j.status)) return j; await new Promise(r => setTimeout(r, 400)); } };
await Promise.all(briefs.map(async b => {
  const t0 = Date.now();
  const job = await gen.startPlan({ name: b.name, company: b.name, channel: b.channel }, readFileSync(new URL(b.file, base), 'utf8'));
  const planned = await wait(job.id, ['awaiting_plan_approval', 'failed']);
  if (planned.status !== 'failed') await gen.approvePlan(job.id);
  const done = await wait(job.id, ['completed', 'completed_with_warnings', 'failed']);
  const screens = await store.listScreens(job.id);
  const key = b.file.replace(/\.md$/, '');
  if (done.document) writeFileSync(outDir + '/' + key + '.json', JSON.stringify(done.document, null, 1));
  writeFileSync(outDir + '/' + key + '.summary.json', JSON.stringify({ brief: b, model: done.model, status: done.status, error: done.error, seconds: Math.round((Date.now() - t0) / 1000),
    costUsd: Number(done.cost_usd), tokens: done.input_tokens + done.output_tokens, screens: screens.map(s => ({ id: s.screen_id, status: s.status, issues: (s.issues as any[]).filter(i => i.severity !== 'warning' || i.code === 'repair.reason').map(i => (i.code ?? '') + ' ' + (i.path ?? '') + ' ' + String(i.message ?? '').slice(0, 160)) })), warnings: done.warnings,
    plan: done.plan?.screens?.map((s: any) => ({ id: s.id, title: s.title, template: s.template, mustInclude: s.mustInclude })) }, null, 1));
  console.log(key.padEnd(18), done.status.padEnd(24), 'USD', Number(done.cost_usd).toFixed(4), Math.round((Date.now() - t0) / 1000) + 's', screens.map(s => s.status[0]).join(''));
}));
