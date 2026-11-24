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
| Live structured-output check | ✅ | 24 Nov 2026, one request, `gpt-4.1-mini-2025-04-14`, strict recursive schema accepted: HTTP 200, `completed`, 6.8 s, 2,034 input / 535 output tokens, 21 components. One semantic issue caught with exact path (`submit` on a button outside its Form; see Phase 1 change below). Output kept as `spikes/v2-schema/fixtures/live.income-update.json` (fictional data). |
| Decision records | ✅ | `docs/v2/DECISIONS.md` (D1–D10) |

## Repository findings this phase
- v1 has no `.gitignore` and no lockfile, so Render installs unpinned versions on every build. A `.gitignore` is added on this branch.

## Live check notes
- Runs in the `demo-builder` cloud environment (only `api.openai.com` allowed; key stored as a network secret, never in code or env vars).
- Node's built-in fetch needs `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt OPENAI_API_KEY=proxy-injected` there.
- Contract change for Phase 1: forms commonly have several buttons (Save draft / Continue / Cancel) outside the field group, so `submit` gets an optional `form` reference instead of being an error.

## How to run the live check yourself (~1 cent)
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
