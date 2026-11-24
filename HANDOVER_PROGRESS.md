# HANDOVER_PROGRESS

## Current state
- **Branch:** `v2/foundation` (pushed). The deployed `feat/standalone-foundation` is untouched; v1 still builds and passes its 220 tests on this branch.
- **Phase 0:** complete, including the live structured-output check.
- **Phase 1 (schema and runtime):** complete.
- **Phase 2 (generation engine):** **complete.** Supabase migration 0001 applied to `meyon-demo-builder` (24 Nov 2026) and verified.
- **Owner decisions:** v2 rewrite · Supabase (DB, auth, storage) · no v1 hotfix · USD 50/month for AI and hosting combined.

## Run everything
```bash
npm install
npm run v2:check   # type checks + 38 unit/contract/API tests + 11 Playwright tests
npm run v2:api:fake   # local API with a zero-cost fake AI (token: e2e-token, port 8788)
npm test           # v1 suite (unchanged)
npm run dev -w @demo/studio   # preview at http://localhost:5173
```

## Phase 2: generation engine (live evidence, 24 Nov 2026, gpt-4.1-mini-2025-04-14)

| Run | Brief | Result | Screens | Time | Cost |
|---|---|---|---|---|---|
| Kapiko mobile (final) | `packages/generator/fixtures/kapiko-brief.md` (handover format) | completed, 0 errors | 12 (11 valid, 1 repaired) | 27 s | USD 0.024 |
| Staff Portal (final) | `packages/generator/fixtures/staff-portal-brief.md` | completed, 0 errors, 0 warnings | 7 (all valid) | 17 s | USD 0.015 |

Generated documents are kept as replay fixtures in `packages/generator/fixtures/live/` (fictional data). Total live AI spend so far: about USD 0.20 across 8 runs.

### What live runs found (and what was fixed)
1. **Divider collapse.** Strict mode emits keys in schema order, and `type` was last, so a node that started with `"type"` only matched the prop-less Divider. Fix: discriminator first in every component; a schema test enforces it.
2. **Structurally valid but empty or repetitive screens passed.** Fix: quality checks (`quality.empty`, `quality.repetitive`, `quality.artifact`) are errors, so repair or fallback runs.
3. **Over-long labels.** Strict mode cannot carry length limits. Fix: limits go into descriptions, plus deterministic shortening before any paid repair.
4. **Cross-screen bindings** (unwritten state, wrong record fields). Fix: a post-assembly refinement pass (at most 6 calls) told which keys and fields exist, plus a validator check for record fields.
5. **Inconsistent sample data between screens.** Fix: the plan defines shared `sampleFacts`.
6. **Dead-end or unreachable screens.** Fix: deterministic links from the plan, reported.
7. **Stray `},{` artifacts.** Fix: a deep check plus deterministic clean-up.

### Components
- `packages/generator`: brief parser, planner, per-screen generation, repair, fallback, assembly, orchestrator (budgets, retries, regenerate, retry-failed), `MemoryStore` and `SupabaseStore`, `scripts/live-run.ts`.
- `apps/api`: Fastify API (`/api/v2/jobs`, approve, status, document, retry, regenerate, cancel, SSE events). `.env.example` lists the variables.
- `apps/studio`: "Generate with AI" panel (brief, editable plan, live progress with cost, per-screen regenerate, retry failed).

### Supabase (migration 0001, applied 24 Nov 2026)
- Target verified through the Management API before execution: ref `cmmpmakaozsghampempl`, name `meyon-demo-builder`, ACTIVE_HEALTHY, 0 public tables. No other project was queried.
- Applied with `supabase/scripts/apply-remote.ts --apply` in one transaction. Result: 6 tables, RLS on all, 7 policies, 0 `anon` grants.
- Live security suite (`supabase/tests/rls_test.sql`) passed on the project, then rolled back; 0 test users left. A deliberate failing probe confirmed failures surface (HTTP 400).
- App-level integration test (`packages/generator/test/supabase.int.test.ts`, fake AI) passed: job, 12 screens, document and usage saved; reload from a fresh store; single-screen regeneration; test data cleaned up.
- A real Kapiko run was persisted: job `1889acc8-…`, 12/12 valid, USD 0.025. It exposed a lost-update race on job totals, now fixed and tested.
- Security model and open gaps: `docs/v2/SECURITY.md`.
- **Owner action:** revoke the Supabase personal access token used for the migration, and delete it from the `demo-builder` cloud environment's network secrets.

## Next: Phase 3 (Visual Studio editor)
Puck on top of the shared runtime; config generated from the registry; select, edit, drag and drop of nested components; inspector; undo; screens panel; mobile header and footer placement. Exit gate: Playwright editing tests.

## Environment notes
- Cloud environment `demo-builder`: `api.openai.com` and the Supabase project host are reachable; keys are proxy-injected network secrets (OpenAI as Bearer, Supabase as `apikey`).
- Node fetch there needs `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` with placeholder values `OPENAI_API_KEY=proxy-injected SUPABASE_SECRET_KEY=proxy-injected`.
