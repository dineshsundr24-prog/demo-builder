// Live end-to-end check of A1 against the real Supabase project (Auth + database), then full cleanup.
// node supabase/scripts/live-auth-test.ts   (Supabase secret key and Management token come from the environment)
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { FakeProvider, Generator, MemoryStore, defaultConfig } from '@demo/generator';
import { buildServer } from '../../apps/api/src/server.ts';
import { SupabaseDemoStore } from '../../apps/api/src/demos/store.ts';
import { jwksVerifier } from '../../apps/api/src/demos/auth.ts';

const REF = 'cmmpmakaozsghampempl', URL_ = 'https://' + REF + '.supabase.co';
const KEY = process.env.SUPABASE_SECRET_KEY || 'proxy-injected';
const MGMT = process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected';
const doc = JSON.parse(readFileSync(new URL('../../packages/schema/fixtures/kapiko-mobile.json', import.meta.url), 'utf8'));
const ok = (cond: unknown, what: string) => { if (!cond) throw Error('FAIL: ' + what); console.log('  ✓ ' + what); };
const sql = async (query: string) => { const r = await fetch('https://api.supabase.com/v1/projects/' + REF + '/database/query', { method: 'POST', headers: { Authorization: 'Bearer ' + MGMT, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }); if (!r.ok) throw Error('SQL ' + r.status + ' ' + (await r.text()).slice(0, 200)); return r.json(); };
const admin = (path: string, init: RequestInit = {}) => fetch(URL_ + '/auth/v1/admin/' + path, { ...init, headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', ...(init.headers || {}) } });

const email = 'a1-live-test-' + randomBytes(4).toString('hex') + '@example.invalid';
const password = randomBytes(18).toString('base64url');
let userId = '';
try {
  const created = await admin('users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) });
  const cu = await created.json();
  ok(created.ok && cu.id, 'temporary confirmed user created by admin (sign-up stays disabled)');
  userId = cu.id;
  const tok = await fetch(URL_ + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const session = await tok.json();
  ok(tok.ok && session.access_token, 'password sign-in returns a session');

  const store = new SupabaseDemoStore(URL_, KEY);
  const app = await buildServer({ generator: new Generator(new MemoryStore(), new FakeProvider(() => ({})), defaultConfig), accessToken: 'uat-live-check', origins: [], model: 'fake',
    demoStore: store, verifyUser: jwksVerifier(URL_), publicBaseUrl: 'https://demo-builder-v2-studio.onrender.com' });
  const call = async (method: string, url: string, as?: 'user' | 'uat', body?: unknown) => {
    const headers: Record<string, string> = as === 'user' ? { authorization: 'Bearer ' + session.access_token } : as === 'uat' ? { 'x-builder-access': 'uat-live-check' } : {};
    const r = await app.inject({ method: method as any, url, headers, ...(body !== undefined ? { payload: body as any } : {}) });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };
  const me = await call('GET', '/api/v2/me', 'user');
  ok(me.status === 200 && me.body.workspaces[0]?.role === 'owner' && me.body.workspaces[0]?.kind === 'personal', 'first sign-in creates a personal workspace with Owner role');
  const created2 = await call('POST', '/api/v2/demos', 'user', { document: doc, name: 'Live check' });
  const id = created2.body.demo.id;
  ok(created2.status === 200 && created2.body.demo.isPrimary, 'demo saved to Supabase and made primary');
  ok((await call('PUT', `/api/v2/demos/${id}/draft`, 'user', { expectedRevision: 1, document: { ...doc, name: 'Live v2' } })).body.demo.draftRevision === 2, 'draft autosave (revision 1 → 2)');
  ok((await call('PUT', `/api/v2/demos/${id}/draft`, 'user', { expectedRevision: 1, document: doc })).status === 409, 'stale draft save refused (409)');
  const v = await call('POST', `/api/v2/demos/${id}/versions`, 'user', { expectedRevision: 2, note: 'live' });
  ok(v.body.version?.number === 1, 'immutable version 1 saved through the database function');
  const upd = await sql("update public.demo_versions set note='tamper' where id='" + v.body.version.id + "'").then(() => 'updated', (e: Error) => e.message);
  ok(/immutable/.test(upd), 'database refuses to modify a saved version');
  const pub = await call('POST', `/api/v2/demos/${id}/versions/1/publish`, 'user');
  ok(pub.status === 200 && /\?p=/.test(pub.body.url), 'published link created');
  const view = await call('GET', '/api/v2/public/' + pub.body.token);
  ok(view.status === 200 && view.body.document.name === 'Live v2' && Object.keys(view.body).sort().join() === 'channel,document,name,publishedAt,version', 'public link shows only the published demo');
  const stored = await sql("select count(*)::int as n from public.demo_publications where token_hash = '" + pub.body.token + "'");
  ok(stored[0].n === 0, 'the raw link token is not stored (only its hash)');
  ok((await call('GET', `/api/v2/demos/${id}`, 'uat')).status === 404, 'shared UAT token cannot see the personal demo');
  ok(!(await call('GET', '/api/v2/demos', 'uat')).body.demos.some((d: any) => d.id === id), 'shared UAT token cannot list the personal demo');
  ok((await call('GET', `/api/v2/demos/${id}`)).status === 401, 'no credentials → 401');
  const list = await call('GET', `/api/v2/demos/${id}`, 'user');
  await call('POST', `/api/v2/demos/${id}/publications/${list.body.publications[0].id}/revoke`, 'user');
  ok((await call('GET', '/api/v2/public/' + pub.body.token)).status === 404, 'revoked link no longer opens');
  // Checked as the browser roles inside the database (a REST probe from this container would carry the proxy's server key).
  for (const role of ['anon', 'authenticated']) {
    const denied = await sql('begin; set local role ' + role + '; select count(*) from public.demos; rollback;').then(() => 'read', (e: Error) => e.message);
    ok(/permission denied/.test(denied), 'browser role "' + role + '" cannot read demos directly from the database');
  }
  await app.close();
} finally {
  // Cleanup: everything created by this run.
  if (userId) {
    await sql("delete from public.workspaces w using public.workspace_members m, public.principals p where m.workspace_id = w.id and m.principal_id = p.id and p.provider='supabase' and p.subject='" + userId + "' and w.kind='personal'");
    await sql("delete from public.principals where provider='supabase' and subject='" + userId + "'");
    const del = await admin('users/' + userId, { method: 'DELETE' });
    console.log(del.ok ? '  ✓ cleanup: test user, workspace, demos, versions and links deleted' : 'cleanup: user delete HTTP ' + del.status);
  }
  await sql("delete from public.workspaces where kind='uat' and external_ref='uat' and not exists (select 1 from public.demos d where d.workspace_id = workspaces.id)");
  await sql("delete from public.principals p where provider='uat' and not exists (select 1 from public.workspace_members m where m.principal_id = p.id)");
}
