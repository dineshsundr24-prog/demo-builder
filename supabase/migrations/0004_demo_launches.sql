-- MEYON Demo Builder v2: launches from MEYON (Phase A2).
--
-- A launch is MEYON handing one reviewed demo request to the Builder:
--   MEYON issues a short-lived, single-use launch grant -> the browser carries only an opaque code ->
--   the Builder API exchanges the code server-to-server with its own integration key -> the returned
--   launch package (approved story, criteria, reviewed prompt, mode, baseline) is recorded here ->
--   the user confirms it in the Builder -> generation starts (Create) or the baseline opens (Extend).
--
--   * grant_id is unique: a launch package can be recorded only once (replay protection on top of
--     MEYON's own single-use consumption).
--   * base_demo_id is what MEYON asked for; it is checked against the workspace on every use and has no
--     foreign key, so a request for a missing or foreign demo is recorded, never trusted.
--   * Same access model as 0002: RLS on, no browser policies or grants; only the API's server role.
--   * Additive only.

do $$
begin
  if to_regclass('public.demo_launches') is not null then
    raise exception 'Demo Builder migration 0004 aborted: demo_launches already exists';
  end if;
end $$;

create table public.demo_launches (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  principal_id   uuid references public.principals(id) on delete set null,
  grant_id       text not null unique check (char_length(grant_id) between 1 and 80),
  project_ref    text not null check (char_length(project_ref) between 1 and 200),
  story_ref      text not null check (char_length(story_ref) between 1 and 80),
  story_version  integer not null check (story_version > 0),
  mode           text not null check (mode in ('create', 'extend')),
  channel        text not null check (channel in ('mobile', 'portal')),
  base_demo_id   uuid,
  base_version   integer check (base_version is null or base_version > 0),
  package        jsonb not null check (jsonb_typeof(package) = 'object'),
  package_hash   text not null check (package_hash ~ '^[0-9a-f]{64}$'),
  status         text not null default 'pending' check (status in ('pending', 'confirming', 'confirmed', 'cancelled')),
  demo_id        uuid references public.demos(id) on delete set null,
  job_id         uuid,
  created_at     timestamptz not null default now(),
  confirmed_at   timestamptz,
  check ((mode = 'extend') = (base_demo_id is not null and base_version is not null))
);
create index demo_launches_workspace_idx on public.demo_launches(workspace_id, created_at desc);
create index demo_launches_demo_idx on public.demo_launches(demo_id) where demo_id is not null;

alter table public.demo_launches enable row level security;
revoke all on public.demo_launches from anon, authenticated;
grant select, insert, update on public.demo_launches to service_role;
