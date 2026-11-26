// Zero-cost API for browser tests and UI development: real server, fake AI provider.
// Screens come from the Kapiko/Staff Portal fixtures when ids match, otherwise a simple valid screen.
import { readFileSync } from 'node:fs';
import { FakeProvider, Generator, MemoryStore, defaultConfig, type CompletionRequest } from '@demo/generator';
import { buildServer } from './server.ts';
import { httpMeyonClient } from './launch/meyon.ts';

const fixture = (f: string) => JSON.parse(readFileSync(new URL('../../../packages/schema/fixtures/' + f, import.meta.url), 'utf8'));
const screens = { mobile: new Map(fixture('kapiko-mobile.json').screens.map((s: any) => [s.id, s])), portal: new Map(fixture('staff-portal.json').screens.map((s: any) => [s.id, s])) };
const provider = new FakeProvider(async (req: CompletionRequest) => {
  const input = JSON.parse(req.input);
  await new Promise(r => setTimeout(r, 150)); // make progress visible
  // Studio assistant (deterministic): route, plan a new "info" screen, or apply "rename X to Y".
  if (req.schemaName === 'route' && /\b(menu|tab|tabs|sidebar|delete .*screen|reorder)\b/i.test(input.request)) return { intent: 'change_flow', screen: null };
  if (req.schemaName === 'flow_edit') {
    // "rename the X tab to Y" / "remove X from the menu" / "delete the X screen"
    const r = /rename the (.+?) (?:tab|menu item) to (.+)$/i.exec(input.request), rm = /remove (.+?) from the (?:menu|tabs|sidebar)/i.exec(input.request), del = /delete the (.+?) screen/i.exec(input.request);
    const item = (l: string) => input.menu.find((m: any) => m.label.toLowerCase() === l.toLowerCase());
    if (r && item(r[1])) return { reply: 'Renamed the ' + r[1] + ' tab to ' + r[2] + '.', operations: [{ op: 'menuUpdate', screen: item(r[1]).screen, label: r[2], icon: null, newScreen: null }] };
    if (rm && item(rm[1])) return { reply: 'Removed ' + rm[1] + ' from the menu.', operations: [{ op: 'menuRemove', screen: item(rm[1]).screen }] };
    const sc = del && input.screens.find((x: any) => x.title.toLowerCase() === del[1].toLowerCase());
    if (sc) return { reply: 'Deleted the ' + sc.title + ' screen.', operations: [{ op: 'screenDelete', screen: sc.id }] };
    return { reply: 'I am not sure which part of the app structure to change.', operations: [] };
  }
  if (req.schemaName === 'route') return { intent: /\b(new|add|create)\b.*\b(screen|page)\b/i.test(input.request) ? 'add_screen' : 'modify_screen', screen: input.currentScreen };
  if (req.schemaName === 'new_screen') return { title: 'Card Management', archetype: 'info', purpose: 'Manage the debit card.', mustInclude: ['freeze card'], openFrom: input.openFromGiven ?? input.screens[0].id,
    entryLabel: 'Cards', entryIcon: 'credit-card', leadsTo: [], collection: null, newCollection: null, sampleFacts: [] };
  if (req.schemaName.startsWith('content_')) return { intro: 'Control your debit card.', items: [{ icon: 'lock', title: 'Freeze card', text: 'Temporarily block all card payments.', meta: null }, { icon: 'shield', title: 'Change PIN', text: 'Set a new 4-digit PIN.', meta: null }], primary: null };
  if (req.schemaName === 'screen_edit') {
    // "rename X to Y": replace the matching component's label; "table filter by date": switch on the date filter.
    const m = /rename\s+(?:the\s+)?"?(.+?)"?\s+(?:button\s+)?to\s+"?(.+?)"?$/i.exec(input.request.trim());
    const all: any[] = []; const w = (ns: any[]) => ns.forEach(n => { all.push(n); if (n.children) w(n.children); }); w(input.components);
    if (m) { const from = m[1].replace(/\s+button$/i, ''); const n = all.find(x => x.label === from || x.text === from); if (n) { const { children, ...rest } = n; void children; return { reply: 'Renamed "' + from + '" to "' + m[2] + '".', operations: [{ op: 'replace', target: n.id, node: { ...rest, ...(n.label !== undefined ? { label: m[2] } : { text: m[2] }) } }] }; } }
    const table = all.find(x => x.type === 'Table');
    if (/date/i.test(input.request) && table) { const { children, ...rest } = table; void children; return { reply: 'Switched on the date-range filter.', operations: [{ op: 'replace', target: table.id, node: { ...rest, dateFilterField: 'date' } }] }; }
    return { reply: 'I am not sure what to change. Could you say which part of the screen?', operations: [] };
  }
  if (req.schemaName === 'change_plan') {
    const ac = input.acceptanceCriteria.map((c: any) => c.id), first = input.app.screens[0].id, last = input.app.screens[input.app.screens.length - 1];
    return { summary: 'Add a card management screen and link it from the start.', gaps: ['Can a frozen card still receive refunds?'],
      changes: [{ action: 'add', screen: null, title: 'Card Controls', description: 'Freeze or unfreeze the debit card after confirming.', details: ['Card with masked number', 'Freeze toggle'], criteria: ac.slice(0, 2), openFrom: first, addToMenu: false },
        { action: 'remove_candidate', screen: last.id, title: last.title, description: 'Possibly not needed for this story.', details: [], criteria: [], openFrom: null, addToMenu: false }] };
  }
  if (req.schemaName === 'screen_suggestion') {
    const ac = input.acceptanceCriteria.map((c: any) => c.id);
    const titles = ['Loan Eligibility', 'Loan Calculator', 'Upload Documents', 'Review Application', 'Application Submitted'];
    return { journey: 'Home -> eligibility -> calculator -> documents -> review -> submitted', gaps: ['Which interest rate should the demo show?'],
      screens: titles.map((title, i) => ({ title, purpose: 'Fictional ' + title + ' step', details: ['Detail one', 'Detail two'], criteria: ac.filter((_: any, k: number) => k % titles.length === i) })) };
  }
  if (req.purpose === 'plan') {
    const list = input.screenList ?? [{ id: 'home', title: 'Home' }, { id: 'details', title: 'Details' }];
    return { theme: { primary: '#17365D', secondary: '#0E9389', accent: '#F58220' }, sampleFacts: [{ label: 'Customer', value: 'Ahmed Al Hammadi' }], shellKind: 'tabs',
      menu: list.some((s: any) => s.id === 'dashboard') ? [{ label: 'Home', icon: 'home', screen: 'dashboard' }, { label: 'Requests', icon: 'list', screen: 'my-service-requests' }, { label: 'Profile', icon: 'user', screen: 'customer-profile' }] : [],
      collections: [{ id: 'service-requests', label: 'Service requests', key: 'ref', fields: [{ id: 'ref', label: 'Reference' }, { id: 'type', label: 'Type' }, { id: 'status', label: 'Status' }, { id: 'date', label: 'Submitted' }],
        rows: [['KPK-INC-2026-00125', 'Income update', 'In review', '24 Nov 2026'], ['KPK-CRD-2026-00087', 'Card replacement', 'Completed', '02 Nov 2026']] }],
      // Launched stories: spread the approved criteria over the screens (the first screen gets the rest).
      screens: list.map((s: any, i: number) => ({ id: s.id, title: s.title, purpose: 'Fictional ' + s.title + ' screen', template: null, links: list[i + 1] ? [list[i + 1].id] : [], shell: 'default', mustInclude: [],
        ...(input.acceptanceCriteria ? { criteria: input.acceptanceCriteria.filter((_: any, k: number) => k % list.length === i).map((c: any) => c.id) } : {}) })) };
  }
  const id = input.screen?.id ?? input.context?.screen?.id;
  const channel = (input.app ?? input.context?.app)?.channel === 'portal' ? 'portal' : 'mobile';
  const isFirst = input.allScreens?.[0]?.id === id;
  return screens[channel].get(id) ?? { id, title: input.screen.title, shell: isFirst ? 'hidden' : 'default', children: isFirst
    ? [{ type: 'Hero', id: 'hero', title: input.screen.title, subtitle: 'Generated content', showLogo: true, illustration: 'none' }]
    : [{ type: 'Heading', id: 'h', text: input.screen.title, level: '2' }, { type: 'Text', id: 't', text: 'Generated content' }] };
});
// Launches from a simulated MEYON (grants may be prepared with the e2e token here; production requires a sign-in).
const port = Number(process.env.PORT || 8788), integrationKey = 'dev-fake-integration-key-0123456789abcdef';
const app = await buildServer({ generator: new Generator(new MemoryStore(), provider, { ...defaultConfig, retryDelaysMs: [10] }), accessToken: 'e2e-token', model: 'fake', origins: ['http://localhost:5174', 'http://localhost:5173'],
  sessionSecret: 'dev-fake-session-secret-0123456789abcdef', meyon: httpMeyonClient('http://127.0.0.1:' + port + '/sim/meyon', integrationKey),
  meyonSimulator: { integrationKey, allowSharedToken: true }, publicBaseUrl: 'http://localhost:5174', rateLimitPerMinute: 500 }); // parallel browser tests share one client address
await app.listen({ port, host: '127.0.0.1' });
