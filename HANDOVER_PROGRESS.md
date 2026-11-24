# HANDOVER_PROGRESS

## Current state
- **Branch:** `v2/foundation` (pushed). The deployed `feat/standalone-foundation` is untouched; v1 still builds and passes its 220 tests on this branch.
- **Phase 0:** complete, including the live structured-output check.
- **Phase 1 (schema and runtime):** **complete.** Exit gate passed.
- **Owner decisions:** v2 rewrite · Supabase (DB, auth, storage) · no v1 hotfix · USD 50/month for AI and hosting combined.

## Run everything
```bash
npm install
npm run v2:check   # type checks + 21 unit/contract tests + 9 Playwright journeys
npm test           # v1 suite (unchanged)
npm run dev -w @demo/studio   # preview at http://localhost:5173
```

## Phase 1 deliverables
| Package | What it is | Evidence |
|---|---|---|
| `packages/schema` | 25-component registry (single source of truth), document model (app shell, keyed collections, bindings), one validator with exact paths, strict AI screen schema, 7 deterministic journey templates, v1 to v2 migrator | 14 tests: both fixtures error-free; 60 screens validate; every v1/live failure shape rejected with path; template routes; v1 starters migrate with routes preserved |
| `packages/runtime` | Framework-free engine (navigation, history, forms, record passing, maker/checker updates, simulated steps) plus one React renderer and shell (mobile app bar, tabs or drawer; portal sidebar with sub-items) | 7 engine tests: journey A, income flow, two rows open their own record, maker to checker updates only the selected row, back restores record, simulated failure stops the chain, CSV injection safety |
| `apps/studio` | Preview harness: sample projects, v1/v2 JSON import (migrates v1), screen list with per-screen issue markers, live validation panel, phone (390x844) and portal device frames | Playwright, 9/9, no console errors: Kapiko journeys A and B, UAE PASS, income update to service requests, tabs; portal row details for two customers, maker to checker to Completed, search, filter, sidebar sub-navigation; v1 import that runs end to end |

## Contract changes since Phase 0
- `submit` may name a form (`{type:'submit', form:'income'}`), the layout gpt-4.1-mini produced in the live check.
- Forms no longer carry a built-in submit button; buttons submit them.
- Table columns take an optional `format` (`aed`, `date`, `status` pill).

## Known limitations (planned)
- No editor yet: Phase 3 integrates Puck on top of this runtime.
- No AI generation in v2 yet: Phase 2 builds the job-based generator on `aiScreenSchema`.
- Kapiko "View details" on service requests has no detail screen within the fixed 12 screens, so the list is display-only.
- Theme fonts are referenced, not self-hosted, so offline or self-hosted fonts are a Phase 7 item.

## Next: Phase 2 (generation engine)
1. API service (Fastify) with a provider adapter, budget guard and usage logging.
2. Planner: deterministic screen-list parser plus a structured plan call; editable plan review.
3. Per-screen generation with the strict schema, validation, one targeted repair, marked fallback; bounded concurrency.
4. Jobs persisted (Supabase), progress streaming, retry and single-screen regeneration.

Exit gate: one controlled real Kapiko 12-screen run producing exactly 12 valid screens, plus a synthetic 30-screen plan, with cost and latency recorded.

## Environment notes
- Cloud environment `demo-builder`: only `api.openai.com` is added; the OpenAI key is a proxy-injected network secret.
- Node fetch there needs `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt OPENAI_API_KEY=proxy-injected`.
