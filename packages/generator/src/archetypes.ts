// Screen archetypes: the layout of every standard screen type is fixed and designed here.
// The AI only fills a small content contract; the builder turns it into the screen.
// Standard mobile anatomy is guaranteed by construction: a title, the content, ONE primary
// action at the end (secondary as a quieter action), navigation via tab bar/back arrow,
// success only on success screens.
import { z } from 'zod';
import { ScreenRef, Icon, type NodeT, type Action, type Screen, type Collection } from '@demo/schema';
import type { Plan, PlanScreen } from './plan.ts';
import { NAV_LABEL } from './uxLint.ts';

export type Channel = 'mobile' | 'portal';
export type BuildCtx = { plan: Plan; screen: PlanScreen; channel: Channel; collection?: Collection };
export type ArchetypeDef = {
  id: string; label: string; channels: Channel[]; description: string;
  shell: (ch: Channel) => 'default' | 'hidden';
  content: z.ZodObject<any>;
  build: (c: any, ctx: BuildCtx) => NodeT[];
  defaults: (ctx: BuildCtx) => any;
};

const Field = z.string().min(1).meta({ ref: 'field' });          // a field of the screen's data collection
const Target = ScreenRef.optional();
const S = (max: number) => z.string().min(1).max(max);
const FieldSpec = z.object({
  label: S(60), kind: z.enum(['text', 'email', 'phone', 'number', 'currency', 'date', 'password', 'otp', 'select', 'radio', 'checkbox', 'upload', 'toggle']),
  options: z.array(S(40)).max(12).optional(), required: z.boolean(), placeholder: z.string().max(60).optional(),
});
const Pair = z.object({ label: S(40), value: S(80) });
const Act = z.object({ label: S(28), target: Target });

// ---------- helpers ----------
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
const camel = (v: string) => { const p = v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean); const s = p.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join(''); return /^[a-z]/.test(s) ? s.slice(0, 40) : 'f' + s.slice(0, 39); };
export const fieldKey = (screenId: string, label: string) => camel(screenId) + '.' + camel(label);
const nav = (t?: string): Action[] => (t ? [{ type: 'navigate', screen: t }] : []);
function ids() { const used = new Set<string>(); return (base: string) => { let id = slug(base), n = 2; while (used.has(id)) id = slug(base) + '-' + n++; used.add(id); return id; }; }
function titleBlock(ctx: BuildCtx, id: (b: string) => string, headline?: string, intro?: string): NodeT[] {
  // Mobile focused flows have no app bar title, so the screen carries a heading. Elsewhere the
  // app bar / portal page header already shows the title; only the intro text is added.
  const hidden = ctx.channel === 'mobile' && ARCHETYPES[ctx.screen.archetype ?? 'custom']?.shell('mobile') === 'hidden';
  const out: NodeT[] = [];
  if (hidden) out.push({ type: 'Heading', id: id('title'), text: (headline || ctx.screen.title).slice(0, 140), level: '1' });
  if (intro) out.push({ type: 'Text', id: id('intro'), text: intro.slice(0, 600), tone: 'muted' });
  return out;
}
function fieldNode(f: z.infer<typeof FieldSpec>, screenId: string, id: (b: string) => string): NodeT {
  const base = { id: id(f.label), field: fieldKey(screenId, f.label), label: f.label, required: f.required };
  const options = f.options?.length ? f.options : ['Option 1', 'Option 2'];
  switch (f.kind) {
    case 'select': return { type: 'Select', ...base, options };
    case 'radio': return { type: 'Radio', ...base, options };
    case 'checkbox': return { type: 'Checkbox', ...base, label: f.label };
    case 'upload': return { type: 'Upload', ...base };
    case 'toggle': return { type: 'Toggle', id: base.id, field: base.field, label: f.label };
    default: return { type: 'Input', ...base, inputType: f.kind, ...(f.placeholder ? { placeholder: f.placeholder } : {}) };
  }
}
function actionBar(id: (b: string) => string, primary: { label: string; actions: Action[] }, secondary?: { label: string; actions: Action[] }): NodeT {
  // The tab bar and back arrow already navigate: a secondary "Back to dashboard" becomes "Cancel".
  if (secondary && NAV_LABEL.test(secondary.label.trim())) secondary = { ...secondary, label: 'Cancel' };
  return { type: 'ActionBar', id: id('actions'), primary, ...(secondary ? { secondary } : {}) };
}
const backOr = (t?: string): Action[] => (t ? nav(t) : [{ type: 'back' }]);
const firstLink = (ctx: BuildCtx) => ctx.screen.links[0];

const personName = (ctx: BuildCtx) => ctx.plan.sampleFacts?.find(f => /name|customer|account holder|member|patient|employee/i.test(f.label) && !/company|employer|bank|provider|number|id\b/i.test(f.label))?.value.slice(0, 60) ?? 'Customer';
/** Current values card, minus rows that merely repeat a form field's label (the AI sometimes lists the fields). */
function currentCard(c: any, id: (b: string) => string): NodeT[] {
  if (!c.current) return [];
  const words = (v: string) => v.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(w => w.length > 3);
  const fieldWords = new Set(c.sections.flatMap((s: any) => s.fields.flatMap((f: any) => words(f.label))));
  const items = c.current.items.filter((it: any) => { const w = words(it.label); return !(w.length && w.every((x: string) => fieldWords.has(x) || /selection|input|dropdown|field/.test(x))); });
  return items.length ? [{ type: 'Card', id: id('current'), title: c.current.title, children: [{ type: 'RecordFields', id: id('current-values'), items }] } as NodeT] : [];
}

// ---------- archetypes ----------
const defs: ArchetypeDef[] = [];
const def = (d: ArchetypeDef) => defs.push(d);
const mobileHidden = (ch: Channel) => (ch === 'mobile' ? 'hidden' : 'default') as 'hidden' | 'default';

def({ id: 'welcome', label: 'Welcome / onboarding', channels: ['mobile', 'portal'], shell: mobileHidden,
  description: 'First screen: brand, value proposition, up to 3 highlights, primary + secondary entry actions.',
  content: z.object({ headline: S(60), subtitle: S(160), highlights: z.array(z.object({ icon: Icon, title: S(40), text: S(100) })).max(3), primary: Act, secondary: Act.optional() }),
  build: (c, ctx) => { const id = ids(); return [
    { type: 'Hero', id: id('hero'), title: c.headline, subtitle: c.subtitle, showLogo: true, illustration: 'none' },
    ...(c.highlights?.length ? [{ type: 'FeatureList', id: id('highlights'), items: c.highlights.map((h: any) => ({ icon: h.icon, title: h.title, text: h.text })) } as NodeT] : []),
    actionBar(id, { label: c.primary.label, actions: nav(c.primary.target ?? firstLink(ctx)) }, c.secondary?.target ? { label: c.secondary.label, actions: nav(c.secondary.target) } : undefined)]; },
  defaults: ctx => ({ headline: 'Welcome to ' + ctx.plan.brandName, subtitle: ctx.screen.purpose.slice(0, 160), highlights: [], primary: { label: 'Get started', target: firstLink(ctx) } }) });

def({ id: 'sign-in', label: 'Sign in', channels: ['mobile', 'portal'], shell: mobileHidden,
  description: 'Standard sign in: email or mobile, password, remember me, forgot password; links to sign up.',
  content: z.object({ headline: S(60), subtitle: S(120), next: ScreenRef, signUpTarget: Target }),
  build: (c, ctx) => { const id = ids(); return [
    { type: 'Hero', id: id('hero'), title: c.headline, subtitle: c.subtitle, showLogo: true, illustration: 'none' },
    { type: 'Template', id: id('signin'), template: 'sign-in', next: c.next, ...(c.signUpTarget ? { alt: c.signUpTarget } : {}) }]; },
  defaults: ctx => ({ headline: 'Welcome back', subtitle: 'Sign in to continue', next: firstLink(ctx) ?? ctx.plan.screens[0].id }) });

def({ id: 'sign-up', label: 'Registration', channels: ['mobile', 'portal'], shell: mobileHidden,
  description: 'Registration form with the fields the brief asks for, terms consent and a link to sign in.',
  content: z.object({ headline: S(60), subtitle: S(120), fields: z.array(FieldSpec).min(2).max(10), termsLabel: S(120), primaryLabel: S(28), next: ScreenRef, signInTarget: Target }),
  build: (c, ctx) => { const id = ids(); return [
    ...titleBlock(ctx, id, c.headline, c.subtitle),
    { type: 'Form', id: id('form'), children: [...c.fields.filter((f: any) => !(f.kind === 'checkbox' && /terms|conditions|privacy/i.test(f.label))).map((f: any) => fieldNode(f, ctx.screen.id, id)),
      { type: 'Checkbox', id: id('terms'), field: fieldKey(ctx.screen.id, 'terms'), label: c.termsLabel, required: true },
      actionBar(id, { label: c.primaryLabel, actions: [{ type: 'submit', validate: true }, ...nav(c.next)] })] },
    ...(c.signInTarget ? [{ type: 'Stack', id: id('signin'), direction: 'horizontal', gap: 'sm', align: 'center', children: [
      { type: 'Text', id: id('have'), text: 'Already have an account?', tone: 'muted' }, { type: 'Button', id: id('go-signin'), label: 'Sign in', variant: 'link', actions: nav(c.signInTarget) }] } as NodeT] : [])]; },
  defaults: ctx => ({ headline: 'Create your account', subtitle: 'It only takes a minute', termsLabel: 'I agree to the terms and conditions', primaryLabel: 'Continue', next: firstLink(ctx) ?? ctx.plan.screens[0].id,
    fields: [{ label: 'Full name', kind: 'text', required: true }, { label: 'Email address', kind: 'email', required: true }, { label: 'Mobile number', kind: 'phone', required: true }, { label: 'Password', kind: 'password', required: true }] }) });

def({ id: 'otp', label: 'One-time code', channels: ['mobile', 'portal'], shell: mobileHidden,
  description: 'Enter a one-time code (simulated) with resend.',
  content: z.object({ headline: S(60), subtitle: S(160), next: ScreenRef }),
  build: (c, ctx) => { const id = ids(); return [...titleBlock(ctx, id, c.headline, c.subtitle), { type: 'Template', id: id('otp'), template: 'otp-entry', next: c.next }]; },
  defaults: ctx => ({ headline: 'Verify your number', subtitle: 'Enter the 6-digit code we sent to your mobile (simulated).', next: firstLink(ctx) ?? ctx.plan.screens[0].id }) });

def({ id: 'verification', label: 'Verification step', channels: ['mobile', 'portal'], shell: mobileHidden,
  description: 'Identity/eKYC/face/document verification step (simulated): progress, what will be checked, consent, continue.',
  content: z.object({ headline: S(60), subtitle: S(160), method: z.enum(['uaepass-ekyc', 'face', 'document-upload', 'generic']), checklist: z.array(z.object({ label: S(40), detail: S(80).optional(), state: z.enum(['done', 'current', 'upcoming']) })).max(6), consentLabel: S(160).optional(), primaryLabel: S(28), next: ScreenRef }),
  build: (c, ctx) => {
    const id = ids();
    const template = c.method === 'uaepass-ekyc' ? 'uaepass-ekyc' : c.method === 'face' ? 'face-verification' : c.method === 'document-upload' ? 'document-upload' : null;
    const allowed = template && (ctx.plan.templates ?? []).includes(template);
    const head = [...titleBlock(ctx, id, c.headline, c.subtitle), ...(c.checklist?.length >= 2 ? [{ type: 'StatusTimeline', id: id('checklist'), steps: c.checklist } as NodeT] : [])];
    if (allowed) return [...head, { type: 'Template', id: id('step'), template, next: c.next }];
    return [...head, { type: 'Notice', id: id('sim'), tone: 'info', title: 'Simulated verification', body: 'No external service is contacted in this demo.' },
      { type: 'Form', id: id('form'), children: [
        ...(c.consentLabel ? [{ type: 'Checkbox', id: id('consent'), field: fieldKey(ctx.screen.id, 'consent'), label: c.consentLabel, required: true } as NodeT] : []),
        actionBar(id, { label: c.primaryLabel, actions: [{ type: 'submit', validate: true }, { type: 'simulate', label: 'Verifying (simulated)', durationMs: 1200, outcome: 'success' }, ...nav(c.next)] })] }];
  },
  defaults: ctx => ({ headline: ctx.screen.title, subtitle: ctx.screen.purpose.slice(0, 160), method: 'generic', checklist: [], primaryLabel: 'Continue', next: firstLink(ctx) ?? ctx.plan.screens[0].id }) });

def({ id: 'dashboard', label: 'Home / dashboard', channels: ['mobile', 'portal'], shell: () => 'default',
  description: 'Home: greeting, main balance or KPIs, quick actions to key screens, recent activity; portal adds a chart and a table.',
  content: z.object({ greeting: S(60), subtitle: S(120).optional(),
    balance: z.object({ label: S(40), amount: S(30), caption: S(60).optional(), accountNumber: z.string().max(30).optional() }).optional(),
    kpis: z.array(z.object({ label: S(40), value: S(24), delta: z.string().max(24).optional() })).max(4),
    quickActions: z.array(z.object({ label: S(20), icon: Icon, target: Target })).max(4),
    recent: z.object({ title: S(40), items: z.array(z.object({ title: S(50), subtitle: S(40), amount: z.string().max(24), direction: z.enum(['in', 'out', 'neutral']), icon: Icon })).min(1).max(6) }).optional(),
    chart: z.object({ title: S(60), kind: z.enum(['bar', 'line']), labels: z.array(S(12)).min(2).max(12), values: z.array(z.number().min(0)).min(2).max(12) }).optional(),
    table: z.object({ title: S(60), columns: z.array(Field).min(1).max(6), detailTarget: Target }).optional() }),
  build: (c, ctx) => {
    const id = ids(), out: NodeT[] = [];
    if (ctx.channel === 'mobile') out.push({ type: 'Heading', id: id('greeting'), text: c.greeting, level: '2' });
    else if (c.subtitle) out.push({ type: 'Text', id: id('intro'), text: c.subtitle, tone: 'muted' });
    if (c.balance) out.push({ type: 'BalanceCard', id: id('balance'), label: c.balance.label, amount: c.balance.amount, ...(c.balance.caption ? { caption: c.balance.caption } : {}), ...(c.balance.accountNumber ? { accountNumber: c.balance.accountNumber, accountName: ctx.plan.sampleFacts?.[0]?.value?.slice(0, 40) } : {}) });
    if (c.kpis?.length) out.push({ type: 'Grid', id: id('kpis'), columns: String(Math.min(4, Math.max(2, c.kpis.length))), gap: 'md', children: c.kpis.map((k: any) => ({ type: 'Stat', id: id(k.label), label: k.label, value: k.value, ...(k.delta ? { delta: k.delta } : {}) })) });
    const qa = (c.quickActions ?? []).filter((q: any) => q.target !== ctx.screen.id);
    if (qa.length >= 2) out.push({ type: 'QuickActions', id: id('quick'), title: 'Quick actions', items: qa.map((q: any) => ({ label: q.label, icon: q.icon, actions: q.target ? nav(q.target) : [{ type: 'toast', message: q.label + ' is simulated in this demo' }] })) });
    if (c.chart) out.push({ type: 'Chart', id: id('chart'), ...c.chart });
    if (c.table && ctx.collection) out.push({ type: 'Table', id: id('table'), collection: ctx.collection.id, title: c.table.title, searchable: false, columns: c.table.columns.map((f: string) => ({ field: f, label: ctx.collection!.fields.find(x => x.id === f)?.label ?? f, ...formatFor(f) })), ...(c.table.detailTarget ? { rowAction: { label: 'View', screen: c.table.detailTarget } } : {}) });
    if (c.recent) out.push({ type: 'TransactionList', id: id('recent'), title: c.recent.title, items: c.recent.items });
    return out;
  },
  defaults: ctx => ({ greeting: 'Welcome back', subtitle: ctx.screen.purpose.slice(0, 120),
    kpis: ctx.collection ? [{ label: ctx.collection.label.slice(0, 40), value: String(ctx.collection.rows.length) }, { label: 'This week', value: String(Math.max(1, Math.ceil(ctx.collection.rows.length / 2))) }] : [],
    ...(ctx.collection ? { table: { title: ctx.collection.label.slice(0, 60), columns: ctx.collection.fields.slice(0, 5).map(f => f.id) } } : {}), quickActions: ctx.screen.links.slice(0, 4).map(l => ({ label: ctx.plan.screens.find(s => s.id === l)?.title.slice(0, 20) ?? 'Open', icon: 'circle', target: l })) }) });

def({ id: 'form', label: 'Data entry form', channels: ['mobile', 'portal'], shell: () => 'default',
  description: 'Update/apply/request/transfer/booking form: optional current values, grouped fields, submit + cancel.',
  content: z.object({ intro: S(200).optional(), current: z.object({ title: S(40), items: z.array(Pair).min(1).max(8) }).optional().describe('Only data the customer ALREADY has (e.g. current salary, available balance) with real values; never the form fields or instructions. Omit when not needed.'),
    sections: z.array(z.object({ title: z.string().max(40).optional(), fields: z.array(FieldSpec).min(1).max(8) })).min(1).max(4),
    primaryLabel: S(28), next: ScreenRef, cancel: Act.optional() }),
  build: (c, ctx) => { const id = ids(); return [
    ...titleBlock(ctx, id, ctx.screen.title, c.intro),
    ...currentCard(c, id),
    { type: 'Form', id: id('form'), children: [
      ...c.sections.flatMap((s: any) => s.title ? [{ type: 'Section', id: id(s.title), title: s.title, children: s.fields.map((f: any) => fieldNode(f, ctx.screen.id, id)) } as NodeT] : s.fields.map((f: any) => fieldNode(f, ctx.screen.id, id))),
      actionBar(id, { label: c.primaryLabel, actions: [{ type: 'submit', validate: true }, ...nav(c.next)] }, { label: c.cancel?.label ?? 'Cancel', actions: backOr(c.cancel?.target) })] }]; },
  defaults: ctx => ({ sections: [{ fields: [{ label: 'Details', kind: 'text', required: true }] }], primaryLabel: 'Continue', next: firstLink(ctx) ?? ctx.plan.screens[0].id }) });

def({ id: 'review', label: 'Review & confirm', channels: ['mobile', 'portal'], shell: () => 'default',
  description: 'Summary of what the user entered before submitting; consent; confirm + edit.',
  content: z.object({ intro: S(200), groups: z.array(z.object({ title: S(40), items: z.array(Pair).min(1).max(8) })).min(1).max(3), consentLabel: S(160).optional(), primaryLabel: S(28), next: ScreenRef, editTarget: Target }),
  build: (c, ctx) => { const id = ids(); return [
    ...titleBlock(ctx, id, ctx.screen.title, c.intro),
    ...c.groups.map((g: any) => ({ type: 'Card', id: id(g.title), title: g.title, children: [{ type: 'RecordFields', id: id(g.title + '-items'), items: g.items }] }) as NodeT),
    { type: 'Form', id: id('form'), children: [
      ...(c.consentLabel ? [{ type: 'Checkbox', id: id('consent'), field: fieldKey(ctx.screen.id, 'consent'), label: c.consentLabel, required: true } as NodeT] : []),
      actionBar(id, { label: c.primaryLabel, actions: [{ type: 'submit', validate: true }, { type: 'simulate', label: 'Submitting', durationMs: 900, outcome: 'success' }, ...nav(c.next)] }, { label: 'Edit details', actions: backOr(c.editTarget) })] }]; },
  defaults: ctx => ({ intro: 'Check the details before you confirm.', groups: [{ title: 'Summary', items: [{ label: 'Status', value: 'Ready to submit' }] }], primaryLabel: 'Confirm', next: firstLink(ctx) ?? ctx.plan.screens[0].id }) });

def({ id: 'success', label: 'Success / confirmation', channels: ['mobile', 'portal'], shell: mobileHidden,
  description: 'Outcome after a submission: success message, reference details, next actions.',
  content: z.object({ headline: S(60), message: S(200), details: z.array(Pair).max(6), primary: Act, secondary: Act.optional() }),
  build: (c, ctx) => { const id = ids(); return [
    { type: 'Hero', id: id('hero'), title: c.headline, subtitle: c.message, showLogo: false, illustration: 'success' },
    ...(c.details?.length ? [{ type: 'RecordFields', id: id('details'), items: c.details } as NodeT] : []),
    actionBar(id, { label: c.primary.label, actions: nav(c.primary.target ?? firstLink(ctx) ?? ctx.plan.screens.find(x => x.archetype === 'dashboard')?.id) }, c.secondary?.target ? { label: c.secondary.label, actions: nav(c.secondary.target) } : undefined)]; },
  defaults: ctx => ({ headline: 'All done', message: ctx.screen.purpose.slice(0, 200), details: [], primary: { label: 'Done', target: firstLink(ctx) } }) });

def({ id: 'list', label: 'List / records / history', channels: ['mobile', 'portal'], shell: () => 'default',
  description: 'Browse records from the screen\'s data collection (requests, transactions, applications, appointments); open a details screen; optional create action.',
  content: z.object({ intro: S(160).optional(), titleField: Field, subtitleField: Field.optional(), statusField: Field.optional(), columns: z.array(Field).min(1).max(7), searchable: z.boolean(), filterField: Field.optional(), detailTarget: Target, create: Act.optional() }),
  build: (c, ctx) => {
    const id = ids(), col = ctx.collection; if (!col) return [{ type: 'Notice', id: id('empty'), tone: 'info', title: 'No records yet' }];
    const out: NodeT[] = [...titleBlock(ctx, id, ctx.screen.title, c.intro)];
    if (ctx.channel === 'mobile') out.push({ type: 'List', id: id('list'), collection: col.id, titleField: c.titleField, ...(c.subtitleField ? { subtitleField: c.subtitleField } : {}), ...(c.statusField ? { badgeField: c.statusField } : {}), ...(c.detailTarget ? { itemAction: { screen: c.detailTarget } } : {}) });
    else out.push({ type: 'Table', id: id('table'), collection: col.id, searchable: c.searchable, ...(c.filterField ? { filterField: c.filterField } : {}), exportCsv: true,
      columns: c.columns.map((f: string) => ({ field: f, label: col.fields.find(x => x.id === f)?.label ?? f, ...formatFor(f, c.statusField) })), ...(c.detailTarget ? { rowAction: { label: 'View', screen: c.detailTarget } } : {}) });
    if (c.create) out.push(actionBar(id, { label: c.create.label, actions: nav(c.create.target) }));
    return out;
  },
  defaults: ctx => { const f = ctx.collection?.fields.map(x => x.id) ?? ['name']; return { titleField: f[0], subtitleField: f[1], columns: f.slice(0, 5), searchable: true, detailTarget: firstLink(ctx) }; } });

def({ id: 'detail', label: 'Record details', channels: ['mobile', 'portal'], shell: () => 'default',
  description: 'Details of the record opened from a list: grouped fields, status timeline, actions.',
  content: z.object({ intro: S(160).optional(), groups: z.array(z.object({ title: S(40), fields: z.array(Field).min(1).max(8) })).min(1).max(3), timeline: z.array(z.object({ label: S(40), detail: S(60).optional(), state: z.enum(['done', 'current', 'upcoming']) })).max(6), primary: Act.optional(), secondary: Act.optional() }),
  build: (c, ctx) => {
    const id = ids(), col = ctx.collection, label = (f: string) => col?.fields.find(x => x.id === f)?.label ?? f;
    const cards = c.groups.map((g: any) => ({ type: 'Card', id: id(g.title), title: g.title, children: [{ type: 'RecordFields', id: id(g.title + '-fields'), items: g.fields.map((f: string) => ({ label: label(f), value: '{{record.' + f + '}}' })) }] }) as NodeT);
    return [...titleBlock(ctx, id, ctx.screen.title, c.intro),
      ...(ctx.channel === 'portal' && cards.length > 1 ? [{ type: 'Grid', id: id('cards'), columns: String(Math.min(3, cards.length)), gap: 'md', children: cards } as NodeT] : cards),
      ...(c.timeline?.length >= 2 ? [{ type: 'StatusTimeline', id: id('timeline'), title: 'Progress', steps: c.timeline } as NodeT] : []),
      ...(c.primary ? [actionBar(id, { label: c.primary.label, actions: c.primary.target ? [{ type: 'navigate', screen: c.primary.target, passRecord: true }] : [{ type: 'toast', message: c.primary.label + ' (simulated)' }] }, c.secondary ? { label: c.secondary.label, actions: c.secondary.target ? [{ type: 'navigate', screen: c.secondary.target, passRecord: true }] : [{ type: 'back' }] } : undefined)] : [])];
  },
  defaults: ctx => ({ groups: [{ title: 'Details', fields: ctx.collection?.fields.slice(0, 6).map(f => f.id) ?? [] }], timeline: [] }) });

def({ id: 'profile', label: 'Profile / settings', channels: ['mobile', 'portal'], shell: () => 'default',
  description: 'Profile header and grouped settings rows (personal details, security, notifications, help), sign out.',
  content: z.object({ name: S(60).describe("The customer's full name from sampleFacts"), subtitle: S(80).optional(), badge: z.string().max(24).optional(), sections: z.array(z.object({ title: S(40), items: z.array(z.object({ label: S(40), value: z.string().max(40).optional(), icon: Icon, target: Target })).min(1).max(6) })).min(1).max(3), signOutTarget: Target }),
  build: (c, ctx) => { const id = ids(); return [
    { type: 'ProfileHeader', id: id('header'), name: /^[a-z0-9-]+$/.test(c.name) || ctx.plan.screens.some(x => x.id === c.name) ? personName(ctx) : c.name, ...(c.subtitle ? { subtitle: c.subtitle } : {}), ...(c.badge ? { badge: c.badge } : {}) },
    ...c.sections.map((s: any) => ({ ...s, items: s.items.filter((it: any) => !NAV_LABEL.test(it.label.trim())) })).filter((s: any) => s.items.length).map((s: any) => ({ type: 'MenuList', id: id(s.title), title: s.title, items: s.items.map((it: any) => ({ label: it.label, icon: it.icon, ...(it.value ? { value: it.value } : {}), actions: it.target && it.target !== ctx.screen.id ? nav(it.target) : [{ type: 'toast', message: it.label + ' is simulated in this demo' }] })) }) as NodeT),
    ...(c.signOutTarget ? [{ type: 'MenuList', id: id('signout'), items: [{ label: 'Sign out', icon: 'log-out', danger: true, actions: nav(c.signOutTarget) }] } as NodeT] : [])]; },
  defaults: ctx => ({ name: ctx.plan.sampleFacts?.[0]?.value ?? 'Customer', sections: [{ title: 'Account', items: [{ label: 'Personal details', icon: 'user' }, { label: 'Security', icon: 'lock' }, { label: 'Notifications', icon: 'bell' }] }] }) });

def({ id: 'info', label: 'Information list', channels: ['mobile', 'portal'], shell: () => 'default',
  description: 'Notifications, messages, help/FAQ, offers or static information as icon rows; optional action.',
  content: z.object({ intro: S(200).optional(), items: z.array(z.object({ icon: Icon, title: S(60), text: S(160), meta: z.string().max(24).optional() })).min(1).max(10), primary: Act.optional() }),
  build: (c, ctx) => { const id = ids(); return [...titleBlock(ctx, id, ctx.screen.title, c.intro), { type: 'FeatureList', id: id('items'), items: c.items },
    ...(c.primary ? [actionBar(id, { label: c.primary.label, actions: c.primary.target ? nav(c.primary.target) : [{ type: 'toast', message: c.primary.label + ' (simulated)' }] })] : [])]; },
  defaults: ctx => ({ items: [{ icon: 'help', title: ctx.screen.title, text: ctx.screen.purpose.slice(0, 160) }] }) });

def({ id: 'approval', label: 'Review & decide (maker/checker)', channels: ['portal', 'mobile'], shell: () => 'default',
  description: 'Staff decision on the selected record: record summary, decision options, comment; the record status updates.',
  content: z.object({ intro: S(160).optional(), summaryFields: z.array(Field).min(1).max(8), decisionLabel: S(40), options: z.array(S(30)).min(2).max(4), commentLabel: S(40), primaryLabel: S(28), resultStatus: S(30), next: ScreenRef }),
  build: (c, ctx) => { const id = ids(), label = (f: string) => ctx.collection?.fields.find(x => x.id === f)?.label ?? f; return [
    ...titleBlock(ctx, id, ctx.screen.title, c.intro),
    { type: 'Card', id: id('summary'), title: 'Summary', children: [{ type: 'RecordFields', id: id('summary-fields'), items: c.summaryFields.map((f: string) => ({ label: label(f), value: '{{record.' + f + '}}' })) }] },
    { type: 'Form', id: id('form'), title: 'Decision', children: [
      { type: 'Radio', id: id('decision'), field: fieldKey(ctx.screen.id, 'decision'), label: c.decisionLabel, required: true, options: c.options },
      { type: 'Input', id: id('comment'), field: fieldKey(ctx.screen.id, 'comment'), label: c.commentLabel, inputType: 'text', required: true },
      actionBar(id, { label: c.primaryLabel, actions: [{ type: 'submit', validate: true }, { type: 'updateRecord', field: ctx.collection?.fields.find(f => /status/i.test(f.id))?.id ?? 'status', value: c.resultStatus }, { type: 'toast', message: 'Decision recorded' }, ...nav(c.next)] }, { label: 'Cancel', actions: [{ type: 'back' }] })] }]; },
  defaults: ctx => ({ summaryFields: ctx.collection?.fields.slice(0, 5).map(f => f.id) ?? [], decisionLabel: 'Decision', options: ['Approve', 'Reject'], commentLabel: 'Comments', primaryLabel: 'Submit decision', resultStatus: 'Reviewed', next: firstLink(ctx) ?? ctx.plan.screens[0].id }) });

def({ id: 'report', label: 'Report / analytics', channels: ['portal', 'mobile'], shell: () => 'default',
  description: 'KPIs, a chart and an exportable table.',
  content: z.object({ intro: S(160).optional(), kpis: z.array(z.object({ label: S(40), value: S(24), delta: z.string().max(24).optional() })).min(2).max(4), chart: z.object({ title: S(60), kind: z.enum(['bar', 'line']), labels: z.array(S(12)).min(2).max(12), values: z.array(z.number().min(0)).min(2).max(12) }), columns: z.array(Field).max(6) }),
  build: (c, ctx) => { const id = ids(), col = ctx.collection; return [
    ...titleBlock(ctx, id, ctx.screen.title, c.intro),
    { type: 'Grid', id: id('kpis'), columns: String(Math.min(4, Math.max(2, c.kpis.length))), gap: 'md', children: c.kpis.map((k: any) => ({ type: 'Stat', id: id(k.label), label: k.label, value: k.value, ...(k.delta ? { delta: k.delta } : {}) })) },
    { type: 'Chart', id: id('chart'), ...c.chart },
    ...(col && c.columns?.length ? [{ type: 'Table', id: id('table'), collection: col.id, title: col.label, searchable: true, exportCsv: true, columns: c.columns.map((f: string) => ({ field: f, label: col.fields.find(x => x.id === f)?.label ?? f, ...formatFor(f) })) } as NodeT] : [])]; },
  defaults: () => ({ kpis: [{ label: 'Total', value: '0' }, { label: 'This month', value: '0' }], chart: { title: 'Trend', kind: 'bar', labels: ['Jan', 'Feb', 'Mar'], values: [1, 2, 3] }, columns: [] }) });

function formatFor(field: string, statusField?: string): { format?: 'aed' | 'date' | 'status' } {
  if (field === statusField || /status|state/i.test(field)) return { format: 'status' };
  if (/amount|balance|salary|price|fee|total|aed/i.test(field)) return { format: 'aed' };
  if (/date|^dob$|submitted|created|updated/i.test(field)) return { format: 'date' };
  return {};
}

export const ARCHETYPES: Record<string, ArchetypeDef> = Object.fromEntries(defs.map(d => [d.id, d]));
export const ARCHETYPE_IDS = [...defs.map(d => d.id), 'custom'] as const;
export function archetypesFor(channel: Channel) { return defs.filter(d => d.channels.includes(channel)); }
/** Build the screen for an archetype from (AI or default) content. */
export function buildArchetypeScreen(archetype: string, content: any, ctx: BuildCtx): Screen {
  const a = ARCHETYPES[archetype];
  return { id: ctx.screen.id, title: ctx.screen.title, shell: a.shell(ctx.channel), children: a.build(content, ctx) };
}
