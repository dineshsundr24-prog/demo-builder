-- Demo Builder v2 — migration 0001: projects, versions, generation jobs, publications, usage.
-- Target: the meyon-demo-builder Supabase project ONLY. Runs in one transaction and
-- refuses to run if any of its tables already exist (no partial or repeated apply).
--
-- Security model
--   * Every table has row-level security. End users (role "authenticated") can only
--     see their own rows; "anon" has no privileges at all.
--   * Generation jobs, job screens and usage rows are written only by the API with the
--     service role (which bypasses RLS); the API must therefore authorise every request
--     itself (see docs/v2/SECURITY.md).
--   * Cross-tenant references are prevented by composite foreign keys, not only by RLS.

begin;

do $$
declare existing text;
begin
  select string_agg(table_name, ', ') into existing
  from information_schema.tables
  where table_schema = 'public'
    and table_name in ('projects','project_versions','generation_jobs','generation_screens','publications','usage_events');
  if existing is not null then
    raise exception 'Demo Builder migration 0001 aborted: tables already exist (%)', existing;
  end if;
end $$;

-- gen_random_uuid() is built into Postgres 13+; no extension required.

-- ---------- Tables ----------
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  channel      text not null check (channel in ('mobile','portal')),
  brief        text not null default '' check (char_length(brief) <= 60000),
  guidelines   jsonb not null default '{}'::jsonb,
  draft        jsonb,                      -- current editable DemoDocument v2
  draft_rev    integer not null default 0 check (draft_rev >= 0), -- optimistic concurrency
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, owner_id)                    -- target of composite FKs below
);
create index projects_owner_idx on public.projects(owner_id, updated_at desc);

-- Immutable snapshots (Save version, Publish, generation completion).
create table public.project_versions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  number      integer not null check (number > 0),
  document    jsonb not null,
  reason      text not null check (reason in ('manual','generation','publish','restore','migration')),
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (project_id, number),
  unique (id, project_id)                  -- lets publications prove version belongs to project
);

create table public.generation_jobs (
  id            uuid primary key default gen_random_uuid(),
  -- Nullable until accounts/server projects exist (Phase 6). When both are set, the
  -- composite FK guarantees the job's owner also owns the project.
  project_id    uuid,
  owner_id      uuid references auth.users(id) on delete cascade,
  request       jsonb not null,            -- {name, company, channel, guidelines}; never secrets
  brief         text not null check (char_length(brief) <= 60000),
  document      jsonb,                     -- assembled DemoDocument v2 when finished
  warnings      jsonb not null default '[]'::jsonb,
  trace_id      text not null check (char_length(trace_id) between 4 and 64),
  status        text not null check (status in ('planning','awaiting_plan_approval','generating','linking','completed','completed_with_warnings','failed','cancelled')),
  plan          jsonb,
  error         jsonb,                     -- {category, message, traceId}
  model         text,
  input_tokens  integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  token_budget  integer not null check (token_budget > 0),
  cost_usd      numeric(10,5) not null default 0 check (cost_usd >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz,
  foreign key (project_id, owner_id) references public.projects(id, owner_id) on delete cascade
);
create index generation_jobs_project_idx on public.generation_jobs(project_id, created_at desc);
create index generation_jobs_owner_idx on public.generation_jobs(owner_id, created_at desc);

-- One row per planned screen, so completed work survives retries and restarts.
create table public.generation_screens (
  job_id        uuid not null references public.generation_jobs(id) on delete cascade,
  screen_id     text not null check (char_length(screen_id) between 1 and 64),
  position      integer not null check (position >= 0),
  title         text not null,
  status        text not null check (status in ('pending','running','valid','repaired','fallback','failed')),
  attempts      smallint not null default 0 check (attempts >= 0),
  screen        jsonb,
  issues        jsonb not null default '[]'::jsonb,
  input_tokens  integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  updated_at    timestamptz not null default now(),
  primary key (job_id, screen_id)
);

create table public.publications (
  id            text primary key check (id ~ '^[A-Za-z0-9_-]{16,64}$'), -- unguessable slug for /p/:id
  project_id    uuid not null,
  version_id    uuid not null,
  owner_id      uuid not null references auth.users(id) on delete cascade,
  passcode_hash text,                     -- optional viewer passcode (hash only)
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  -- The publisher must own the project, and the version must belong to that project.
  foreign key (project_id, owner_id) references public.projects(id, owner_id) on delete cascade,
  foreign key (version_id, project_id) references public.project_versions(id, project_id) on delete cascade
);
create index publications_project_idx on public.publications(project_id);
create index publications_owner_idx on public.publications(owner_id);
create index publications_version_idx on public.publications(version_id, project_id);

-- Cost accounting for budget enforcement (per user and globally).
create table public.usage_events (
  id            bigint generated always as identity primary key,
  owner_id      uuid references auth.users(id) on delete set null,
  job_id        uuid references public.generation_jobs(id) on delete set null,
  kind          text not null check (kind in ('plan','screen','repair','assist')),
  model         text not null,
  input_tokens  integer not null check (input_tokens >= 0),
  cached_tokens integer not null default 0 check (cached_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  cost_usd      numeric(10,5) not null check (cost_usd >= 0),
  created_at    timestamptz not null default now()
);
create index usage_events_month_idx on public.usage_events(owner_id, created_at);
create index usage_events_created_idx on public.usage_events(created_at);
create index usage_events_job_idx on public.usage_events(job_id);

-- ---------- updated_at maintenance ----------
create function public.set_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger projects_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger generation_jobs_updated_at before update on public.generation_jobs for each row execute function public.set_updated_at();
create trigger generation_screens_updated_at before update on public.generation_screens for each row execute function public.set_updated_at();
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- ---------- Privileges (defence in depth; RLS still applies) ----------
revoke all on public.projects, public.project_versions, public.generation_jobs, public.generation_screens, public.publications, public.usage_events from anon, authenticated;
revoke all on sequence public.usage_events_id_seq from anon, authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert on public.project_versions to authenticated;     -- versions are immutable
grant select on public.generation_jobs, public.generation_screens, public.usage_events to authenticated;
grant select, insert, update, delete on public.publications to authenticated;
grant all on public.projects, public.project_versions, public.generation_jobs, public.generation_screens, public.publications, public.usage_events to service_role;
grant usage, select on sequence public.usage_events_id_seq to service_role;

-- ---------- Row-level security ----------
alter table public.projects           enable row level security;
alter table public.project_versions   enable row level security;
alter table public.generation_jobs    enable row level security;
alter table public.generation_screens enable row level security;
alter table public.publications       enable row level security;
alter table public.usage_events       enable row level security;

create policy projects_owner on public.projects for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy versions_owner_read on public.project_versions for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy versions_owner_insert on public.project_versions for insert to authenticated
  with check (created_by = (select auth.uid()) and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy jobs_owner_read on public.generation_jobs for select to authenticated
  using (owner_id = (select auth.uid()));
create policy job_screens_owner_read on public.generation_screens for select to authenticated
  using (exists (select 1 from public.generation_jobs j where j.id = job_id and j.owner_id = (select auth.uid())));
create policy publications_owner on public.publications for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy usage_owner_read on public.usage_events for select to authenticated
  using (owner_id = (select auth.uid()));

commit;
