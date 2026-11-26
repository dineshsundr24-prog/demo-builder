// Guarded runner for migration 0002 (Supabase Management API), same safeguards as apply-remote.ts.
//   node supabase/scripts/apply-0002.ts --preflight   identity + state check only
//   node supabase/scripts/apply-0002.ts --apply       preflight, migration (one transaction), verification, live tests
//   node supabase/scripts/apply-0002.ts --verify      verification + live tests only
//   node supabase/scripts/apply-0002.ts --apply-0003  apply 0003 (server-role grants), then verify
//   node supabase/scripts/apply-0002.ts --apply-0004  apply 0004 (launches from MEYON), then verify
//   node supabase/scripts/apply-0002.ts --apply-0005  apply 0005 (sync events outbox), then verify
// The access token comes from the environment; it is never printed. Only the hard-coded project is touched.
import { readFileSync } from 'node:fs';

const REF = 'cmmpmakaozsghampempl';
const EXPECTED_NAME = 'meyon-demo-builder';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected';
const NEW = ['principals', 'workspaces', 'workspace_members', 'demos', 'demo_versions', 'demo_publications'];
const LAUNCHES = 'demo_launches';
const file = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

async function api(path: string, body?: unknown) {
  const res = await fetch('https://api.supabase.com/v1/projects/' + REF + path, {
    method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw Error('Management API ' + (body ? 'POST' : 'GET') + ' ' + (path || '/') + ' -> HTTP ' + res.status + ': ' + text.slice(0, 500));
  return text ? JSON.parse(text) : null;
}
const sql = (query: string) => api('/database/query', { query });

async function preflight() {
  const p = await api('');
  if (p.ref !== REF && p.id !== REF) throw Error('Ref mismatch: API returned ' + (p.ref ?? p.id));
  if (p.name !== EXPECTED_NAME) throw Error('ABORT: project ' + REF + ' is named "' + p.name + '", expected "' + EXPECTED_NAME + '"');
  console.log('target verified:', { ref: REF, name: p.name, region: p.region, status: p.status });
  const rows = await sql("select table_name from information_schema.tables where table_schema='public'");
  const names = rows.map((r: any) => r.table_name as string);
  if (!names.includes('generation_jobs')) throw Error('ABORT: migration 0001 is not applied');
  const already = NEW.filter(t => names.includes(t));
  console.log('0002 tables already present:', already);
  return already;
}

async function verify() {
  const tables = await sql("select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any(array['" + NEW.join("','") + "'])");
  if (tables.length !== NEW.length) throw Error('Missing tables: ' + NEW.filter(t => !tables.some((r: any) => r.relname === t)).join(', '));
  const noRls = tables.filter((r: any) => !r.relrowsecurity).map((r: any) => r.relname);
  if (noRls.length) throw Error('RLS not enabled on: ' + noRls.join(', '));
  const policies = await sql("select tablename, policyname from pg_policies where schemaname='public' and tablename = any(array['" + NEW.join("','") + "'])");
  if (policies.length) throw Error('Unexpected policies (browsers must have no access): ' + JSON.stringify(policies));
  const grants = await sql("select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and table_name = any(array['" + NEW.join("','") + "'])");
  if (grants.length) throw Error('Browser roles still have table grants: ' + JSON.stringify(grants.slice(0, 5)));
  const fn = await sql("select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authed, has_function_privilege('service_role', p.oid, 'execute') as service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('demo_save_version','demo_set_primary','demo_fork')");
  for (const f of fn) if (f.anon || f.authed || !f.service) throw Error('Function privileges wrong for ' + f.proname + ': ' + JSON.stringify(f));
  if (fn.length !== 3) throw Error('Expected 3 functions, found ' + fn.length);
  const col = await sql("select 1 from information_schema.columns where table_schema='public' and table_name='generation_jobs' and column_name='principal_id'");
  if (!col.length) throw Error('generation_jobs.principal_id missing');
  const svc = await sql("select t, has_table_privilege('service_role', 'public.' || t, 'insert') as ins, has_table_privilege('service_role', 'public.' || t, 'update') as upd from unnest(array['" + NEW.join("','") + "']) t");
  const missing = svc.filter((r: any) => !r.ins).map((r: any) => r.t);
  if (missing.length) throw Error('service_role cannot write: ' + missing.join(', '));
  if (svc.find((r: any) => r.t === 'demo_versions').upd) throw Error('service_role can update immutable versions');
  console.log('verified: API server role can write the new tables and cannot update versions');
  console.log('verified: 6 tables with RLS, 0 browser policies, 0 browser grants, 3 service-only functions, job ownership column');
  // Live behaviour tests, rolled back (no test data remains). Any failed check raises an exception.
  await sql('begin;\n' + file('../tests/demos_test.sql') + '\nrollback;');
  const left = await sql("select (select count(*) from public.principals where subject in ('user-1','launch-1')) as p, (select count(*) from public.workspaces where name in ('W1','W2')) as w");
  if (Number(left[0].p) || Number(left[0].w)) throw Error('Test data was not rolled back');
  console.log('live security and behaviour tests passed (rolled back, no test data left)');
  const hasLaunches = (await sql("select to_regclass('public.demo_launches') is not null as ok"))[0].ok;
  if (!hasLaunches) { console.log('0004 (demo_launches) not applied yet'); return; }
  const l = (await sql("select c.relrowsecurity as rls, (select count(*) from pg_policies where schemaname='public' and tablename='demo_launches')::int as policies, has_table_privilege('anon','public.demo_launches','select') as anon, has_table_privilege('authenticated','public.demo_launches','select') as authed, has_table_privilege('service_role','public.demo_launches','insert') as ins, has_table_privilege('service_role','public.demo_launches','delete') as del from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='demo_launches'"))[0];
  if (!l.rls || l.policies || l.anon || l.authed || !l.ins || l.del) throw Error('demo_launches privileges wrong: ' + JSON.stringify(l));
  await sql('begin;\n' + file('../tests/launches_test.sql') + '\nrollback;');
  const leftL = await sql("select count(*)::int as n from public.demo_launches where grant_id like 'grant-%'");
  if (leftL[0].n) throw Error('Launch test data was not rolled back');
  console.log('verified: demo_launches has RLS, no browser access, server role can insert but not delete; live launch tests passed (rolled back)');
  if (!(await sql("select to_regclass('public.demo_events') is not null as ok"))[0].ok) { console.log('0005 (demo_events) not applied yet'); return; }
  const ev = (await sql("select c.relrowsecurity as rls, (select count(*) from pg_policies where schemaname='public' and tablename='demo_events')::int as policies, has_table_privilege('anon','public.demo_events','select') as anon, has_table_privilege('authenticated','public.demo_events','select') as authed, has_table_privilege('service_role','public.demo_events','insert') as ins, has_table_privilege('service_role','public.demo_events','delete') as del from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='demo_events'"))[0];
  if (!ev.rls || ev.policies || ev.anon || ev.authed || !ev.ins || ev.del) throw Error('demo_events privileges wrong: ' + JSON.stringify(ev));
  await sql('begin;\n' + file('../tests/events_test.sql') + '\nrollback;');
  console.log('verified: demo_events has RLS, no browser access, server role can insert but not delete; live event tests passed (rolled back)');
}

const mode = process.argv[2];
if (!['--preflight', '--apply', '--verify', '--apply-0003', '--apply-0004', '--apply-0005'].includes(mode)) { console.log('usage: --preflight | --apply | --verify | --apply-0003 | --apply-0004 | --apply-0005'); process.exit(2); }
const already = await preflight();
if (mode === '--apply') {
  if (already.length) throw Error('ABORT: 0002 tables already exist; refusing to re-apply');
  await sql('begin;\n' + file('../migrations/0002_demos_versions_auth.sql') + '\ncommit;');
  console.log('migration 0002 applied');
}
if (mode === '--apply-0003') {
  if (already.length !== NEW.length) throw Error('ABORT: 0002 is not fully applied');
  await sql('begin;\n' + file('../migrations/0003_service_role_grants.sql') + '\ncommit;');
  console.log('migration 0003 applied');
}
if (mode === '--apply-0004') {
  if (already.length !== NEW.length) throw Error('ABORT: 0002 is not fully applied');
  if ((await sql("select to_regclass('public." + LAUNCHES + "') is not null as ok"))[0].ok) throw Error('ABORT: 0004 already applied');
  await sql('begin;\n' + file('../migrations/0004_demo_launches.sql') + '\ncommit;');
  console.log('migration 0004 applied');
}
if (mode === '--apply-0005') {
  if (!(await sql("select to_regclass('public.demo_launches') is not null as ok"))[0].ok) throw Error('ABORT: 0004 is not applied');
  if ((await sql("select to_regclass('public.demo_events') is not null as ok"))[0].ok) throw Error('ABORT: 0005 already applied');
  await sql('begin;\n' + file('../migrations/0005_demo_events.sql') + '\ncommit;');
  console.log('migration 0005 applied');
}
if (mode !== '--preflight') await verify();
