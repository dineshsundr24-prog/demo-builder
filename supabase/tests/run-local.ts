// Applies migration 0001 to an in-process Postgres (PGlite) configured like Supabase
// (roles, default grants, auth.uid()) and runs the RLS/privilege tests. No network.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const db = new PGlite();
const notices: string[] = [];
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant anon, authenticated, service_role to current_user;
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase grants everything on new public tables to these roles by default.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create schema auth; grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
`);
await db.exec(file('../migrations/0001_init.sql'));
const tables = await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema='public' order by 1`);
console.log('tables:', tables.rows.map(r => r.table_name).join(', '));
// Re-running must refuse.
try { await db.exec(file('../migrations/0001_init.sql')); console.log('FAIL: second run was accepted'); process.exit(1); }
catch (e: any) { console.log('second run refused:', String(e.message).slice(0, 90)); await db.exec('rollback'); }
const res = await db.exec(file('./rls_test.sql'), { onNotice: (n: any) => notices.push(n.message) } as any).catch((e: any) => { console.log('RLS TESTS FAILED:', e.message); process.exit(1); });
void res;
console.log(notices.includes('RLS_TESTS_PASSED') ? 'RLS_TESTS_PASSED' : 'RLS tests did not report success: ' + notices.join(' | '));
if (!notices.includes('RLS_TESTS_PASSED')) process.exit(1);

// ---------- Migration 0002: demos, versions, publications, principals ----------
await db.exec(file('../migrations/0002_demos_versions_auth.sql'));
try { await db.exec(file('../migrations/0002_demos_versions_auth.sql')); console.log('FAIL: 0002 second run was accepted'); process.exit(1); }
catch (e: any) { console.log('0002 second run refused:', String(e.message).slice(0, 80)); await db.exec('rollback').catch(() => {}); }
const notices2: string[] = [];
await db.exec('begin; ' + file('./demos_test.sql') + ' rollback;', { onNotice: (n: any) => notices2.push(n.message) } as any)
  .catch((e: any) => { console.log('DEMOS TESTS FAILED:', e.message); process.exit(1); });
for (const want of ['DEMOS_TESTS_PASSED', 'DEMOS_PRIVILEGES_PASSED']) {
  if (!notices2.includes(want)) { console.log('missing', want, notices2.join(' | ')); process.exit(1); }
  console.log(want);
}
