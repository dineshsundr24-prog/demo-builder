// Live evaluation of app-structure requests: node scripts/flow-eval.ts <mobile.json> <portal.json>  (needs OPENAI_API_KEY)
import { readFileSync } from 'node:fs';
import { Generator, MemoryStore, OpenAIProvider, defaultConfig } from '../src/index.ts';
import { validateDocument, type DemoDocument } from '@demo/schema';
const [mobileFile, portalFile] = process.argv.slice(2);
const load = (f: string): DemoDocument => JSON.parse(readFileSync(f, 'utf8'));
const gen = new Generator(new MemoryStore(), new OpenAIProvider('gpt-4.1-mini', process.env.OPENAI_API_KEY!), defaultConfig);
gen.assistProvider = new OpenAIProvider(process.env.ASSIST_MODEL || 'gpt-4.1', process.env.OPENAI_API_KEY!);
const cases: [string, string][] = [
  ['mobile', 'Rename the Transactions tab to Activity and move Profile to the first position'],
  ['mobile', 'Remove Profile from the bottom menu'],
  ['mobile', 'Delete the bill payment screen'],
  ['mobile', 'Move the My Profile screen right after the Dashboard'],
  ['mobile', 'Hide the menu on the OTP screen'],
  ['mobile', 'Use a side drawer menu instead of bottom tabs'],
  ['mobile', 'Add Service Requests to the menu with a list icon'],
  ['portal', 'Add Customer 360 to the sidebar after Customer Search'],
  ['portal', 'Rename the Reports page to Analytics and put it in the menu as Analytics'],
  ['portal', 'Delete the Request Details page'],
  ['portal', 'Delete all the screens'],
];
let total = 0;
for (const [ch, instruction] of cases) {
  const doc = load(ch === 'mobile' ? mobileFile : portalFile);
  const t0 = Date.now();
  try {
    const r = await gen.assist(doc, { instruction, currentScreen: doc.screens[0].id });
    total += r.costUsd;
    const errs = validateDocument(r.document).filter(i => i.severity === 'error').length;
    console.log('\n[' + ch + '] ' + instruction + '\n  ' + r.action + ' · ' + Math.round((Date.now() - t0) / 1000) + 's · USD ' + r.costUsd.toFixed(4) + ' · errors ' + errs + '\n  reply: ' + r.reply + '\n  ' + r.changes.join('\n  ') + '\n  menu: ' + r.document.shell.kind + ' [' + r.document.shell.items.map(i => i.label).join(', ') + ']');
  } catch (e) { console.log('\n[' + ch + '] ' + instruction + '\n  FAILED: ' + (e as Error).message); }
}
console.log('\nTotal USD', total.toFixed(4));
