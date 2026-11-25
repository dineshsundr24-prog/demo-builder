// Entry point: configuration from environment variables only (see .env.example).
import { Generator, MemoryStore, OpenAIProvider, SupabaseStore, defaultConfig, type JobStore } from '@demo/generator';
import { buildServer } from './server.ts';

// Trim pasted values: a trailing space or line break in a secret is a common cause of "Invalid API key".
const env: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
const required = (name: string) => { const v = env[name]; if (!v) { console.error('Missing required environment variable ' + name); process.exit(1); } return v; };
const model = env.OPENAI_MODEL || 'gpt-4.1-mini';
const num = (name: string, fallback: number) => { const n = Number(env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };

let store: JobStore;
if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) {
  const key = env.SUPABASE_SECRET_KEY;
  // Diagnose the usual mistakes without logging the key itself.
  let role = '';
  try { if (key.startsWith('eyJ')) role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role ?? ''; } catch { /* not a JWT */ }
  if (key.startsWith('sb_publishable_') || role === 'anon') console.error('SUPABASE_SECRET_KEY looks like a publishable/anon key; use the project SECRET key (sb_secret_...) or the legacy service_role key');
  else if (!key.startsWith('sb_secret_') && role !== 'service_role') console.warn('SUPABASE_SECRET_KEY has an unexpected format (expected sb_secret_... or a service_role JWT)');
  store = new SupabaseStore(env.SUPABASE_URL, key);
  store.costSince(new Date()).then(() => console.info('Supabase storage connected'), (e: Error) => console.error('Supabase storage check failed: ' + e.message));
}
else { console.warn('SUPABASE_URL/SUPABASE_SECRET_KEY not set: jobs are kept in memory and lost on restart'); store = new MemoryStore(); }

const generator = new Generator(store, new OpenAIProvider(model, required('OPENAI_API_KEY')), {
  ...defaultConfig,
  monthlyBudgetUsd: num('MONTHLY_AI_BUDGET_USD', defaultConfig.monthlyBudgetUsd),
  maxScreensPerJob: num('MAX_SCREENS_PER_JOB', defaultConfig.maxScreensPerJob),
  jobTokenBudget: num('JOB_TOKEN_BUDGET', defaultConfig.jobTokenBudget),
});
// Editing an existing screen benefits from a stronger model (about USD 0.01 per edit); generation stays on OPENAI_MODEL.
generator.assistProvider = new OpenAIProvider(env.ASSIST_MODEL || 'gpt-4.1', required('OPENAI_API_KEY'));
const app = await buildServer({
  generator, model, accessToken: required('DEMO_ACCESS_TOKEN'), logger: true,
  // FRONTEND_ORIGINS (comma list) and/or STUDIO_HOST (host name injected by the Render blueprint).
  origins: [...(env.FRONTEND_ORIGINS || (env.STUDIO_HOST ? '' : 'http://localhost:5173')).split(','), ...(env.STUDIO_HOST ? ['https://' + env.STUDIO_HOST] : [])].map(s => s.trim()).filter(Boolean),
});
await app.listen({ port: num('PORT', 8787), host: '0.0.0.0' });
