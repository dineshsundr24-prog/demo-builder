-- Migration 0003: explicit privileges for the Builder API's server role on the 0002 tables.
-- Newer Supabase projects do not grant new tables to API roles by default. Browser roles (anon,
-- authenticated) stay without any access; only service_role (used by the Builder API) is granted.
grant select, insert, update, delete on public.principals, public.workspaces, public.workspace_members, public.demos, public.demo_publications to service_role;
-- Versions are append-only for the API: no UPDATE (the trigger also rejects it); DELETE only through demo deletion.
grant select, insert, delete on public.demo_versions to service_role;
