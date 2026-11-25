-- MEYON Demo Builder v2: persistent demos, immutable versions, publications and a
-- principal-based authorization foundation (Phase A1).
--
-- Design
--   * principals: who acts. One row per identity source + subject: Supabase Auth users today,
--     MEYON launch principals (Phase A2), the shared UAT token, and SSO providers later. SSO is
--     another provider value, not a new authorization model.
--   * workspaces + workspace_members: the tenant boundary (owner / editor / viewer).
--   * demos: one application demo (application type, project grouping, working draft with an
--     optimistic revision, primary flag, fork origin). One primary per workspace+project+type.
--   * demo_versions: immutable snapshots (UPDATE is rejected by trigger).
--   * demo_publications: read-only public links; only a SHA-256 of the token is stored.
--   * All access goes through the Builder API (service role). RLS is enabled with NO policies for
--     anon/authenticated, so browsers can never read or write these tables directly; the API
--     authorizes every request against workspace membership, role and session scope.
--   * Additive only: the unused 0001 tables (projects, project_versions, publications) are untouched.

do $$
declare existing text;
begin
  select string_agg(table_name, ', ') into existing from information_schema.tables
  where table_schema = 'public' and table_name in ('principals','workspaces','workspace_members','demos','demo_versions','demo_publications');
  if existing is not null then
    raise exception 'Demo Builder migration 0002 aborted: tables already exist (%)', existing;
  end if;
end $$;

create table public.principals (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null check (provider in ('supabase', 'meyon', 'uat', 'oidc')),
  subject       text not null check (char_length(subject) between 1 and 200),
  display_name  text not null default '' check (char_length(display_name) <= 120),
  email         text check (email is null or char_length(email) <= 254),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (provider, subject)
);

create table public.workspaces (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 120),
  kind          text not null check (kind in ('personal', 'team', 'meyon', 'uat')),
  external_ref  text check (external_ref is null or char_length(external_ref) <= 200),
  created_at    timestamptz not null default now()
);
-- One workspace per external tenant (e.g. one per MEYON tenant), and one shared UAT workspace.
create unique index workspaces_external_idx on public.workspaces(kind, external_ref) where external_ref is not null;

create table public.workspace_members (
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  principal_id  uuid not null references public.principals(id) on delete cascade,
  role          text not null check (role in ('owner', 'editor', 'viewer')),
  created_at    timestamptz not null default now(),
  primary key (workspace_id, principal_id)
);
create index workspace_members_principal_idx on public.workspace_members(principal_id);

create table public.demos (
  id                      uuid primary key default gen_random_uuid(),
  workspace_id            uuid not null references public.workspaces(id) on delete cascade,
  name                    text not null check (char_length(name) between 1 and 120),
  -- Application type: Mobile App or Staff Portal.
  channel                 text not null check (channel in ('mobile', 'portal')),
  -- Grouping for primary baselines: '' for standalone demos, the MEYON project id for MEYON demos.
  project_ref             text not null default '' check (char_length(project_ref) <= 200),
  is_primary              boolean not null default false,
  forked_from_version_id  uuid,
  latest_version          integer not null default 0 check (latest_version >= 0),
  draft                   jsonb not null check (jsonb_typeof(draft) = 'object'),
  draft_revision          integer not null default 1 check (draft_revision >= 1),
  draft_base_version      integer not null default 0 check (draft_base_version >= 0),
  draft_updated_by        uuid references public.principals(id) on delete set null,
  draft_updated_at        timestamptz not null default now(),
  created_by              uuid references public.principals(id) on delete set null,
  created_at              timestamptz not null default now(),
  archived_at             timestamptz,
  unique (id, workspace_id)
);
create index demos_workspace_idx on public.demos(workspace_id, draft_updated_at desc);
-- At most one primary (active) demo per workspace + project + application type.
create unique index demos_one_primary_idx on public.demos(workspace_id, project_ref, channel) where is_primary and archived_at is null;

create table public.demo_versions (
  id                 uuid primary key default gen_random_uuid(),
  demo_id            uuid not null,
  workspace_id       uuid not null,
  number             integer not null check (number > 0),
  document           jsonb not null check (jsonb_typeof(document) = 'object'),
  content_hash       char(64) not null,
  parent_version_id  uuid references public.demo_versions(id),
  note               text not null default '' check (char_length(note) <= 500),
  metadata           jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by         uuid references public.principals(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (demo_id, number),
  unique (id, demo_id),
  foreign key (demo_id, workspace_id) references public.demos(id, workspace_id) on delete cascade
);
alter table public.demos add constraint demos_forked_from_fk foreign key (forked_from_version_id) references public.demo_versions(id) on delete set null;

-- Versions are immutable: any UPDATE is rejected (deletion only happens when the whole demo is deleted).
create function public.demo_versions_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'demo versions are immutable';
end $$;
create trigger demo_versions_no_update before update on public.demo_versions for each row execute function public.demo_versions_immutable();

create table public.demo_publications (
  id            uuid primary key default gen_random_uuid(),
  demo_id       uuid not null,
  workspace_id  uuid not null,
  version_id    uuid not null,
  token_hash    char(64) not null unique,
  created_by    uuid references public.principals(id) on delete set null,
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  foreign key (demo_id, workspace_id) references public.demos(id, workspace_id) on delete cascade,
  foreign key (version_id, demo_id) references public.demo_versions(id, demo_id) on delete cascade
);
create index demo_publications_demo_idx on public.demo_publications(demo_id, created_at desc);

-- ---------- Atomic operations (called by the Builder API with the service role only) ----------

-- Snapshot the current draft as the next immutable version. Fails if the draft changed since the
-- caller read it (optimistic concurrency), so a version is always exactly what the user saw.
create function public.demo_save_version(p_demo uuid, p_principal uuid, p_expected_revision integer, p_content_hash text, p_note text, p_metadata jsonb)
returns public.demo_versions language plpgsql as $$
declare d public.demos; v public.demo_versions; parent uuid;
begin
  select * into d from public.demos where id = p_demo for update;
  if not found then raise exception 'demo not found' using errcode = 'P0002'; end if;
  if d.archived_at is not null then raise exception 'demo is archived' using errcode = 'P0001'; end if;
  if d.draft_revision <> p_expected_revision then raise exception 'draft changed' using errcode = '40001'; end if;
  select id into parent from public.demo_versions where demo_id = p_demo and number = d.latest_version;
  insert into public.demo_versions(demo_id, workspace_id, number, document, content_hash, parent_version_id, note, metadata, created_by)
  values (p_demo, d.workspace_id, d.latest_version + 1, d.draft, p_content_hash, parent, coalesce(p_note, ''), coalesce(p_metadata, '{}'::jsonb), p_principal)
  returning * into v;
  update public.demos set latest_version = v.number, draft_base_version = v.number where id = p_demo;
  return v;
end $$;

-- Make a demo the primary baseline of its workspace + project + type (the previous one is unset).
create function public.demo_set_primary(p_demo uuid) returns void language plpgsql as $$
declare d public.demos;
begin
  select * into d from public.demos where id = p_demo for update;
  if not found then raise exception 'demo not found' using errcode = 'P0002'; end if;
  if d.archived_at is not null then raise exception 'demo is archived' using errcode = 'P0001'; end if;
  update public.demos set is_primary = false
   where workspace_id = d.workspace_id and project_ref = d.project_ref and channel = d.channel and is_primary and id <> p_demo;
  update public.demos set is_primary = true where id = p_demo;
end $$;

-- Start an independent demo (fork) from any version; the source stays unchanged.
create function public.demo_fork(p_version uuid, p_principal uuid, p_name text) returns public.demos language plpgsql as $$
declare v public.demo_versions; src public.demos; d public.demos;
begin
  select * into v from public.demo_versions where id = p_version;
  if not found then raise exception 'version not found' using errcode = 'P0002'; end if;
  select * into src from public.demos where id = v.demo_id;
  insert into public.demos(workspace_id, name, channel, project_ref, forked_from_version_id, draft, created_by, draft_updated_by)
  values (src.workspace_id, p_name, src.channel, src.project_ref, v.id, v.document, p_principal, p_principal)
  returning * into d;
  return d;
end $$;

-- ---------- Lock down: no direct browser access ----------
alter table public.principals        enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.demos             enable row level security;
alter table public.demo_versions     enable row level security;
alter table public.demo_publications enable row level security;
revoke all on public.principals, public.workspaces, public.workspace_members, public.demos, public.demo_versions, public.demo_publications from anon, authenticated;
revoke all on function public.demo_save_version(uuid, uuid, integer, text, text, jsonb), public.demo_set_primary(uuid), public.demo_fork(uuid, uuid, text), public.demo_versions_immutable() from public, anon, authenticated;
grant execute on function public.demo_save_version(uuid, uuid, integer, text, text, jsonb), public.demo_set_primary(uuid), public.demo_fork(uuid, uuid, text) to service_role;

-- ---------- Generation jobs belong to the principal that started them (tenant isolation) ----------
alter table public.generation_jobs add column principal_id uuid references public.principals(id) on delete set null;
create index generation_jobs_principal_idx on public.generation_jobs(principal_id, created_at desc);
