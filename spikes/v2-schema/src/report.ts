import { readFileSync, writeFileSync } from 'node:fs';
import { aiScreenSchema, lintStrict } from './aiSchema.ts';
const k = JSON.parse(readFileSync(new URL('../fixtures/kapiko.synthetic.json', import.meta.url), 'utf8'));
const ctx = { screenIds: k.screens.map((s: any) => s.id), collectionIds: ['service-requests'], templateIds: ['uaepass-login','uaepass-ekyc','face-verification','otp-entry','document-upload'], screenId: 'dashboard' };
const big = { ...ctx, screenIds: Array.from({ length: 60 }, (_, i) => 'screen-number-' + i) };
for (const [name, s] of [['recursive', aiScreenSchema(ctx)], ['unrolled-depth3', aiScreenSchema(ctx, { maxDepth: 3 })], ['recursive-60-screens', aiScreenSchema(big)]] as const) {
  const l = lintStrict(s);
  console.log(name.padEnd(22), 'bytes', l.bytes, '≈tokens', Math.round(l.bytes / 3.5), 'props', l.properties, 'enumValues', l.enumValues, 'depth', l.objectDepth, 'problems', l.problems.length);
  writeFileSync(new URL('../fixtures/ai-schema.' + name + '.json', import.meta.url), JSON.stringify(s, null, 1));
}
const screenTokens = k.screens.map((s: any) => Math.round(JSON.stringify(s).length / 3.5));
console.log('fixture screen output ≈tokens: min', Math.min(...screenTokens), 'max', Math.max(...screenTokens), 'total', screenTokens.reduce((a: number, b: number) => a + b, 0));
