# Demo Builder v2 — data security model (as of migration 0001)

## Database (Supabase project `meyon-demo-builder`, ref `cmmpmakaozsghampempl`)
- Six tables, all with row-level security: `projects`, `project_versions`, `generation_jobs`, `generation_screens`, `publications`, `usage_events`.
- `anon`: **no privileges** on any of them (revoked explicitly; Supabase grants them by default).
- `authenticated`: may read only its own rows; may create, edit and delete its own projects and publications; may add, but never modify, versions of its own projects; **read-only** on jobs, job screens and usage.
- Cross-tenant references are blocked by composite foreign keys, not only by RLS:
  - a job's `(project_id, owner_id)` must match the project's owner;
  - a publication's version must belong to its project, and the project to the publisher.
- Publication ids must be 16-64 random URL-safe characters (unguessable `/p/:id`).
- Tests: `supabase/tests/rls_test.sql` (two simulated users, anon, service role; always rolled back). Run locally with `node supabase/tests/run-local.ts`, which uses Supabase-like roles and default grants. The same file runs against the live project in `supabase/scripts/apply-remote.ts --apply|--verify`.

## Application layer (service role)
The API uses the Supabase **secret (service-role) key, which bypasses RLS**. Therefore:
- The key lives only in the API server environment. The browser never receives it, and the studio and runtime contain no Supabase code.
- Every API route except `/health` and `/api/v2/status` requires the access token (constant-time comparison). Mutations are rate-limited per client.
- Job and screen ids are validated (UUID / slug) before any database call. Filter values are URL-encoded, so PostgREST filter injection is not possible.
- Storage errors are logged server-side with a reference. Clients receive the reference only, never database messages.
- Budget guards run before every paid AI call (monthly USD cap, per-job token budget).

## Known gaps (accepted for NONPROD, scheduled)
| Gap | Risk | Plan |
|---|---|---|
| One shared access token; no per-user identity in the API | Anyone holding the token can read or act on any job whose UUID they know | Phase 6: Supabase Auth sessions; the API sets `owner_id` and checks it on every job route (or uses a user-scoped client so RLS applies) |
| Jobs are created with `owner_id = null` | Visible only to the service role; no user can see them in Supabase directly | Same as above |
| In-memory rate limiting | Resets on restart; per instance only | Move to a database/edge rate limit before multi-instance deployment |
| Briefs and documents are stored in plain JSONB | Customer data must not be entered (fictional demos only) | Product guidance plus a UI warning; encryption at rest is provided by Supabase |
| Management API token used for migration 0001 | Account-wide scope | **Revoke immediately after the migration** |
