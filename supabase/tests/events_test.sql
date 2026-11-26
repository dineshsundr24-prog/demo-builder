-- Tests for migration 0005 (run inside a transaction; raises on the first failure).
do $$
declare w uuid;
begin
  insert into public.workspaces(name, kind, external_ref) values ('Tenant E', 'meyon', 'tenant-e') returning id into w;
  insert into public.demo_events(workspace_id, type, payload) values (w, 'demo.version_saved', '{"version":1}');
  begin insert into public.demo_events(workspace_id, type, payload) values (w, 'demo.deleted', '{}'); raise exception 'FAIL unknown event type';
  exception when check_violation then null; end;
  begin insert into public.demo_events(workspace_id, type, payload) values (w, 'demo.created', '[]'); raise exception 'FAIL non-object payload';
  exception when check_violation then null; end;
  raise notice 'EVENTS_TESTS_PASSED';
end $$;
set local role authenticated;
do $$ begin
  begin perform 1 from public.demo_events limit 1; raise exception 'FAIL authenticated can read events';
  exception when insufficient_privilege then null; end;
  raise notice 'EVENTS_PRIVILEGES_PASSED';
end $$;
reset role;
set local role service_role;
do $$ begin
  begin delete from public.demo_events; raise exception 'FAIL server role can delete events';
  exception when insufficient_privilege then null; end;
  raise notice 'EVENTS_SERVER_ROLE_PASSED';
end $$;
reset role;
