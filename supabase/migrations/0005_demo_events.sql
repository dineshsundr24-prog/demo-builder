-- MEYON Demo Builder v2: outbox of sync events for MEYON (Phase A4).
--
-- Every change MEYON must know about (demo created, version saved with coverage, publication created or revoked,
-- primary changed, launch confirmed or cancelled) is written here first and delivered server-to-server afterwards,
-- signed, with retries and backoff until MEYON accepts it. The event id is the idempotency key on MEYON's side.
--   * next_attempt_at doubles as a short lease while a delivery is in flight, so two API instances never send the
--     same event at the same time.
--   * Payloads never contain published-link tokens or document content; only ids, numbers, statuses and coverage.
--   * Same access model as 0002/0004: RLS on, no browser policies or grants; only the API's server role.
--   * Additive only.

do $$
begin
  if to_regclass('public.demo_events') is not null then
    raise exception 'Demo Builder migration 0005 aborted: demo_events already exists';
  end if;
end $$;

create table public.demo_events (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  type             text not null check (type in ('demo.created', 'demo.version_saved', 'demo.published', 'demo.publication_revoked', 'demo.primary_changed', 'launch.confirmed', 'launch.cancelled')),
  payload          jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at       timestamptz not null default now(),
  attempts         integer not null default 0 check (attempts >= 0),
  next_attempt_at  timestamptz not null default now(),
  delivered_at     timestamptz,
  last_error       text check (last_error is null or char_length(last_error) <= 500)
);
create index demo_events_due_idx on public.demo_events(next_attempt_at) where delivered_at is null;
create index demo_events_workspace_idx on public.demo_events(workspace_id, created_at desc);

alter table public.demo_events enable row level security;
revoke all on public.demo_events from anon, authenticated;
grant select, insert, update on public.demo_events to service_role;
