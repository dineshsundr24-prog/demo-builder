-- Tests for migration 0004 (run inside a transaction; raises on the first failure).
do $$
declare w uuid; p uuid; l uuid;
begin
  insert into public.principals(provider, subject, display_name) values ('meyon', 'tenant-a:shared', 'MEYON') returning id into p;
  insert into public.workspaces(name, kind, external_ref) values ('Tenant A', 'meyon', 'tenant-a') returning id into w;
  insert into public.demo_launches(workspace_id, principal_id, grant_id, project_ref, story_ref, story_version, mode, channel, package, package_hash)
    values (w, p, 'grant-1', 'PRJ-1', 'US-014', 3, 'create', 'mobile', '{"packageVersion":1}', repeat('a', 64)) returning id into l;
  -- the same grant can be recorded only once
  begin insert into public.demo_launches(workspace_id, grant_id, project_ref, story_ref, story_version, mode, channel, package, package_hash)
    values (w, 'grant-1', 'PRJ-1', 'US-014', 3, 'create', 'mobile', '{}', repeat('a', 64)); raise exception 'FAIL replayed grant accepted';
  exception when unique_violation then null; end;
  -- extend needs a baseline; create must not have one
  begin insert into public.demo_launches(workspace_id, grant_id, project_ref, story_ref, story_version, mode, channel, package, package_hash)
    values (w, 'grant-2', 'PRJ-1', 'US-014', 3, 'extend', 'mobile', '{}', repeat('a', 64)); raise exception 'FAIL extend without baseline';
  exception when check_violation then null; end;
  begin insert into public.demo_launches(workspace_id, grant_id, project_ref, story_ref, story_version, mode, channel, package, package_hash, base_demo_id, base_version)
    values (w, 'grant-3', 'PRJ-1', 'US-014', 3, 'create', 'mobile', '{}', repeat('a', 64), gen_random_uuid(), 1); raise exception 'FAIL create with baseline';
  exception when check_violation then null; end;
  begin insert into public.demo_launches(workspace_id, grant_id, project_ref, story_ref, story_version, mode, channel, package, package_hash)
    values (w, 'grant-4', 'PRJ-1', 'US-014', 3, 'create', 'web', '{}', repeat('a', 64)); raise exception 'FAIL unknown channel';
  exception when check_violation then null; end;
  begin update public.demo_launches set status = 'done' where id = l; raise exception 'FAIL unknown status';
  exception when check_violation then null; end;
  raise notice 'LAUNCHES_TESTS_PASSED';
end $$;

set local role authenticated;
do $$ begin
  begin perform 1 from public.demo_launches limit 1; raise exception 'FAIL authenticated can read launches';
  exception when insufficient_privilege then null; end;
  raise notice 'LAUNCHES_PRIVILEGES_PASSED';
end $$;
reset role;
set local role service_role;
do $$ begin
  begin delete from public.demo_launches; raise exception 'FAIL server role can delete launches';
  exception when insufficient_privilege then null; end;
  raise notice 'LAUNCHES_SERVER_ROLE_PASSED';
end $$;
reset role;
