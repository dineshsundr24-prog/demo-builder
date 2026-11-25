// Live evaluation of assistant edits: node scripts/edit-eval.ts <portal.json> <mobile.json>   (needs OPENAI_API_KEY)
import { readFileSync } from 'node:fs';
import { Generator, MemoryStore, OpenAIProvider, defaultConfig } from '../src/index.ts';
import { validateDocument, type DemoDocument } from '@demo/schema';
const [portalFile, mobileFile] = process.argv.slice(2);
const load = (f: string): DemoDocument => JSON.parse(readFileSync(f, 'utf8'));
const gen = new Generator(new MemoryStore(), new OpenAIProvider(process.env.OPENAI_MODEL || 'gpt-4.1-mini', process.env.OPENAI_API_KEY!), defaultConfig);
gen.assistProvider = new OpenAIProvider(process.env.ASSIST_MODEL || 'gpt-4.1', process.env.OPENAI_API_KEY!);
const cases: [string, string, string][] = [
  ['portal', 'customer-applications', 'Add a filter by date to the applications list'],
  ['portal', 'customer-applications', 'Let staff filter by product and emirate too'],
  ['portal', 'application-details', 'Add a Reject button next to the existing actions'],
  ['portal', 'dashboard', 'Change the chart to a line chart titled Monthly disbursements'],
  ['portal', 'maker-review', 'Make the comments field optional'],
  ['mobile', 'dashboard', 'Remove the recent transactions section'],
  ['mobile', 'transfer-money', 'Add a payment reference field after the amount'],
  ['mobile', 'service-requests', 'Let customers search their requests'],
  ['mobile', 'otp-verification', 'Show a map of nearby branches here'],
  ['mobile', 'sign-in', 'Rename the Sign in button to Log in'],
];
let total = 0;
for (const [ch, screen, instruction] of cases) {
  const doc = load(ch === 'portal' ? portalFile : mobileFile);
  const t0 = Date.now();
  try {
    const r = await gen.assist(doc, { instruction, currentScreen: screen, mode: 'modify' });
    total += r.costUsd;
    const errs = validateDocument(r.document).filter(i => i.severity === 'error').length;
    const untouched = r.document.screens.filter(s => s.id !== screen).every(s => JSON.stringify(s) === JSON.stringify(doc.screens.find(x => x.id === s.id)));
    console.log('\n[' + ch + '] ' + instruction + '\n  ' + r.action + ' · ' + Math.round((Date.now() - t0) / 1000) + 's · USD ' + r.costUsd.toFixed(4) + ' · errors ' + errs + ' · other screens untouched ' + untouched + '\n  reply: ' + r.reply + '\n  ' + r.changes.join('\n  '));
  } catch (e) { console.log('\n[' + ch + '] ' + instruction + '\n  FAILED: ' + (e as Error).message); }
}
console.log('\nTotal USD', total.toFixed(4));
