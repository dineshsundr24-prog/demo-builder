// Guarded remote migration runner (Supabase Management API).
//   node supabase/scripts/apply-remote.ts --preflight   identity + existing-table check only
//   node supabase/scripts/apply-remote.ts --apply       preflight, migration, verification, RLS tests
// The access token is supplied by the environment (Authorization header); it is never printed.
// Every request targets the single hard-coded project ref below.
import { readFileSync } from 'node:fs';

const REF = 'cmmpmakaozsghampempl';
const EXPECTED_NAME = 'meyon-demo-builder';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected';
const TABLES = ['projects', 'project_versions', 'generation_jobs', 'generation_screens', 'publications', 'usage_events'];
const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

async function api(path: string, body?: unknown) {
  const res = await fetch('https://api.supabase.com/v1/projects/' + REF + path, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw Error('Management API ' + (body ? 'POST' : 'GET') + ' ' + (path || '/') + ' -> HTTP ' + res.status + ': ' + text.slice(0, 400));
  return text ? JSON.parse(text) : null;
}
const sql = (query: string) => api('/database/query', { query });

async function preflight() {
  const p = await api('');
  if (p.ref !== REF && p.id !== REF) throw Error('Ref mismatch: API returned ' + (p.ref ?? p.id));
  if (p.name !== EXPECTED_NAME) throw Error('ABORT: project ' + REF + ' is named "' + p.name + '", expected "' + EXPECTED_NAME + '"');
  console.log('target verified:', { ref: REF, name: p.name, region: p.region, status: p.status });
  const existing = await sql("select table_name from information_schema.tables where table_schema = 'public' and table_name = any(array['" + TABLES.join("','") + "'])");
  console.log('existing target tables:', existing.map((r: any) => r.table_name));
  const other = await sql("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
  console.log('public tables before:', other[0].n);
  return existing.length;
}

const mode = process.argv[2];
const existing = await preflight();
if (mode === '--apply') {
  if (existing) throw Error('ABORT: ' + existing + ' target table(s) already exist; not applying');
  await sql(file('../migrations/0001_init.sql'));
  console.log('migration 0001 applied');
}
if (mode === '--apply' || mode === '--verify') {
  const tables = await sql("select c.relname as table, c.relrowsecurity as rls, (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname)::int as policies from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname = any(array['" + TABLES.join("','") + "']) order by 1");
  console.log('tables:', JSON.stringify(tables));
  if (tables.length !== TABLES.length || tables.some((t: any) => !t.rls)) throw Error('Verification failed: missing table or RLS disabled');
  const anon = await sql("select table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' and table_name = any(array['" + TABLES.join("','") + "'])");
  console.log('anon grants on Demo Builder tables:', anon.length);
  if (anon.length) throw Error('Verification failed: anon has privileges');
  await sql(file('../tests/rls_test.sql')); // raises on any failed check; always rolls back
  console.log('RLS/privilege tests passed on the live project (transaction rolled back)');
  const left = await sql("select count(*)::int as n from auth.users where email like 'rls-user-%@example.invalid'");
  console.log('test users left behind:', left[0].n);
}
