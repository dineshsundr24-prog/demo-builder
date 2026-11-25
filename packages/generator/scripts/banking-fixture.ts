// Deterministic banking demo built only from archetype defaults (no AI): node scripts/banking-fixture.ts <out.json>
import { writeFileSync } from 'node:fs';
import { ARCHETYPES, buildArchetypeScreen, assemble, type Plan } from '../src/index.ts';
import { validateDocument } from '@demo/schema';
const screens = [['home', 'Home', 'dashboard'], ['account', 'Current Account', 'account-details'], ['transfer', 'Transfer Money', 'transfer'], ['review-transfer', 'Review Transfer', 'review'], ['transfer-done', 'Transfer Sent', 'success'], ['cards', 'My Cards', 'card-controls'], ['finance', 'Personal Finance', 'loan-offer'], ['bills', 'Pay Bills', 'bill-payment']] as const;
const plan: Plan = { appName: 'Falcon Bank', brandName: 'Falcon', channel: 'mobile', theme: { primary: '#0B3B6E', secondary: '#0E9389', accent: '#F58220' },
  shell: { kind: 'tabs', brand: 'Falcon', showBack: true, items: [{ id: 'm1', label: 'Home', icon: 'home', screen: 'home' }, { id: 'm2', label: 'Cards', icon: 'credit-card', screen: 'cards' }, { id: 'm3', label: 'Transfer', icon: 'send', screen: 'transfer' }] },
  collections: [], sampleFacts: [{ label: 'Customer name', value: 'Aisha Al Mansoori' }], templates: [], globalContext: '', notes: [],
  screens: screens.map(([id, title, archetype], i) => ({ id, title, requirement: title, purpose: title, template: null, links: [screens[i + 1]?.[0] ?? 'home'], shell: 'default' as const, locked: true, archetype })) };
const content: Record<string, object> = {
  'review-transfer': { intro: 'Check the transfer before you send it.', groups: [{ title: 'Transfer', items: [{ label: 'Beneficiary', value: 'Sara Al Mansoori' }, { label: 'Amount', value: 'AED 1,000.00' }, { label: 'Purpose', value: 'Family support' }] }], primaryLabel: 'Send money', next: 'transfer-done' },
};
const built = plan.screens.map(s => { const ctx = { plan, screen: s, channel: plan.channel, collection: undefined }; return buildArchetypeScreen(s.archetype!, { ...ARCHETYPES[s.archetype!].defaults(ctx), ...(content[s.id] ?? {}) }, ctx); });
const { document } = assemble(plan, built, { id: 'falcon-banking' });
const errors = validateDocument(document).filter(i => i.severity === 'error');
if (errors.length) { console.error(errors); process.exit(1); }
writeFileSync(process.argv[2], JSON.stringify(document, null, 1));
console.log('ok', document.screens.map(s => s.id).join(' '));
