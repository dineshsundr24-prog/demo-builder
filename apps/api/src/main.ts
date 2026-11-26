// Entry point: configuration from environment variables only (see .env.example).
import { Generator, MemoryStore, OpenAIProvider, SupabaseStore, defaultConfig, type JobStore } from '@demo/generator';
import { buildServer } from './server.ts';
import { MemoryDemoStore, SupabaseDemoStore, type DemoStore } from './demos/store.ts';
import { jwksVerifier, supabaseVerifier } from './demos/auth.ts';
import { httpMeyonClient, type MeyonClient } from './launch/meyon.ts';
import { loadPrivateKey } from './sync/keys.ts';
import { randomBytes } from 'node:crypto';

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
// Demos, versions and publications live in the same Supabase project (migration 0002); sign-ins are
// verified with its Auth server. Without Supabase, demos are in memory (development only).
const demoStore: DemoStore = env.SUPABASE_URL && env.SUPABASE_SECRET_KEY ? new SupabaseDemoStore(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY) : new MemoryDemoStore();
// Sign-ins are verified locally against the project's published signing keys (remote check only for legacy HS256 tokens).
const verifyUser = env.SUPABASE_URL && env.SUPABASE_SECRET_KEY ? jwksVerifier(env.SUPABASE_URL, supabaseVerifier(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY)) : undefined;
if (env.BUILDER_SESSION_SECRET && env.BUILDER_SESSION_SECRET.length < 32) { console.error('BUILDER_SESSION_SECRET must be at least 32 characters'); process.exit(1); }
// LEGACY_UAT_TOKEN=off: only signed-in users (and, later, MEYON sessions) can use the API.
const allowUatToken = (env.LEGACY_UAT_TOKEN ?? 'on').toLowerCase() !== 'off';
if (!allowUatToken) console.info('Legacy shared UAT token disabled: sign-in required');
// Launches from MEYON: MEYON_BASE_URL + MEYON_INTEGRATION_KEY (real MEYON), or MEYON_SIMULATOR=on (testing/UAT only).
const port = num('PORT', 8787);
const simulator = (env.MEYON_SIMULATOR ?? '').toLowerCase() === 'on';
if (simulator && env.MEYON_BASE_URL) { console.error('MEYON_SIMULATOR=on cannot be combined with MEYON_BASE_URL'); process.exit(1); }
// Sync events: MEYON_EVENT_SECRETS (comma-separated, 32+ characters each; the first signs, all stay valid on MEYON's
// side during a rotation). The simulator generates its own when none are set.
const eventSecrets = (env.MEYON_EVENT_SECRETS ?? '').split(',').map(s => s.trim()).filter(Boolean);
if (eventSecrets.some(s => s.length < 32)) { console.error('Each MEYON_EVENT_SECRETS entry must be at least 32 characters'); process.exit(1); }
let meyon: MeyonClient | undefined, meyonSimulator: { integrationKey: string; eventSecrets: string[] } | undefined, sync: import('./sync/events.ts').SyncOptions | undefined;
let signingKey: import('node:crypto').KeyObject | undefined, meyonKeysUrl: string | undefined;
if (simulator) {
  const secrets = eventSecrets.length ? eventSecrets : [randomBytes(32).toString('base64url')];
  meyonSimulator = { integrationKey: env.MEYON_INTEGRATION_KEY || randomBytes(32).toString('base64url'), eventSecrets: secrets };
  meyon = httpMeyonClient('http://127.0.0.1:' + port + '/sim/meyon', meyonSimulator.integrationKey);
  sync = { url: 'http://127.0.0.1:' + port + '/sim/meyon/demo-builder/v1/events', secrets };
  console.warn('MEYON simulator enabled: launches use simulated sample stories, not a real MEYON');
} else if (env.MEYON_BASE_URL) {
  // Preferred: BUILDER_SIGNING_KEY (base64 PKCS#8 Ed25519). Demo Builder signs launch-grant requests and events; MEYON
  // verifies them with the public key Demo Builder publishes, and Demo Builder verifies MEYON with MEYON's published key.
  // Fallback: a shared MEYON_INTEGRATION_KEY and MEYON_EVENT_SECRETS.
  const base = env.MEYON_BASE_URL.replace(/\/$/, '');
  if (env.BUILDER_SIGNING_KEY) {
    try { signingKey = loadPrivateKey(env.BUILDER_SIGNING_KEY); } catch { console.error('BUILDER_SIGNING_KEY is not a base64 PKCS#8 Ed25519 private key'); process.exit(1); }
    meyon = httpMeyonClient(base, signingKey);
    sync = { url: base + '/demo-builder/v1/events', signingKey, ...(eventSecrets.length ? { secrets: eventSecrets } : {}) } as typeof sync;
    meyonKeysUrl = base + '/demo-builder/v1/public-key';
  } else {
    if (!env.MEYON_INTEGRATION_KEY || env.MEYON_INTEGRATION_KEY.length < 32) { console.error('BUILDER_SIGNING_KEY or MEYON_INTEGRATION_KEY (32+ characters) is required with MEYON_BASE_URL'); process.exit(1); }
    meyon = httpMeyonClient(base, env.MEYON_INTEGRATION_KEY);
    if (eventSecrets.length) sync = { url: base + '/demo-builder/v1/events', secrets: eventSecrets };
    else console.warn('MEYON_EVENT_SECRETS is not set: sync events are recorded but not delivered to MEYON');
  }
}
if (meyon && !env.BUILDER_SESSION_SECRET) console.warn('BUILDER_SESSION_SECRET is not set: launches from MEYON are disabled');
const app = await buildServer({
  meyon, meyonSimulator, sync, integrationKey: env.MEYON_BASE_URL ? env.MEYON_INTEGRATION_KEY : undefined, signingKey, meyonKeysUrl,
  generator, model, accessToken: allowUatToken ? required('DEMO_ACCESS_TOKEN') : (env.DEMO_ACCESS_TOKEN ?? ''), allowUatToken, logger: true,
  demoStore, verifyUser, sessionSecret: env.BUILDER_SESSION_SECRET,
  publicBaseUrl: env.PUBLIC_DEMO_BASE_URL || (env.STUDIO_HOST ? 'https://' + env.STUDIO_HOST : undefined),
  // FRONTEND_ORIGINS (comma list) and/or STUDIO_HOST (host name injected by the Render blueprint).
  origins: [...(env.FRONTEND_ORIGINS || (env.STUDIO_HOST ? '' : 'http://localhost:5173')).split(','), ...(env.STUDIO_HOST ? ['https://' + env.STUDIO_HOST] : [])].map(s => s.trim()).filter(Boolean),
});
await app.listen({ port, host: '0.0.0.0' });
