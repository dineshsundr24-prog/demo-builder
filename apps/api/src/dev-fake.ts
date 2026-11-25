// Zero-cost API for browser tests and UI development: real server, fake AI provider.
// Screens come from the Kapiko/Staff Portal fixtures when ids match, otherwise a simple valid screen.
import { readFileSync } from 'node:fs';
import { FakeProvider, Generator, MemoryStore, defaultConfig, type CompletionRequest } from '@demo/generator';
import { buildServer } from './server.ts';

const fixture = (f: string) => JSON.parse(readFileSync(new URL('../../../packages/schema/fixtures/' + f, import.meta.url), 'utf8'));
const screens = { mobile: new Map(fixture('kapiko-mobile.json').screens.map((s: any) => [s.id, s])), portal: new Map(fixture('staff-portal.json').screens.map((s: any) => [s.id, s])) };
const provider = new FakeProvider(async (req: CompletionRequest) => {
  const input = JSON.parse(req.input);
  await new Promise(r => setTimeout(r, 150)); // make progress visible
  // Studio assistant (deterministic): route, plan a new "info" screen, or apply "rename X to Y".
  if (req.schemaName === 'route') return { intent: /\b(new|add|create)\b.*\b(screen|page)\b/i.test(input.request) ? 'add_screen' : 'modify_screen', screen: input.currentScreen };
  if (req.schemaName === 'new_screen') return { title: 'Card Management', archetype: 'info', purpose: 'Manage the debit card.', mustInclude: ['freeze card'], openFrom: input.openFromGiven ?? input.screens[0].id,
    entryLabel: 'Cards', entryIcon: 'credit-card', leadsTo: [], collection: null, newCollection: null, sampleFacts: [] };
  if (req.schemaName.startsWith('content_')) return { intro: 'Control your debit card.', items: [{ icon: 'lock', title: 'Freeze card', text: 'Temporarily block all card payments.', meta: null }, { icon: 'shield', title: 'Change PIN', text: 'Set a new 4-digit PIN.', meta: null }], primary: null };
  if (req.schemaName === 'screen' && input.instruction) {
    const m = /rename\s+(?:the\s+)?"?(.+?)"?\s+(?:button\s+)?to\s+"?(.+?)"?$/i.exec(input.instruction.trim());
    const s = JSON.stringify(input.screen ?? input.previousScreen);
    return JSON.parse(m ? s.replaceAll('"' + m[1].replace(/\s+button$/i, '') + '"', JSON.stringify(m[2])) : s);
  }
  if (req.purpose === 'plan') {
    const list = input.screenList ?? [{ id: 'home', title: 'Home' }, { id: 'details', title: 'Details' }];
    return { theme: { primary: '#17365D', secondary: '#0E9389', accent: '#F58220' }, sampleFacts: [{ label: 'Customer', value: 'Ahmed Al Hammadi' }], shellKind: 'tabs',
      menu: list.some((s: any) => s.id === 'dashboard') ? [{ label: 'Home', icon: 'home', screen: 'dashboard' }, { label: 'Requests', icon: 'list', screen: 'my-service-requests' }, { label: 'Profile', icon: 'user', screen: 'customer-profile' }] : [],
      collections: [{ id: 'service-requests', label: 'Service requests', key: 'ref', fields: [{ id: 'ref', label: 'Reference' }, { id: 'type', label: 'Type' }, { id: 'status', label: 'Status' }, { id: 'date', label: 'Submitted' }],
        rows: [['KPK-INC-2026-00125', 'Income update', 'In review', '24 Nov 2026'], ['KPK-CRD-2026-00087', 'Card replacement', 'Completed', '02 Nov 2026']] }],
      screens: list.map((s: any, i: number) => ({ id: s.id, title: s.title, purpose: 'Fictional ' + s.title + ' screen', template: null, links: list[i + 1] ? [list[i + 1].id] : [], shell: 'default', mustInclude: [] })) };
  }
  const id = input.screen?.id ?? input.context?.screen?.id;
  const channel = (input.app ?? input.context?.app)?.channel === 'portal' ? 'portal' : 'mobile';
  const isFirst = input.allScreens?.[0]?.id === id;
  return screens[channel].get(id) ?? { id, title: input.screen.title, shell: isFirst ? 'hidden' : 'default', children: isFirst
    ? [{ type: 'Hero', id: 'hero', title: input.screen.title, subtitle: 'Generated content', showLogo: true, illustration: 'none' }]
    : [{ type: 'Heading', id: 'h', text: input.screen.title, level: '2' }, { type: 'Text', id: 't', text: 'Generated content' }] };
});
const app = await buildServer({ generator: new Generator(new MemoryStore(), provider, { ...defaultConfig, retryDelaysMs: [10] }), accessToken: 'e2e-token', model: 'fake', origins: ['http://localhost:5174', 'http://localhost:5173'] });
await app.listen({ port: Number(process.env.PORT || 8788), host: '127.0.0.1' });
