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
  if (req.purpose === 'plan') {
    const list = input.screenList ?? [{ id: 'home', title: 'Home' }, { id: 'details', title: 'Details' }];
    return { theme: { primary: '#17365D', secondary: '#0E9389', accent: '#F58220' }, sampleFacts: [{ label: 'Customer', value: 'Ahmed Al Hammadi' }], shellKind: 'tabs',
      menu: list.some((s: any) => s.id === 'dashboard') ? [{ label: 'Home', icon: 'home', screen: 'dashboard' }, { label: 'Requests', icon: 'list', screen: 'my-service-requests' }, { label: 'Profile', icon: 'user', screen: 'customer-profile' }] : [],
      collections: [{ id: 'service-requests', label: 'Service requests', key: 'ref', fields: [{ id: 'ref', label: 'Reference' }, { id: 'type', label: 'Type' }, { id: 'status', label: 'Status' }, { id: 'date', label: 'Submitted' }],
        rows: [['KPK-INC-2026-00125', 'Income update', 'In review', '24 Nov 2026'], ['KPK-CRD-2026-00087', 'Card replacement', 'Completed', '02 Nov 2026']] }],
      screens: list.map((s: any, i: number) => ({ id: s.id, title: s.title, purpose: 'Fictional ' + s.title + ' screen', template: null, links: list[i + 1] ? [list[i + 1].id] : [], shell: 'default' })) };
  }
  const id = input.screen?.id ?? input.context?.screen?.id;
  const channel = (input.app ?? input.context?.app)?.channel === 'portal' ? 'portal' : 'mobile';
  return screens[channel].get(id) ?? { id, title: input.screen.title, shell: 'default', children: [{ type: 'Heading', id: 'h', text: input.screen.title, level: '2' }, { type: 'Text', id: 't', text: 'Generated content' }] };
});
const app = await buildServer({ generator: new Generator(new MemoryStore(), provider, { ...defaultConfig, retryDelaysMs: [10] }), accessToken: 'e2e-token', model: 'fake', origins: ['http://localhost:5174', 'http://localhost:5173'] });
await app.listen({ port: Number(process.env.PORT || 8788), host: '127.0.0.1' });
