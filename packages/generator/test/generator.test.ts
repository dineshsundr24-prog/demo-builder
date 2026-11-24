import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDocument, errorsOnly, flowEdges, type DemoDocument } from '@demo/schema';
import { FakeProvider, ProviderError, Generator, MemoryStore, defaultConfig, parseBrief, type CompletionRequest, type JobRow } from '../src/index.ts';

const kapikoBrief = readFileSync(new URL('../fixtures/kapiko-brief.md', import.meta.url), 'utf8');
const kapikoDoc: DemoDocument = JSON.parse(readFileSync(new URL('../../schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const cfg = { ...defaultConfig, retryDelaysMs: [1, 1] };

/** Fake planner: echoes the locked screen list with links following the list order. */
function fakePlan(req: CompletionRequest) {
  const input = JSON.parse(req.input);
  const list = input.screenList ?? [{ id: 'home', title: 'Home' }, { id: 'done', title: 'Done' }];
  return {
    theme: { primary: '#000000', secondary: '#111111', accent: '#222222' }, sampleFacts: [{ label: 'Customer', value: 'Ahmed Al Hammadi' }], shellKind: 'tabs',
    menu: [{ label: 'Home', icon: 'home', screen: list[Math.min(6, list.length - 1)].id }],
    collections: [{ id: 'service-requests', label: 'Requests', key: 'ref', fields: [{ id: 'ref', label: 'Ref' }, { id: 'type', label: 'Type' }, { id: 'status', label: 'Status' }, { id: 'date', label: 'Date' }],
      rows: [['KPK-INC-2026-00125', 'Income update', 'In review', '24 Nov 2026'], ['KPK-CRD-2026-00087', 'Card', 'Completed', '02 Nov 2026']] }],
    screens: list.map((s: any, i: number) => ({ id: s.id, title: s.title, purpose: 'Purpose of ' + s.title, template: null, links: list[i + 1] ? [list[i + 1].id] : [], shell: 'default', mustInclude: [] })),
  };
}
const screenIdOf = (req: CompletionRequest) => { const i = JSON.parse(req.input); return (i.screen ?? i.context?.screen).id as string; };
const kapikoScreen = (id: string) => structuredClone(kapikoDoc.screens.find(s => s.id === id)!);
async function waitFor(gen: Generator, id: string, statuses: string[], ms = 5000): Promise<JobRow> {
  const end = Date.now() + ms;
  for (;;) { const j = (await gen.store.getJob(id))!; if (statuses.includes(j.status)) return j; if (Date.now() > end) throw Error('Timed out in ' + j.status + ' ' + JSON.stringify(j.error)); await new Promise(r => setTimeout(r, 5)); }
}
async function runToEnd(gen: Generator, brief = kapikoBrief) {
  const job = await gen.startPlan({ name: 'Kapiko Bank Mobile', company: 'Kapiko Bank', channel: 'mobile' }, brief);
  await waitFor(gen, job.id, ['awaiting_plan_approval', 'failed']);
  await gen.approvePlan(job.id);
  return waitFor(gen, job.id, ['completed', 'completed_with_warnings', 'failed']);
}

test('brief parser locks the Kapiko list in the handover format', () => {
  const p = parseBrief(kapikoBrief)!;
  assert.deepEqual(p.screens.map(s => s.id), ['welcome', 'sign-in', 'sign-up', 'mobile-otp-verification', 'ekyc-using-uae-pass', 'face-verification', 'dashboard', 'income-update', 'income-verification-review', 'income-update-confirmation', 'my-service-requests', 'customer-profile']);
  assert.ok(p.globalContext.includes('Journeys:') && p.globalContext.includes('#17365D'));
  assert.ok(!p.globalContext.includes('Six-digit OTP'), 'screen details stay with their screen');
});

test('happy path: exactly 12 planned screens, persisted, assembled, valid and connected', async () => {
  const provider = new FakeProvider(req => req.purpose === 'plan' ? fakePlan(req) : kapikoScreen(screenIdOf(req)));
  const gen = new Generator(new MemoryStore(), provider, cfg);
  const job = await runToEnd(gen);
  assert.equal(job.status, 'completed', JSON.stringify(job.warnings));
  const doc = job.document as DemoDocument;
  assert.equal(doc.screens.length, 12);
  assert.deepEqual(errorsOnly(validateDocument(doc)), []);
  assert.deepEqual(doc.theme.primary, '#17365D', 'brief colours win over model colours');
  assert.ok(flowEdges(doc).some(e => e.from === 'income-update' && e.to === 'income-verification-review'));
  assert.equal(provider.calls.filter(c => c.purpose === 'screen').length, 12);
  const schemas = new Set(provider.calls.filter(c => c.purpose === 'screen').map(c => JSON.stringify(c.schema)));
  assert.equal(schemas.size, 1, 'one identical schema per job (cacheable)');
  const rows = await gen.store.listScreens(job.id);
  assert.ok(rows.every(r => r.status === 'valid' && r.screen));
  assert.ok(job.input_tokens > 0 && job.cost_usd > 0);
});

test('invalid screen gets exactly one targeted repair with the exact problem', async () => {
  const provider = new FakeProvider(req => {
    if (req.purpose === 'plan') return fakePlan(req);
    const id = screenIdOf(req);
    if (id === 'income-update' && req.purpose === 'screen') {
      const s = kapikoScreen(id); // the live gpt-4.1-mini mistake: submit outside the form, no form id
      (s.children as any[]).find(n => n.id === 'income-actions').children[1].actions[0] = { type: 'submit', validate: true };
      return s;
    }
    return kapikoScreen(id);
  });
  const gen = new Generator(new MemoryStore(), provider, cfg);
  const job = await runToEnd(gen);
  const repair = provider.calls.find(c => c.purpose === 'repair')!;
  assert.ok(JSON.parse(repair.input).problems[0].includes('needs an enclosing Form or a form id'));
  assert.equal((await gen.store.listScreens(job.id)).find(r => r.screen_id === 'income-update')!.status, 'repaired');
  assert.equal(job.status, 'completed');
});

test('persistently invalid screen falls back, job still completes, retry redoes only that screen', async () => {
  let broken = true;
  const provider = new FakeProvider(req => {
    if (req.purpose === 'plan') return fakePlan(req);
    const id = screenIdOf(req);
    if (id === 'dashboard' && broken) return { id, title: 'x', shell: 'default', children: [{ type: 'Button', id: 'b', label: 'Go', variant: 'primary', actions: [{ type: 'navigate', screen: 'nowhere' }] }] };
    return kapikoScreen(id);
  });
  const gen = new Generator(new MemoryStore(), provider, cfg);
  const job = await runToEnd(gen);
  assert.equal(job.status, 'completed_with_warnings');
  assert.ok(job.warnings.some(w => w.includes('"Dashboard" needs attention')));
  assert.deepEqual(errorsOnly(validateDocument(job.document)), [], 'fallback screen is valid and navigable');
  const before = provider.calls.length;
  broken = false;
  assert.deepEqual(await gen.retry(job.id), ['dashboard']);
  const again = await waitFor(gen, job.id, ['completed', 'completed_with_warnings', 'failed']);
  assert.equal(again.status, 'completed');
  assert.equal(provider.calls.length - before, 1, 'only the dashboard was regenerated');
});

test('transient rate limit is retried; auth failure stops the job but keeps finished screens', async () => {
  let n = 0;
  const flaky = new FakeProvider(req => req.purpose === 'plan' ? fakePlan(req) : (++n === 2 ? new ProviderError('rate_limit', 'slow down', true) : kapikoScreen(screenIdOf(req))));
  const job = await runToEnd(new Generator(new MemoryStore(), flaky, cfg));
  assert.equal(job.status, 'completed');

  let m = 0;
  const store = new MemoryStore();
  const denied = new FakeProvider(req => req.purpose === 'plan' ? fakePlan(req) : (++m >= 5 ? new ProviderError('auth', 'bad key', false) : kapikoScreen(screenIdOf(req))));
  const gen = new Generator(store, denied, { ...cfg, concurrency: 1 });
  const failed = await runToEnd(gen);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error!.category, 'auth');
  assert.equal((await store.listScreens(failed.id)).filter(r => r.status === 'valid').length, 4, 'completed screens are kept');
});

test('monthly budget guard stops before any paid call', async () => {
  const store = new MemoryStore();
  await store.addUsage({ job_id: null, kind: 'screen', model: 'gpt-4.1-mini', input_tokens: 1, cached_tokens: 0, output_tokens: 1, cost_usd: 15.01 });
  const provider = new FakeProvider(fakePlan);
  const gen = new Generator(store, provider, cfg);
  const job = await gen.startPlan({ name: 'X', channel: 'mobile' }, kapikoBrief);
  const done = await waitFor(gen, job.id, ['failed']);
  assert.equal(done.error!.category, 'budget');
  assert.equal(provider.calls.length, 0);
});

test('30-screen plan: all screens generated with bounded concurrency', async () => {
  const brief = 'Large journey.\n' + Array.from({ length: 30 }, (_, i) => 'Screen ' + (i + 1) + ': Step ' + (i + 1) + ' - details').join('\n');
  let active = 0, peak = 0;
  const provider = new FakeProvider(async req => {
    if (req.purpose === 'plan') return fakePlan(req);
    active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 3)); active--;
    const input = JSON.parse(req.input), next = input.screen.leadsTo[0]?.id;
    return { id: input.screen.id, title: input.screen.title, shell: 'default', children: [{ type: 'Heading', id: 'h', text: input.screen.title, level: '2' },
      ...(next ? [{ type: 'Button', id: 'next', label: 'Next', variant: 'primary', actions: [{ type: 'navigate', screen: next }] }] : [])] };
  });
  const gen = new Generator(new MemoryStore(), provider, cfg);
  const job = await runToEnd(gen, brief);
  assert.equal(job.status, 'completed');
  assert.equal(job.document.screens.length, 30);
  assert.ok(peak <= cfg.concurrency && peak > 1, 'peak concurrency ' + peak);
});

test('assembly links a mismatched state key and adds a missing planned link', async () => {
  const provider = new FakeProvider(req => {
    if (req.purpose === 'plan') return fakePlan(req);
    const id = screenIdOf(req), s = kapikoScreen(id);
    if (id === 'income-verification-review') (s.children as any[])[0].items[1].value = 'AED {{state.incomeUpdate.salary}}';
    if (id === 'income-update-confirmation') (s.children as any[]).splice(1, 1); // drop "View request"
    return s;
  });
  const job = await runToEnd(new Generator(new MemoryStore(), provider, cfg));
  assert.ok(job.warnings.some(w => w.includes('Linked {{state.incomeUpdate.salary}}')));
  assert.ok(JSON.stringify(job.document).includes('{{state.income.salary}}'));
});

test('cross-screen pass replaces bindings nothing writes, with one call for that screen only', async () => {
  const provider = new FakeProvider(req => {
    if (req.purpose === 'plan') return fakePlan(req);
    const id = screenIdOf(req), s = kapikoScreen(id);
    if (id === 'income-update' && req.purpose === 'screen') (s.children as any[])[0].items[0].value = '{{state.employer.currentName}}';
    if (id === 'income-update' && req.purpose === 'repair') {
      const input = JSON.parse(req.input);
      assert.ok(input.stateKeysEnteredInTheApp.includes('income.salary'));
      assert.ok(input.problems[0].includes('employer.currentName'));
    }
    return s; // the repaired version uses literal text again
  });
  const gen = new Generator(new MemoryStore(), provider, cfg);
  const job = await runToEnd(gen);
  assert.equal(provider.calls.filter(c => c.purpose === 'repair').length, 1);
  assert.ok(!JSON.stringify(job.document).includes('employer.currentName'));
  assert.ok(job.warnings.some(w => w.includes('Refined data bindings on 1 screen')));
});

test('stray braces in generated text are errors (live artifact "20,000 AED},{")', async () => {
  const { validateScreen, documentContext } = await import('@demo/schema');
  const issues = validateScreen({ id: 'x', title: 'X', shell: 'default', children: [{ type: 'Stat', id: 's', label: 'Previous income', value: '20,000 AED},{' }] }, documentContext(kapikoDoc));
  assert.ok(issues.some(i => i.code === 'quality.artifact' && i.severity === 'error'));
  assert.deepEqual(validateScreen({ id: 'x', title: 'X', shell: 'default', children: [{ type: 'Text', id: 't', text: 'Salary {{state.income.salary | aed}}' }] }, documentContext(kapikoDoc)).filter(i => i.code === 'quality.artifact'), []);
});

test('stray-brace artifacts anywhere in a component are cleaned without a paid repair', async () => {
  const provider = new FakeProvider(req => {
    if (req.purpose === 'plan') return fakePlan(req);
    const s = kapikoScreen(screenIdOf(req));
    if (s.id === 'my-service-requests') s.children = [{ type: 'Table', id: 'requests', collection: 'service-requests', searchable: true, columns: [{ field: 'ref', label: 'Reference #},{' }, { field: 'status', label: 'Status' }] }];
    return s;
  });
  const job = await runToEnd(new Generator(new MemoryStore(), provider, cfg));
  assert.equal(provider.calls.filter(c => c.purpose === 'repair').length, 0);
  const table = job.document.screens.find((s: any) => s.id === 'my-service-requests').children[0];
  assert.equal(table.columns[0].label, 'Reference #');
  assert.equal(job.status, 'completed');
});

test('job totals equal the sum of usage rows when screens run in parallel (no lost updates)', async () => {
  class SlowStore extends MemoryStore { async getJob(id: string) { const j = await super.getJob(id); await new Promise(r => setTimeout(r, 2)); return j; } }
  const store = new SlowStore();
  const provider = new FakeProvider(async req => { await new Promise(r => setTimeout(r, 1)); return req.purpose === 'plan' ? fakePlan(req) : kapikoScreen(screenIdOf(req)); });
  const job = await runToEnd(new Generator(store, provider, cfg));
  const rows = store.usage.filter(u => u.job_id === job.id);
  assert.equal(rows.length, 13);
  assert.equal(job.input_tokens, rows.reduce((s, u) => s + u.input_tokens, 0));
  assert.ok(Math.abs(Number(job.cost_usd) - rows.reduce((s, u) => s + u.cost_usd, 0)) < 1e-9);
});

test('template-language conditionals (live SafeDrive run) are removed without a paid repair', async () => {
  const provider = new FakeProvider(req => {
    if (req.purpose === 'plan') return fakePlan(req);
    const s = kapikoScreen(screenIdOf(req));
    if (s.id === 'customer-profile') (s.children as any[])[1].items[0].value = '{{#if record.fromAdjuster}}Adjuster{{else}}You{{/if}}';
    return s;
  });
  const job = await runToEnd(new Generator(new MemoryStore(), provider, cfg));
  assert.equal(provider.calls.filter(c => c.purpose === 'repair').length, 0);
  assert.equal(job.status, 'completed');
  assert.ok(!JSON.stringify(job.document).includes('{{#if'));
});

test('IDIDI brief (UAT): exact 5 screens, standard sign-in/up allowed, no UAE PASS/OTP/eKYC/face templates', async () => {
  const brief = 'Create a Mobile app screen \n1) Welcome screen \n2) Standard Sign in Screen \n3) Standard Sign up screen\n4) Dashboard \n5) Income screen with Option for customer to update income details ';
  const p = parseBrief(brief)!;
  assert.deepEqual(p.screens.map(s => s.title), ['Welcome', 'Standard Sign In', 'Standard Sign Up', 'Dashboard', 'Income']);
  assert.ok(p.screens[4].requirement.includes('update income details'));
  const { allowedTemplates } = await import('@demo/schema');
  const allowed = allowedTemplates('mobile', brief);
  assert.ok(allowed.includes('sign-in') && allowed.includes('sign-up'));
  for (const t of ['uaepass-login', 'uaepass-ekyc', 'otp-entry', 'face-verification']) assert.ok(!allowed.includes(t), t);
  // A planner that still picks UAE PASS for "Standard Sign in" is overruled, and extra screens are ignored.
  const provider = new FakeProvider(req => {
    const input = JSON.parse(req.input);
    assert.ok(!JSON.stringify(input.templates).includes('uaepass'), 'UAE PASS not offered');
    return { theme: { primary: '#000000', secondary: '#111111', accent: '#222222' }, sampleFacts: [], shellKind: 'tabs', menu: [], collections: [],
      screens: [...input.screenList.map((s: any) => ({ id: s.id, title: 'Renamed ' + s.title, purpose: 'p', template: s.id === 'standard-sign-in' ? 'uaepass-login' : null, links: [], shell: 'hidden', mustInclude: [] })),
        { id: 'standard-sign-in', title: 'dup', purpose: 'x', template: null, links: [], shell: 'hidden', mustInclude: [] }] };
  });
  const { createPlan } = await import('../src/plan.ts');
  const { plan } = await createPlan(provider, { name: 'IDIDI BANK', channel: 'mobile' }, brief, { maxScreens: 40 });
  assert.equal(plan.screens.length, 5);
  assert.deepEqual(plan.screens.map(s => s.title), ['Welcome', 'Standard Sign In', 'Standard Sign Up', 'Dashboard', 'Income'], 'titles are the BA\'s, not the model\'s');
  assert.equal(plan.screens[1].template, null);
});

test('ordinary numbered requirements are not mistaken for a screen list', () => {
  assert.equal(parseBrief('Business rules:\n1. Users must log in\n2. Data must be encrypted\n3. Monthly reports'), null);
});

test('over-long plan strings are shortened instead of failing the job (benchmark: 4 of 12 plans failed)', async () => {
  const provider = new FakeProvider(req => {
    const plan = fakePlan(req) as any;
    plan.screens[0].mustInclude = ['a very long must include item that goes on and on beyond the forty eight character limit'];
    plan.screens[1].purpose = 'x'.repeat(600);
    return plan;
  });
  const { createPlan } = await import('../src/plan.ts');
  const { plan } = await createPlan(provider, { name: 'K', channel: 'mobile' }, kapikoBrief, { maxScreens: 40 });
  assert.ok(plan.screens[0].mustInclude![0].length <= 48 && plan.screens[0].mustInclude![0].endsWith('…'));
  assert.ok(plan.screens[1].purpose.length <= 400);
});
