-- Demo Builder v2 — migration 0001 (projects, versions, generation jobs, publications, usage).
-- Run once in the Supabase SQL editor. Idempotent guards are intentionally absent: run on an empty project.
-- Every table is owner-scoped with row-level security. The API uses the
-- service role only for job workers and public publication reads.

-- gen_random_uuid() is built into Postgres 13+; no extension required.

create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 120),
  channel      text not null check (channel in ('mobile','portal')),
  brief        text not null default '' check (char_length(brief) <= 60000),
  guidelines   jsonb not null default '{}'::jsonb,
  draft        jsonb,                      -- current editable DemoDocument v2
  draft_rev    integer not null default 0, -- optimistic concurrency for saves
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index projects_owner_idx on public.projects(owner_id, updated_at desc);

-- Immutable snapshots: created by Save version, Publish and generation completion.
create table public.project_versions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  number      integer not null,
  document    jsonb not null,
  reason      text not null check (reason in ('manual','generation','publish','restore','migration')),
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (project_id, number)
);

create table public.generation_jobs (
  id            uuid primary key default gen_random_uuid(),
  -- Nullable until Phase 6 (accounts and server-side projects); jobs then belong to both.
  project_id    uuid references public.projects(id) on delete cascade,
  owner_id      uuid references auth.users(id) on delete cascade,
  request       jsonb not null,            -- {name, company, channel, guidelines} (no secrets)
  brief         text not null check (char_length(brief) <= 60000),
  document      jsonb,                     -- assembled DemoDocument v2 when finished
  warnings      jsonb not null default '[]'::jsonb,
  trace_id      text not null,
  status        text not null check (status in ('planning','awaiting_plan_approval','generating','linking','completed','completed_with_warnings','failed','cancelled')),
  plan          jsonb,                     -- locked screen list, shell, collections, journeys
  error         jsonb,                     -- {category, message, traceId}
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  token_budget  integer not null,
  cost_usd      numeric(10,5) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index generation_jobs_project_idx on public.generation_jobs(project_id, created_at desc);

-- One row per planned screen, so completed work survives retries and refreshes.
create table public.generation_screens (
  job_id        uuid not null references public.generation_jobs(id) on delete cascade,
  screen_id     text not null,
  position      integer not null,
  title         text not null,
  status        text not null check (status in ('pending','running','valid','repaired','fallback','failed')),
  attempts      smallint not null default 0,
  screen        jsonb,
  issues        jsonb not null default '[]'::jsonb,  -- validator diagnostics (path/code/message)
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (job_id, screen_id)
);

create table public.publications (
  id          text primary key,           -- short random slug used in /p/:id
  project_id  uuid not null references public.projects(id) on delete cascade,
  version_id  uuid not null references public.project_versions(id),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  passcode_hash text,                     -- optional viewer passcode
  revoked_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- Cost accounting for budget enforcement (per user and globally).
create table public.usage_events (
  id            bigint generated always as identity primary key,
  owner_id      uuid references auth.users(id) on delete set null,
  job_id        uuid references public.generation_jobs(id) on delete set null,
  kind          text not null check (kind in ('plan','screen','repair','assist')),
  model         text not null,
  input_tokens  integer not null,
  cached_tokens integer not null default 0,
  output_tokens integer not null,
  cost_usd      numeric(10,5) not null,
  created_at    timestamptz not null default now()
);
create index usage_events_month_idx on public.usage_events(owner_id, created_at);
create index usage_events_created_idx on public.usage_events(created_at);

-- ---------- Row-level security ----------
alter table public.projects           enable row level security;
alter table public.project_versions   enable row level security;
alter table public.generation_jobs    enable row level security;
alter table public.generation_screens enable row level security;
alter table public.publications       enable row level security;
alter table public.usage_events       enable row level security;

create policy projects_owner on public.projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy versions_owner_read on public.project_versions
  for select using (exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
create policy versions_owner_insert on public.project_versions
  for insert with check (created_by = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
-- Versions are immutable: no update/delete policies are defined.
create policy jobs_owner_read on public.generation_jobs
  for select using (owner_id = auth.uid());
create policy job_screens_owner_read on public.generation_screens
  for select using (exists (select 1 from public.generation_jobs j where j.id = job_id and j.owner_id = auth.uid()));
create policy publications_owner on public.publications
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy usage_owner_read on public.usage_events
  for select using (owner_id = auth.uid());
-- Jobs, job screens and usage rows are written only by the API (service role bypasses RLS).
-- Public publication reads go through the API, which checks revoked_at/passcode.
