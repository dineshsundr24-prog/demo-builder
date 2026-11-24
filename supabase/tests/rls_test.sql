-- Row-level security and privilege tests for migration 0001.
-- Runs in a transaction and ROLLS BACK: nothing is left behind.
-- Simulates Supabase users the way PostgREST does (role + request.jwt.claims).
-- Every check raises an exception on failure; success ends with NOTICE 'RLS_TESTS_PASSED'.
begin;

-- Fixture users and data (as the migration owner).
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'rls-user-a@example.invalid'),
  ('22222222-2222-2222-2222-222222222222', 'rls-user-b@example.invalid');
insert into public.projects (id, owner_id, name, channel) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'A project', 'mobile'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'B project', 'portal');
insert into public.project_versions (id, project_id, number, document, reason, created_by) values
  ('aaaaaaaa-1111-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', 1, '{}', 'manual', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-1111-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b', 1, '{}', 'manual', '22222222-2222-2222-2222-222222222222');
insert into public.generation_jobs (id, project_id, owner_id, request, brief, trace_id, status, token_budget) values
  ('aaaaaaaa-2222-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '{}', 'brief A', 'trc_a', 'completed', 1000),
  ('bbbbbbbb-2222-0000-0000-00000000000b', 'bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', '{}', 'brief B', 'trc_b', 'completed', 1000);
insert into public.generation_screens (job_id, screen_id, position, title, status) values
  ('aaaaaaaa-2222-0000-0000-00000000000a', 'home', 0, 'Home', 'valid'),
  ('bbbbbbbb-2222-0000-0000-00000000000b', 'home', 0, 'Home', 'valid');
insert into public.usage_events (owner_id, job_id, kind, model, input_tokens, output_tokens, cost_usd) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-2222-0000-0000-00000000000a', 'screen', 'm', 1, 1, 0.001),
  ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-2222-0000-0000-00000000000b', 'screen', 'm', 1, 1, 0.001);

-- Integrity: a job cannot reference a project owned by someone else (even via service role).
do $$ begin
  begin
    insert into public.generation_jobs (project_id, owner_id, request, brief, trace_id, status, token_budget)
    values ('bbbbbbbb-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', '{}', 'x', 'trc_x', 'planning', 10);
    raise exception 'FAIL: job linked to another user''s project';
  exception when foreign_key_violation then null; end;
end $$;

-- ---- As user A ----
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.projects;            if n <> 1 then raise exception 'FAIL: A sees % projects', n; end if;
  select count(*) into n from public.project_versions;    if n <> 1 then raise exception 'FAIL: A sees % versions', n; end if;
  select count(*) into n from public.generation_jobs;     if n <> 1 then raise exception 'FAIL: A sees % jobs', n; end if;
  select count(*) into n from public.generation_screens;  if n <> 1 then raise exception 'FAIL: A sees % job screens', n; end if;
  select count(*) into n from public.usage_events;        if n <> 1 then raise exception 'FAIL: A sees % usage rows', n; end if;
  select count(*) into n from public.generation_jobs where brief = 'brief B'; if n <> 0 then raise exception 'FAIL: A reads B''s brief'; end if;

  update public.projects set name = 'hijacked' where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: A updated B''s project'; end if;
  delete from public.projects where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
  get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: A deleted B''s project'; end if;

  begin insert into public.projects (owner_id, name, channel) values ('22222222-2222-2222-2222-222222222222', 'spoof', 'mobile');
    raise exception 'FAIL: A created a project owned by B'; exception when insufficient_privilege then null; end;
  begin update public.projects set owner_id = '22222222-2222-2222-2222-222222222222' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
    raise exception 'FAIL: A transferred a project to B'; exception when insufficient_privilege then null; end;
  begin insert into public.project_versions (project_id, number, document, reason, created_by) values ('bbbbbbbb-0000-0000-0000-00000000000b', 2, '{}', 'manual', '11111111-1111-1111-1111-111111111111');
    raise exception 'FAIL: A added a version to B''s project'; exception when insufficient_privilege then null; end;
  begin update public.project_versions set document = '{"x":1}' where id = 'aaaaaaaa-1111-0000-0000-00000000000a';
    raise exception 'FAIL: versions are mutable'; exception when insufficient_privilege then null; end;
  -- Publishing B's version under A's own project or B's project must fail.
  begin insert into public.publications (id, project_id, version_id, owner_id) values ('pub_cross_tenant_0001', 'bbbbbbbb-0000-0000-0000-00000000000b', 'bbbbbbbb-1111-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111');
    raise exception 'FAIL: A published B''s project'; exception when insufficient_privilege or foreign_key_violation then null; end;
  begin insert into public.publications (id, project_id, version_id, owner_id) values ('pub_cross_tenant_0002', 'aaaaaaaa-0000-0000-0000-00000000000a', 'bbbbbbbb-1111-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111');
    raise exception 'FAIL: A published B''s version under A''s project'; exception when insufficient_privilege or foreign_key_violation then null; end;
  begin insert into public.publications (id, project_id, version_id, owner_id) values ('short', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-1111-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111');
    raise exception 'FAIL: guessable publication id accepted'; exception when check_violation then null; end;
  -- A legitimate publication of A's own version works.
  insert into public.publications (id, project_id, version_id, owner_id) values ('pub_valid_own_version_01', 'aaaaaaaa-0000-0000-0000-00000000000a', 'aaaaaaaa-1111-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111');
  -- Jobs, screens and usage are server-written only.
  begin insert into public.generation_jobs (owner_id, request, brief, trace_id, status, token_budget) values ('11111111-1111-1111-1111-111111111111', '{}', 'x', 'trc_y', 'planning', 10);
    raise exception 'FAIL: user inserted a job'; exception when insufficient_privilege then null; end;
  begin update public.generation_jobs set cost_usd = 0 where id = 'aaaaaaaa-2222-0000-0000-00000000000a';
    raise exception 'FAIL: user edited job cost'; exception when insufficient_privilege then null; end;
  begin insert into public.usage_events (owner_id, kind, model, input_tokens, output_tokens, cost_usd) values ('11111111-1111-1111-1111-111111111111', 'screen', 'm', 1, 1, 0);
    raise exception 'FAIL: user wrote usage'; exception when insufficient_privilege then null; end;
end $$;

-- ---- As user B: sees only B's rows (not A's new publication) ----
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$
declare n int;
begin
  select count(*) into n from public.projects where owner_id = '11111111-1111-1111-1111-111111111111'; if n <> 0 then raise exception 'FAIL: B sees A''s projects'; end if;
  select count(*) into n from public.publications; if n <> 0 then raise exception 'FAIL: B sees A''s publications'; end if;
  select count(*) into n from public.generation_jobs; if n <> 1 then raise exception 'FAIL: B sees % jobs', n; end if;
end $$;

-- ---- Anonymous: no access at all ----
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.projects; raise exception 'FAIL: anon can read projects'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.generation_jobs; raise exception 'FAIL: anon can read jobs'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.usage_events; raise exception 'FAIL: anon can read usage'; exception when insufficient_privilege then null; end;
end $$;

-- ---- Service role (the API): full access to every tenant ----
reset role;
set local role service_role;
do $$
declare n int;
begin
  select count(*) into n from public.generation_jobs where trace_id in ('trc_a', 'trc_b'); if n <> 2 then raise exception 'FAIL: service role sees % jobs', n; end if;
  update public.generation_jobs set status = 'failed' where trace_id = 'trc_b';
end $$;
reset role;

do $$ begin raise notice 'RLS_TESTS_PASSED'; end $$;
rollback;
