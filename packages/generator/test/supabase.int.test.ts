// Integration test against the real Supabase project. Runs only when SUPABASE_URL is set.
// Uses the fake AI provider, so it costs nothing; it proves persistence and resume.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FakeProvider, Generator, SupabaseStore, defaultConfig, type CompletionRequest, type JobRow } from '../src/index.ts';

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
const brief = readFileSync(new URL('../fixtures/kapiko-brief.md', import.meta.url), 'utf8');
const kapiko = JSON.parse(readFileSync(new URL('../../schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const provider = () => new FakeProvider((req: CompletionRequest) => {
  const input = JSON.parse(req.input);
  if (req.purpose === 'plan') return { theme: { primary: '#000000', secondary: '#111111', accent: '#222222' }, sampleFacts: [], shellKind: 'tabs', menu: [{ label: 'Home', icon: 'home', screen: 'dashboard' }],
    collections: [{ id: 'service-requests', label: 'Requests', key: 'ref', fields: [{ id: 'ref', label: 'Ref' }, { id: 'type', label: 'Type' }, { id: 'status', label: 'Status' }, { id: 'date', label: 'Date' }], rows: [['A1', 'B', 'C', 'D'], ['E1', 'F', 'G', 'H']] }],
    screens: input.screenList.map((s: any) => ({ id: s.id, title: s.title, purpose: 'p', template: null, links: [], shell: 'default' })) };
  return kapiko.screens.find((s: any) => s.id === input.screen.id);
});
async function waitFor(gen: Generator, id: string, statuses: string[]): Promise<JobRow> {
  for (let i = 0; i < 300; i++) { const j = (await gen.store.getJob(id))!; if (statuses.includes(j.status)) return j; await new Promise(r => setTimeout(r, 100)); }
  throw Error('timeout');
}

test('Supabase: a job, its 12 screens and usage are persisted and readable by a fresh store', { skip: !url && 'SUPABASE_URL not set' }, async () => {
  const gen = new Generator(new SupabaseStore(url!, key!), provider(), { ...defaultConfig, retryDelaysMs: [1] });
  const job = await gen.startPlan({ name: 'Supabase integration test', channel: 'mobile' }, brief);
  await waitFor(gen, job.id, ['awaiting_plan_approval']);
  await gen.approvePlan(job.id);
  const done = await waitFor(gen, job.id, ['completed', 'completed_with_warnings', 'failed']);
  assert.equal(done.status, 'completed', JSON.stringify(done.error));
  // A brand-new store instance (as after a server restart) sees everything.
  const fresh = new SupabaseStore(url!, key!);
  const reloaded = (await fresh.getJob(job.id))!;
  assert.equal(reloaded.document.screens.length, 12);
  assert.equal((await fresh.listScreens(job.id)).filter(r => r.status === 'valid').length, 12);
  assert.ok(Number(reloaded.cost_usd) > 0 && reloaded.input_tokens > 0);
  assert.ok((await fresh.costSince(new Date(Date.now() - 3600_000))) > 0, 'usage events recorded');
  // Regenerating one screen updates only that row.
  await gen.regenerateScreen(job.id, 'dashboard');
  const again = await waitFor(gen, job.id, ['completed', 'completed_with_warnings']);
  const rows = await fresh.listScreens(job.id);
  assert.equal(rows.find(r => r.screen_id === 'dashboard')!.attempts, 2);
  assert.equal(rows.filter(r => r.attempts === 1).length, 11);
  assert.equal(again.document.screens.length, 12);
  // Clean up so test usage never counts against the real monthly AI budget.
  await deleteTestJob(job.id);
  assert.equal(await fresh.getJob(job.id), null);
  assert.equal((await fresh.listScreens(job.id)).length, 0);
});

async function deleteTestJob(id: string) {
  const headers = { apikey: key!, ...(key!.startsWith('eyJ') ? { Authorization: 'Bearer ' + key } : {}) };
  for (const path of ['usage_events?job_id=eq.' + id, 'generation_jobs?id=eq.' + id]) {
    const r = await fetch(url + '/rest/v1/' + path, { method: 'DELETE', headers });
    assert.ok(r.ok, 'cleanup ' + path + ' -> ' + r.status);
  }
}
