# HANDOVER_PROGRESS

## Current state
- **Branch:** `v2/foundation`, created from `feat/standalone-foundation@05a82ee`. The deployed branch is untouched.
- **Phase:** 0 (spikes and decisions). **Complete except for the live model check.**
- **Owner decisions:** v2 rewrite approved · Supabase (DB, auth, storage) · no v1 hotfix · USD 50/month for AI and hosting combined.

## Phase 0 outcome

| Item | Result | Evidence |
|---|---|---|
| Single registry → validator + strict AI schema | ✅ | `spikes/v2-schema`: `node --test src/*.test.ts` gives **7/7**. The synthetic 12-screen Kapiko doc is valid, 40 screens are valid, every v1 failure shape is rejected with an exact path. |
| Strict schema form | ✅ Recursive | ~3.2k tokens, strict-lint clean. The unrolled form is 10× larger and exceeds the 1,000-enum limit, so it is rejected. `node src/report.ts` |
| Editor library | ✅ Puck 0.24.0 (fallback: dnd-kit) | `spikes/editor-puck/e2e.cjs` in Chromium: nested select and edit, drag into a nested slot, undo, phone viewport, no page errors. Lossless v2 ↔ Puck conversion on all 12 screens. |
| Supabase schema with RLS | ✅ Draft | `docs/v2/SUPABASE_SCHEMA.sql` executed on PGlite (Postgres). Owner isolation works and spoofed inserts are blocked. |
| Live structured-output check | ⏳ **Blocked** | This container has no OpenAI network access or key. Script ready: `spikes/v2-schema/src/live-check.ts` (one request). |
| Decision records | ✅ | `docs/v2/DECISIONS.md` (D1–D10) |

## Repository findings this phase
- v1 has no `.gitignore` and no lockfile, so Render installs unpinned versions on every build. A `.gitignore` is added on this branch.

## How to run the live check (owner, ~1 cent)
Run from `spikes/v2-schema` on a machine with the OpenAI key in the environment:

```bash
npm install
OPENAI_MODEL=gpt-4.1-mini node src/live-check.ts
```

Pass criteria:
- `httpStatus` 200
- `status` "completed"
- `issues` contains no errors

The output screen is saved to `fixtures/live.income-update.json` as the first real replay fixture.

## Next: Phase 1 (schema and runtime), once Phase 0 is approved
1. pnpm workspace (`packages/schema`, `packages/runtime`, `apps/studio`, `apps/api`) with committed lockfile and CI test gate.
2. Promote the registry to the full ~25 components, generate the Puck config and TypeScript types, add theme tokens.
3. Runtime renderer and action/data engine (bindings, navigate with record, simulate, updateRecord), with templates expanded deterministically.
4. v1 → v2 migrator plus tests against v1 starters and exported demos.

Exit gate: the Kapiko fixture renders and runs its journeys in the preview through the single renderer (Playwright).
