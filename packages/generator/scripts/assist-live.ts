// Live check of the studio AI assistant: node scripts/assist-live.ts <doc.json> <outDir>  (needs OPENAI_API_KEY)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Generator, MemoryStore, OpenAIProvider, defaultConfig } from '../src/index.ts';
import { validateDocument } from '@demo/schema';
const [file, out] = process.argv.slice(2); mkdirSync(out, { recursive: true });
let doc = JSON.parse(readFileSync(file, 'utf8'));
const gen = new Generator(new MemoryStore(), new OpenAIProvider(process.env.OPENAI_MODEL || 'gpt-4.1-mini', process.env.OPENAI_API_KEY!), defaultConfig);
const otp = doc.screens.find((s: any) => /otp/.test(s.id))?.id;
const steps = [
  { instruction: 'Rename the Verify button to Validate', currentScreen: otp },
  { instruction: 'Add a new screen for card management: freeze or unfreeze the debit card, change PIN, set a daily spending limit', currentScreen: 'dashboard' },
  { instruction: 'Add an Emirates ID number field after the mobile number', currentScreen: doc.screens.find((s: any) => /create|sign-up|register/.test(s.id))?.id },
  { instruction: 'Notifications screen listing recent alerts (transfers, bill payments, security) with dates', currentScreen: 'dashboard', mode: 'add' as const, from: 'dashboard' },
];
for (const [i, st] of steps.entries()) {
  const t0 = Date.now();
  try {
    const r = await gen.assist(doc, st);
    doc = r.document;
    console.log('#' + (i + 1), r.action, r.screenId, 'USD', r.costUsd.toFixed(4), Math.round((Date.now() - t0) / 1000) + 's', '| errors', validateDocument(doc).filter(x => x.severity === 'error').length, '\n   ' + r.changes.join('\n   '));
  } catch (e) { console.log('#' + (i + 1), 'FAILED', (e as Error).message); }
}
writeFileSync(out + '/after.json', JSON.stringify(doc, null, 1));
