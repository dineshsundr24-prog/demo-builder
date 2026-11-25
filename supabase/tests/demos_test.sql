-- Tests for migration 0002 (run inside a transaction; raises on the first failure).
do $$
declare
  p1 uuid; p2 uuid; w1 uuid; w2 uuid; d1 uuid; d2 uuid; v public.demo_versions; f public.demos; n int; ok boolean;
begin
  insert into public.principals(provider, subject, display_name) values ('supabase', 'user-1', 'One') returning id into p1;
  insert into public.principals(provider, subject, display_name) values ('meyon', 'launch-1', 'Two') returning id into p2;
  insert into public.workspaces(name, kind) values ('W1', 'personal') returning id into w1;
  insert into public.workspaces(name, kind, external_ref) values ('W2', 'meyon', 'tenant-x') returning id into w2;
  insert into public.workspace_members values (w1, p1, 'owner', now()), (w2, p2, 'editor', now());

  -- duplicate principal identity rejected
  begin insert into public.principals(provider, subject) values ('supabase', 'user-1'); raise exception 'FAIL duplicate principal';
  exception when unique_violation then null; end;
  -- one workspace per external tenant
  begin insert into public.workspaces(name, kind, external_ref) values ('dup', 'meyon', 'tenant-x'); raise exception 'FAIL duplicate tenant workspace';
  exception when unique_violation then null; end;
  -- unknown application type rejected
  begin insert into public.demos(workspace_id, name, channel, draft) values (w1, 'x', 'tv', '{}'); raise exception 'FAIL channel';
  exception when check_violation then null; end;

  insert into public.demos(workspace_id, name, channel, draft, created_by) values (w1, 'Mobile app', 'mobile', '{"screens":[1]}', p1) returning id into d1;
  -- versions: numbered, immutable, concurrency-checked
  v := public.demo_save_version(d1, p1, 1, repeat('a', 64), 'first', '{}');
  if v.number <> 1 then raise exception 'FAIL first version number %', v.number; end if;
  update public.demos set draft = '{"screens":[1,2]}', draft_revision = draft_revision + 1 where id = d1;
  v := public.demo_save_version(d1, p1, 2, repeat('b', 64), 'second', '{}');
  if v.number <> 2 or v.parent_version_id is null then raise exception 'FAIL second version'; end if;
  select latest_version into n from public.demos where id = d1;
  if n <> 2 then raise exception 'FAIL latest_version %', n; end if;
  begin perform public.demo_save_version(d1, p1, 1, repeat('c', 64), 'stale', '{}'); raise exception 'FAIL stale revision accepted';
  exception when serialization_failure then null; end;
  begin update public.demo_versions set note = 'changed' where demo_id = d1; raise exception 'FAIL version updated';
  exception when raise_exception then
    if sqlerrm not like '%immutable%' then raise; end if;
  end;

  -- primary: at most one per workspace+project+type, switching is atomic
  insert into public.demos(workspace_id, name, channel, draft) values (w1, 'Mobile v2', 'mobile', '{}') returning id into d2;
  perform public.demo_set_primary(d1);
  perform public.demo_set_primary(d2);
  select count(*) into n from public.demos where workspace_id = w1 and channel = 'mobile' and is_primary;
  if n <> 1 then raise exception 'FAIL primary count %', n; end if;
  select is_primary into ok from public.demos where id = d2;
  if not ok then raise exception 'FAIL primary not switched'; end if;
  begin update public.demos set is_primary = true where id = d1; raise exception 'FAIL two primaries';
  exception when unique_violation then null; end;
  -- a primary portal in the same workspace is independent
  insert into public.demos(workspace_id, name, channel, draft, is_primary) values (w1, 'Portal', 'portal', '{}', true);

  -- fork copies the version into a new independent demo
  select * into v from public.demo_versions where demo_id = d1 and number = 1;
  f := public.demo_fork(v.id, p1, 'Experiment');
  if f.draft <> '{"screens":[1]}'::jsonb or f.forked_from_version_id <> v.id or f.is_primary or f.latest_version <> 0 then raise exception 'FAIL fork'; end if;

  -- cross-workspace references are impossible
  begin insert into public.demo_versions(demo_id, workspace_id, number, document, content_hash) values (d1, w2, 9, '{}', repeat('d', 64)); raise exception 'FAIL cross-workspace version';
  exception when foreign_key_violation then null; end;
  begin insert into public.demo_publications(demo_id, workspace_id, version_id, token_hash) values (d2, w1, v.id, repeat('e', 64)); raise exception 'FAIL publication of another demo''s version';
  exception when foreign_key_violation then null; end;
  insert into public.demo_publications(demo_id, workspace_id, version_id, token_hash) values (d1, w1, v.id, repeat('f', 64));

  -- jobs record their principal
  insert into public.generation_jobs(status, request, brief, token_budget, trace_id, principal_id) values ('planning', '{}', 'b', 1000, 'trace-1', p1);
  raise notice 'DEMOS_TESTS_PASSED';
end $$;

-- Browsers (anon / authenticated) can neither read nor call anything.
set local role authenticated;
do $$ begin
  begin perform 1 from public.demos limit 1; raise exception 'FAIL authenticated can read demos';
  exception when insufficient_privilege then null; end;
  begin perform public.demo_set_primary(gen_random_uuid()); raise exception 'FAIL authenticated can call functions';
  exception when insufficient_privilege then null; end;
  raise notice 'DEMOS_PRIVILEGES_PASSED';
end $$;
reset role;
