// Phase 0 live check: does the configured model accept the recursive strict
// schema and return a screen that passes the single validator?
// Makes exactly ONE request per run. Requires OPENAI_API_KEY in the process
// environment (never printed). Optional OPENAI_MODEL (default gpt-4.1-mini).
// Output: status, latency, token usage, validator result - no prompt/secret echo.
import { readFileSync, writeFileSync } from 'node:fs';
import { aiScreenSchema, stripNulls } from './aiSchema.ts';
import { validateScreen, contextFor } from './validate.ts';

const key = process.env.OPENAI_API_KEY;
if (!key) { console.error('OPENAI_API_KEY is not set; nothing was sent.'); process.exit(2); }
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const templates = ['uaepass-login', 'uaepass-ekyc', 'face-verification', 'otp-entry', 'document-upload'];
const kapiko = JSON.parse(readFileSync(new URL('../fixtures/kapiko.synthetic.json', import.meta.url), 'utf8'));
const ctx = { screenIds: kapiko.screens.map((s: any) => s.id), collectionIds: kapiko.collections.map((c: any) => c.id), templateIds: templates };
const schema = aiScreenSchema(ctx);
const instructions = 'You design ONE screen of a fictional UAE banking demo as a component tree. Use only the schema. Navigate only to listed screens. Simulated services must say they are simulated. Use fictional data.';
const input = JSON.stringify({
  app: { name: 'Kapiko Bank Mobile', channel: 'mobile' },
  screen: { id: 'income-update', title: 'Income Update', requirement: 'Existing employer and income; new salary, allowances, additional income, employment status, effective date, salary certificate upload; Save Draft, Continue to income-verification-review, Cancel to dashboard.' },
  state: 'Inputs write state keys such as income.salary.',
  screens: kapiko.screens.map((s: any) => ({ id: s.id, title: s.title })),
});
const started = Date.now();
const response = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model, instructions, input, store: false, max_output_tokens: 4000,
    text: { format: { type: 'json_schema', name: 'screen', strict: true, schema } } }),
});
const body: any = await response.json();
const result: any = { httpStatus: response.status, model: body.model, latencyMs: Date.now() - started, status: body.status, incomplete: body.incomplete_details ?? null, usage: body.usage ?? null };
if (!response.ok) result.error = { type: body?.error?.type, code: body?.error?.code, param: body?.error?.param, message: String(body?.error?.message || '').slice(0, 400) };
else {
  const text = (body.output || []).filter((x: any) => x.type === 'message').flatMap((x: any) => x.content || []).filter((x: any) => x.type === 'output_text').map((x: any) => x.text).join('');
  const screen = stripNulls(JSON.parse(text));
  result.issues = validateScreen(screen, contextFor(kapiko, templates));
  result.componentTypes = JSON.stringify(screen).match(/"type":"[A-Za-z]+"/g)?.length;
  writeFileSync(new URL('../fixtures/live.income-update.json', import.meta.url), JSON.stringify(screen, null, 1));
}
console.log(JSON.stringify(result, null, 1));
