import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScreen, documentContext, errorsOnly } from '@demo/schema';
import { ARCHETYPES, archetypesFor, buildArchetypeScreen, sanitizeContent, planDocument, uxIssues, type Plan } from '../src/index.ts';

const plan = (channel: 'mobile' | 'portal'): Plan => ({
  appName: 'Nexa Mobile', brandName: 'Nexa', channel, theme: { primary: '#123456', secondary: '#654321', accent: '#ABCDEF' },
  shell: { kind: channel === 'mobile' ? 'tabs' : 'sidebar', brand: 'Nexa', showBack: true, items: [{ id: 'menu-1', label: 'Home', icon: 'home', screen: 'home' }] },
  collections: [{ id: 'requests', label: 'Requests', key: 'ref', fields: [{ id: 'ref', label: 'Reference' }, { id: 'type', label: 'Type' }, { id: 'amount', label: 'Amount' }, { id: 'status', label: 'Status' }], rows: [{ ref: 'NX-1', type: 'Transfer', amount: '1200', status: 'Pending' }] }],
  screens: ['welcome', 'home', 'list', 'detail', 'done'].map((id, i, all) => ({ id, title: id[0].toUpperCase() + id.slice(1), requirement: 'Req ' + id, purpose: 'Purpose of ' + id, template: null, links: all[i + 1] ? [all[i + 1]] : [all[0]], shell: 'default', locked: false, archetype: 'custom', collection: 'requests' })),
  sampleFacts: [{ label: 'Customer', value: 'Sara Al Mansoori' }], templates: ['sign-in', 'sign-up'], globalContext: '', notes: [],
});

for (const channel of ['mobile', 'portal'] as const) {
  for (const a of archetypesFor(channel)) {
    test(`${channel}: "${a.id}" default content builds a valid, UX-clean screen`, () => {
      const p = plan(channel), s = { ...p.screens[1], archetype: a.id };
      const ctx = { plan: p, screen: s, channel, collection: p.collections[0] };
      const content = a.content.parse(sanitizeContent(a.defaults(ctx), ctx));
      const screen = buildArchetypeScreen(a.id, content, ctx);
      assert.ok(screen.children.length > 0);
      assert.deepEqual(errorsOnly(validateScreen(screen, documentContext(planDocument(p)), 'screen')), []);
      assert.deepEqual(uxIssues(screen, channel).filter(i => i.severity === 'error'), []);
    });
  }
}

test('invalid targets and fields are repaired deterministically, never self-links', () => {
  const p = plan('mobile'), s = { ...p.screens[2], archetype: 'list' };
  const ctx = { plan: p, screen: s, channel: 'mobile' as const, collection: p.collections[0] };
  const c = sanitizeContent({ titleField: 'nope', columns: ['ref', 'bogus'], searchable: true, detailTarget: 'list', create: { label: 'New', target: 'missing' } }, ctx);
  assert.equal(c.titleField, 'ref');
  assert.deepEqual(c.columns, ['ref']);
  assert.equal(c.detailTarget, undefined, 'self-link dropped');
  assert.equal(c.create.target, undefined);
});

test('every archetype is offered on at least one channel and has a description', () => {
  for (const a of Object.values(ARCHETYPES)) assert.ok(a.channels.length && a.description.length > 10, a.id);
});

test('every archetype content schema is valid for strict structured outputs', async () => {
  const { toStrictSchema, lintStrict } = await import('@demo/schema');
  for (const a of Object.values(ARCHETYPES)) {
    const schema = toStrictSchema(a.content, { screen: ['home', 'done'], field: ['ref', 'status'] });
    assert.deepEqual(lintStrict(schema).problems, [], a.id);
  }
});

test('builders repair common AI content mistakes deterministically', () => {
  const p = plan('mobile'), ctx = (a: string) => ({ plan: p, screen: { ...p.screens[1], archetype: a }, channel: 'mobile' as const, collection: p.collections[0] });
  const flat = (n: any[]): any[] => n.flatMap(x => [x, ...flat(x.children ?? [])]);
  const signUp = buildArchetypeScreen('sign-up', { headline: 'Join', subtitle: 'x', termsLabel: 'I accept the terms', primaryLabel: 'Continue', next: 'done',
    fields: [{ label: 'Full name', kind: 'text', required: true }, { label: 'Accept terms and conditions', kind: 'checkbox', required: true }] }, ctx('sign-up'));
  assert.equal(flat(signUp.children).filter(n => n.type === 'Checkbox').length, 1, 'one terms checkbox');
  const profile = buildArchetypeScreen('profile', { name: 'my-profile', sections: [{ title: 'Account', items: [{ label: 'Security', icon: 'lock' }, { label: 'Back to dashboard', icon: 'home', target: 'home' }] }] }, ctx('profile'));
  assert.equal((profile.children[0] as any).name, 'Sara Al Mansoori');
  assert.deepEqual((profile.children[1] as any).items.map((i: any) => i.label), ['Security']);
  const form = buildArchetypeScreen('form', { current: { title: 'Bill', items: [{ label: 'Bill category selection', value: 'Electricity' }, { label: 'Available balance', value: 'AED 1,000' }] },
    sections: [{ fields: [{ label: 'Bill category', kind: 'select', options: ['Electricity'], required: true }] }], primaryLabel: 'Pay now', next: 'done', cancel: { label: 'Back to Dashboard' } }, ctx('form'));
  const all = flat(form.children);
  assert.deepEqual(all.find(n => n.type === 'RecordFields').items.map((i: any) => i.label), ['Available balance']);
  assert.equal(all.find(n => n.type === 'ActionBar').secondary.label, 'Cancel');
});
