// Demo quality rules found in UAT review (US-101 personal loan, US-102 maker-checker): each is deterministic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatters, type DemoDocument, type NodeT } from '@demo/schema';
import { ARCHETYPES, assemble, buildArchetypeScreen, normalizePlan, parseBrief, sanitizeContent, suggestionText, type Plan } from '../src/index.ts';

const basePlan = (): Plan => ({
  appName: 'Nexa', brandName: 'Nexa', channel: 'mobile', theme: { primary: '#123456', secondary: '#654321', accent: '#ABCDEF' },
  shell: { kind: 'tabs', brand: 'Nexa', showBack: true, items: [{ id: 'm1', label: 'Home', icon: 'home', screen: 'home' }, { id: 'm2', label: 'Loans', icon: 'list', screen: 'loans' }] },
  collections: [{ id: 'apps', label: 'Applications', key: 'ref', fields: [{ id: 'ref', label: 'Reference' }, { id: 'amount', label: 'Requested amount' }, { id: 'status', label: 'Status' }],
    rows: [{ ref: 'A1', amount: '180000', status: 'Submitted' }, { ref: 'A2', amount: '90000', status: 'Submitted' }, { ref: 'A3', amount: '50000', status: 'Approved' }] }],
  screens: ['home', 'apply', 'loans', 'detail', 'review', 'done'].map((id, i, all) => ({ id, title: id, requirement: id, purpose: id, template: null, links: all[i + 1] ? [all[i + 1]] : [all[0]], shell: 'default' as const, locked: false, archetype: 'custom', collection: 'apps' })),
  sampleFacts: [{ label: 'Customer', value: 'Sara' }], templates: [], globalContext: '', notes: [],
});
const build = (archetype: string, content: unknown, screenId = 'home', plan = basePlan()) => {
  const ctx = { plan, screen: { ...plan.screens.find(s => s.id === screenId)!, archetype }, channel: plan.channel, collection: plan.collections[0] };
  return buildArchetypeScreen(archetype, ARCHETYPES[archetype].content.parse(sanitizeContent(content, ctx)), ctx);
};
const all = (ns: NodeT[]): NodeT[] => ns.flatMap(n => [n, ...all((n.children as NodeT[]) ?? [])]);

test('document uploads get a designed upload screen with format hints, never fields for instructions', () => {
  const s = build('document-upload', { intro: 'Upload your salary certificate.', documents: [{ label: 'Salary certificate', hint: 'PDF, JPG or PNG, up to 5 MB', required: true }], primaryLabel: 'Continue', next: 'review' }, 'apply');
  const nodes = all(s.children as NodeT[]);
  assert.deepEqual(nodes.filter(n => n.type === 'Upload').map(n => n.hint), ['PDF, JPG or PNG, up to 5 MB']);
  assert.equal(nodes.filter(n => n.type === 'Input').length, 0);
  const form = build('form', { sections: [{ title: 'Upload', fields: [{ label: 'Certificate', kind: 'upload', required: true }, { label: 'File type', kind: 'text', required: false }, { label: 'Max size', kind: 'text', required: false }, { label: 'Monthly instalment', kind: 'currency', required: false }, { label: 'Verify upload', kind: 'toggle', required: false }] }], primaryLabel: 'Continue', next: 'review' }, 'apply');
  assert.deepEqual(all(form.children as NodeT[]).filter(n => ['Input', 'Toggle', 'Upload'].includes(n.type)).map(n => n.label), ['Certificate'], 'instructions, computed figures and checks are not inputs');
});

test('the planner routes upload steps and amount + tenure steps to their designed layouts, but keeps forms that only include an upload', () => {
  const p = basePlan();
  const raw = { theme: p.theme, sampleFacts: [], shellKind: 'tabs', menu: [], collections: [], brandName: 'Nexa',
    screens: [{ id: 'upload-salary-certificate', title: 'Upload Salary Certificate', purpose: 'Upload the certificate', archetype: 'form', collection: null, template: null, links: [], shell: 'default', mustInclude: [] },
      { id: 'income-update', title: 'Income Update', purpose: 'New salary, allowances and upload a salary certificate', archetype: 'form', collection: null, template: null, links: [], shell: 'default', mustInclude: [] },
      { id: 'loan-details', title: 'Loan Details', purpose: 'Choose the amount and tenure; see the monthly instalment', archetype: 'form', collection: null, template: null, links: [], shell: 'default', mustInclude: [] }] };
  const plan = normalizePlan(raw as any, { name: 'Nexa', channel: 'mobile' }, 'brief', null);
  assert.deepEqual(plan.screens.map(s => s.archetype), ['document-upload', 'form', 'loan-offer']);
});

test('the app menu lists destinations, never journey steps', () => {
  const p = basePlan();
  const raw = { theme: p.theme, sampleFacts: [], shellKind: 'tabs', collections: [], brandName: 'Nexa',
    menu: [{ label: 'Home', icon: 'home', screen: 'home' }, { label: 'Review', icon: 'check', screen: 'review' }, { label: 'Done', icon: 'check', screen: 'done' }, { label: 'Loans', icon: 'list', screen: 'loans' }],
    screens: [['home', 'dashboard'], ['review', 'review'], ['done', 'success'], ['loans', 'list']].map(([id, archetype]) => ({ id, title: id, purpose: id, archetype, collection: null, template: null, links: [], shell: 'default', mustInclude: [] })) };
  assert.deepEqual(normalizePlan(raw as any, { name: 'Nexa', channel: 'mobile' }, 'brief', null).shell.items.map(i => i.screen), ['home', 'loans']);
});

test('review screens never show a reference number before submission (a payment reference the user typed stays)', () => {
  const s = build('review', { intro: 'Check.', groups: [{ title: 'Loan', items: [{ label: 'Loan amount', value: 'AED 50,000' }, { label: 'Reference number', value: 'PL20 2611 2500 01' }, { label: 'Payment reference', value: 'Rent 1102' }] }], primaryLabel: 'Submit', next: 'done' }, 'review');
  const labels = all(s.children as NodeT[]).flatMap(n => ((n.items as { label: string }[]) ?? []).map(i => i.label));
  assert.deepEqual(labels, ['Loan amount', 'Payment reference']);
});

test('dashboard: entry-point promo, no quick actions repeating the menu, status counts taken from the records', () => {
  const s = build('dashboard', { greeting: 'Hi Sara', kpis: [{ label: 'Submitted', value: '9' }, { label: 'Approved', value: '7' }],
    promo: { title: 'Personal loan up to AED 500,000', text: 'Check eligibility in minutes.', cta: 'Apply now', target: 'apply', icon: 'credit-card' },
    quickActions: [{ label: 'Loans', icon: 'list', target: 'loans' }, { label: 'Details', icon: 'list', target: 'detail' }],
    chart: { title: 'By status', kind: 'bar', labels: ['Submitted', 'Approved'], values: [5, 5] } });
  const nodes = all(s.children as NodeT[]);
  assert.equal(nodes.find(n => n.type === 'Promo')?.title, 'Personal loan up to AED 500,000');
  assert.equal(nodes.find(n => n.type === 'QuickActions'), undefined, 'only one shortcut left after removing menu items: no quick actions row');
  assert.deepEqual(nodes.filter(n => n.type === 'Stat').map(n => n.value), ['2', '1']);
  assert.deepEqual(nodes.find(n => n.type === 'Chart')?.values, [2, 1]);
});

test('the review and success screens show the calculator figures, including the total repayable', () => {
  const plan = basePlan();
  plan.screens = plan.screens.map(s => (s.id === 'done' ? { ...s, archetype: 'success' } : s));
  const screen = (id: string, children: NodeT[]) => ({ id, title: id, shell: 'default' as const, children });
  const rows = (items: [string, string][]): NodeT => ({ type: 'RecordFields', id: 'rf', items: items.map(([label, value]) => ({ label, value })) });
  const { document } = assemble(plan, [
    screen('home', [{ type: 'Text', id: 't', text: 'Home' }]),
    screen('apply', [{ type: 'EmiCalculator', id: 'calc', title: 'Loan', stateKey: 'loan', minAmount: 10000, maxAmount: 500000, defaultAmount: 50000, tenures: [12, 24, 36], ratePercent: 7.5 }]),
    screen('loans', [{ type: 'Text', id: 't', text: 'Loans' }]), screen('detail', [{ type: 'Text', id: 't', text: 'Detail' }]),
    screen('review', [rows([['Loan amount', 'AED 150,000'], ['Total repayable', 'AED 163,138.40']])]),
    screen('done', [rows([['Loan amount', 'AED 150,000'], ['Tenure', '36 months']])]),
  ]);
  const text = (id: string) => JSON.stringify(document.screens.find(s => s.id === id)!.children);
  assert.match(text('review'), /state\.loan\.totalText/); assert.match(text('review'), /state\.loan\.amountText/);
  assert.match(text('done'), /state\.loan\.amountText/); assert.match(text('done'), /state\.loan\.tenureText/);
});

test('sample data rows name their columns: a merged value cannot shift the others; record values keep AED formatting', () => {
  const p = basePlan();
  const raw = { theme: p.theme, sampleFacts: [], shellKind: 'tabs', menu: [], brandName: 'Nexa', screens: [{ id: 'home', title: 'Home', purpose: 'Home', archetype: 'dashboard', collection: 'apps', template: null, links: [], shell: 'default', mustInclude: [] }],
    collections: [{ id: 'apps', label: 'Applications', key: 'ref', fields: [{ id: 'ref', label: 'Reference' }, { id: 'salary', label: 'Salary' }, { id: 'employer', label: 'Employer' }, { id: 'score', label: 'Score' }],
      rows: [[{ field: 'ref', value: 'A1' }, { field: 'salary', value: 'AED 18,500 - Emirates' }, { field: 'score', value: '790' }], [{ field: 'ref', value: 'A2' }, { field: 'employer', value: 'ADNOC' }]] }] };
  const plan = normalizePlan(raw as any, { name: 'Nexa', channel: 'mobile' }, 'brief', null);
  assert.deepEqual(plan.collections[0].rows[0], { ref: 'A1', salary: 'AED 18,500 - Emirates', employer: '', score: '790' });
  assert.equal(formatters.aed('180,000'), 'AED 180,000.00');
});

test('an AI screen suggestion becomes a numbered screen list that the brief parser keeps exactly', () => {
  const text = suggestionText({ journey: 'Home -> apply -> done', gaps: ['Which interest rate?'], screens: [
    { title: 'Home', purpose: 'Dashboard with the loan offer.', details: ['Balance', 'Loan promo'], criteria: [] },
    { title: 'Loan Calculator', purpose: 'Amount and tenure.', details: ['Amount slider', 'Monthly instalment'], criteria: ['US-1:ac-1'] },
    { title: 'Application Submitted', purpose: 'Reference and next steps.', details: ['Reference number'], criteria: ['US-1:ac-2'] }] }, [{ id: 'US-1:ac-1' }, { id: 'US-1:ac-2' }]);
  assert.match(text, /Demonstrates AC1/);
  const parsed = parseBrief('Demo request.\n\nAcceptance criteria:\nAC1. one\nAC2. two\n\n' + text)!;
  assert.deepEqual(parsed.screens.map(s => s.title), ['Home', 'Loan Calculator', 'Application Submitted']);
  assert.match(parsed.screens[1].requirement, /Monthly instalment/);
  assert.match(parsed.globalContext, /Which interest rate/, 'open questions stay context, not screens');
});

void (null as unknown as DemoDocument);

test('summaries never repeat a password, PIN or one-time code; checks screens show each check and a failure message', () => {
  const r = build('review', { intro: 'Check.', groups: [{ title: 'You', items: [{ label: 'Customer name', value: 'Aisha' }, { label: 'Password', value: 'At least 8 characters' }, { label: 'OTP', value: '123456' }] }], primaryLabel: 'Submit', next: 'done' }, 'review');
  assert.deepEqual(all(r.children as NodeT[]).flatMap(n => ((n.items as { label: string }[]) ?? []).map(i => i.label)), ['Customer name']);
  const a = build('assessment', { checks: [{ label: 'Duplicate registration check', detail: 'No account for 784-1985-7151234-5' }, { label: 'Eligibility check', detail: 'Eligible for housing finance' }],
    failure: { check: 'Duplicate registration check', message: 'An account already exists for this Emirates ID.' }, primaryLabel: 'Run checks', next: 'done' }, 'review');
  const nodes = all(a.children as NodeT[]);
  assert.equal((nodes.find(n => n.type === 'StatusTimeline')!.steps as unknown[]).length, 2);
  assert.match(String(nodes.find(n => n.type === 'Notice')!.body), /already exists/);
  const bar = nodes.find(n => n.type === 'ActionBar') as any;
  assert.deepEqual(bar.primary.actions.map((x: any) => x.type), ['simulate', 'simulate', 'navigate']);
  assert.ok(bar.secondary.actions.some((x: any) => x.type === 'simulate' && x.outcome === 'failure'));
});

test('over-long AI text is cut at a sentence or word, never mid-word; one menu destination means no tab bar', async () => {
  const { shorten } = await import('@demo/schema');
  assert.equal(shorten('Please have your details ready. Your information will be validated for eligibility and duplicate registration.', 60), 'Please have your details ready.');
  const cut = shorten('Your information will be validated for eligibility and duplicate registration checks', 50);
  assert.ok(cut.endsWith('…') && !/regi…$/.test(cut) && cut.length <= 50, cut);
  const p = basePlan();
  const raw = { theme: p.theme, sampleFacts: [], shellKind: 'tabs', collections: [], brandName: 'Nexa', menu: [{ label: 'Profile', icon: 'user', screen: 'profile' }, { label: 'Form', icon: 'list', screen: 'form' }],
    screens: [['welcome', 'welcome'], ['form', 'form'], ['profile', 'profile']].map(([id, archetype]) => ({ id, title: id, purpose: id, archetype, collection: null, template: null, links: [], shell: 'default', mustInclude: [] })) };
  const plan = normalizePlan(raw as any, { name: 'Nexa', channel: 'mobile' }, 'brief', null);
  assert.equal(plan.shell.kind, 'none'); assert.deepEqual(plan.shell.items, []);
});
