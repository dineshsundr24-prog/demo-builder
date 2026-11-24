// Entry point: configuration from environment variables only (see .env.example).
import { Generator, MemoryStore, OpenAIProvider, SupabaseStore, defaultConfig, type JobStore } from '@demo/generator';
import { buildServer } from './server.ts';

const env = process.env;
const required = (name: string) => { const v = env[name]; if (!v) { console.error('Missing required environment variable ' + name); process.exit(1); } return v; };
const model = env.OPENAI_MODEL || 'gpt-4.1-mini';
const num = (name: string, fallback: number) => { const n = Number(env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };

let store: JobStore;
if (env.SUPABASE_URL && env.SUPABASE_SECRET_KEY) store = new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
else { console.warn('SUPABASE_URL/SUPABASE_SECRET_KEY not set: jobs are kept in memory and lost on restart'); store = new MemoryStore(); }

const generator = new Generator(store, new OpenAIProvider(model, required('OPENAI_API_KEY')), {
  ...defaultConfig,
  monthlyBudgetUsd: num('MONTHLY_AI_BUDGET_USD', defaultConfig.monthlyBudgetUsd),
  maxScreensPerJob: num('MAX_SCREENS_PER_JOB', defaultConfig.maxScreensPerJob),
  jobTokenBudget: num('JOB_TOKEN_BUDGET', defaultConfig.jobTokenBudget),
});
const app = await buildServer({
  generator, model, accessToken: required('DEMO_ACCESS_TOKEN'), logger: true,
  // FRONTEND_ORIGINS (comma list) and/or STUDIO_HOST (host name injected by the Render blueprint).
  origins: [...(env.FRONTEND_ORIGINS || (env.STUDIO_HOST ? '' : 'http://localhost:5173')).split(','), ...(env.STUDIO_HOST ? ['https://' + env.STUDIO_HOST] : [])].map(s => s.trim()).filter(Boolean),
});
await app.listen({ port: num('PORT', 8787), host: '0.0.0.0' });
