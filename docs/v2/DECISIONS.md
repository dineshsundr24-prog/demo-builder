# Demo Builder v2 — Decision Records (Phase 0)

Status: **Proposed, pending owner review** · Branch: `v2/foundation` · Baseline: `feat/standalone-foundation@05a82ee` (unchanged)

Owner decisions already taken (24 Nov 2026): v2 rewrite approved · Supabase for DB + auth + storage · no interim v1 hotfix · combined AI + hosting budget **USD 50/month**.

---

## D1. One component registry is the single source of truth
**Decision.** Every component is declared once (Zod 4 props + metadata). From that declaration we derive: the runtime validator, the strict AI output schema, the editor inspector/palette, and TypeScript types.

**Why.** The v1 failures came from five validators and a prose prompt disagreeing about the same shapes (RCA R1–R4, R10).

**Evidence (spike `spikes/v2-schema`, 7/7 tests):**
- The synthetic 12-screen Kapiko document validates with zero errors, using actions, bindings, a data collection, row actions, templates and an app shell.
- A 40-screen document validates, so there is no fixed screen limit.
- Every v1 failure shape (unknown kind, bad notice tone, unknown destination, wrong action key, table column not in the collection, object select options) is rejected **with an exact path and message**. No boolean "invalid" results.
- Unreachable screens are reported as Flow **warnings**, not generation failures.

## D2. Strict structured output with a recursive schema
**Decision.** Generate one screen per call using a strict JSON Schema derived from the registry.
- Destinations, collections and templates are emitted as **enums of the real IDs**, so the model cannot invent a route.
- Optional props become nullable and are stripped after decoding.
- Use the **recursive** (`$defs`/`$ref`) form.

**Evidence.** Both the recursive and depth-unrolled variants pass the strict-mode lint, but:

| Variant | Size | Properties | Enum values |
|---|---|---|---|
| Recursive | ~3.2k tokens | 134 | 104 |
| Unrolled to depth 3 | ~32k tokens | 1,385 | 1,100 |

The unrolled variant exceeds the documented limit of 1,000 enum values and costs 10× the input tokens, so it is rejected. A 60-screen job grows the recursive schema to only ~4.2k tokens.

**Constraint found.** Keep the schema **identical for every call in a job**, rather than pinning a per-screen ID enum. Providers cache or compile a schema the first time they see it, and a changing schema defeats that. The validator checks the returned screen ID instead.

**Live result (24 Nov 2026).** `gpt-4.1-mini-2025-04-14` accepted the recursive strict schema (HTTP 200, 6.8 s, 2,034 input / 535 output tokens for a 21-component screen). The schema adds far fewer billed input tokens than the byte-size estimate. At published mini-model rates that is well under USD 0.01 per screen (rates still to be confirmed on the OpenAI billing page).

## D3. Editor: Puck (MIT) behind an adapter; dnd-kit as fallback
**Decision.** Use `@puckeditor/core` (pinned at 0.24.0) for the canvas, palette, inspector, nested drag-and-drop, viewport switching and undo.
- The Puck config is generated from the registry.
- Its `render` functions are the **same runtime components** used by preview and the published viewer.
- Screens, Flow, Data and AI panels live outside Puck.

**Evidence (spike `spikes/editor-puck`, real Chromium):**
- Loads a Kapiko screen.
- Selecting a component nested in a card shows its inspector, and edits propagate to the data and the canvas.
- Dragging from the palette into a nested card slot works.
- Undo restores the prior state.
- The phone viewport (390) and the portal viewport both work.
- No page errors.
- The v2 ↔ Puck conversion is **lossless for all 12 screens**.

**Integration rules discovered:**
1. Puck generates IDs like `Button-<uuid>`, so the v2 ID pattern is relaxed to `[A-Za-z0-9-]{1,64}`.
2. Puck applies `defaultProps` to loaded data, which showed a phantom "Card" title in the editor but not in the render. Rule: **defaults only for required props.**
3. Puck renders the inspector twice for responsive layouts. Tests must target `:visible`.
4. Puck CSS fetches the Inter font from an external host (`rsms.me`). Self-host it or override it.
5. Editor bundle is about 360 KB gzipped. Puck is **not** shipped in the published viewer.

**Not yet proven:** custom selection overlay, keyboard accessibility, and performance on very long screens. These are Phase 3 acceptance items. If any of them blocks us, the fallback is a custom canvas on `@dnd-kit/react`, which Puck itself uses, so the drag semantics carry over.

## D4. Workflow is derived, not stored separately
Navigation edges are the `navigate` actions, row actions, template `next` values and shell items themselves. The Flow view (React Flow, `@xyflow/react` 12.12.1) edits those same fields. Reachability lint already runs in the validator (D1).

## D5. Data model for cross-screen state
App-level `collections` (fictional sample rows) and `state` keys written by inputs. Text binds to them with `{{state.x}}`, `{{record.field}}` or `{{params.x}}`, using path lookups and formatters only, with no `eval`. `navigate` with `passRecord` carries the selected table row. `updateRecord` provides maker/checker status changes. Proven expressible in the Kapiko fixture (Income Update → Review uses `{{state.income.*}}`).

## D6. Banking journeys are deterministic templates
UAE PASS login, UAE PASS eKYC, face verification, OTP and document upload, and later maker review and checker approval, are parameterised templates expanded without AI. The model only chooses a template and its `next` destination. They are always labelled as simulated.

## D7. Platform: Supabase + Render
- Supabase provides Postgres (projects, immutable versions, generation jobs, publications, usage) with row-level security, plus Auth and Storage.
- Render keeps the static frontend and a Node API.
- The API holds the AI key and the Supabase service role. The browser only gets the anon key plus the user session.
- Draft schema: [`SUPABASE_SCHEMA.sql`](SUPABASE_SCHEMA.sql).

## D8. Generation runs as a resumable job
`POST /jobs` returns a job ID. Each screen result is persisted as it completes and streamed over SSE, with polling as fallback.
- Retry, resume and single-screen regeneration never re-pay for completed screens.
- Concurrency is bounded at 3–4.
- At most one targeted repair per screen, then a marked deterministic fallback.

## D9. Cost envelope (USD 50/month)

| Item | Build phase | Staging/live |
|---|---|---|
| Supabase | Free ($0; pauses after ~1 week idle) | Pro $25 if pausing is unacceptable |
| Render static frontend | $0 | $0 |
| Render API | Free (cold starts) | Starter ~$7 |
| AI usage cap (hard, server-enforced) | ~$15–20 | ~$15–18 |

Estimate per 12-screen generation (to be verified against current provider pricing and the live run): plan ≈ 6k input / 3k output tokens, plus 12 screens × (≈5k input incl. schema, ≈0.8k output), plus ~10% repair. That is ≈ 75k input / 13k output, which is roughly **USD 0.05** on a mini-class model. A $15 cap is therefore ≈ 300 full generations a month. Single-screen regeneration costs about 1/12 of that.

**Guards:** per-job and per-user-per-month token caps, maximum screens per job (soft, configurable, default 40), no automatic full regeneration, and usage rows in `usage_events`.

## D10. Toolchain
- TypeScript 5.7 is kept for now. TypeScript 7 is evaluated later and is not on the critical path.
- Vitest for unit and contract tests, Playwright for end-to-end tests, Fastify 5 for the API, pnpm workspaces.
- Lockfile committed. **v1 has no lockfile or `.gitignore`**, so Render builds were not reproducible.
- All dependency versions are pinned exactly.

## Retained from v1 (ported, not rewritten blindly)
- Pure edit-operation pattern (`visualEditor.mjs`), mobile slot semantics (`mobileLayout.mjs`), row-action semantics (`tableRowActions.mjs`).
- Declarative action engine ideas (`componentRuntime.mjs`), simulation copy (`mobileComponents.mjs`), CSV export safety (`safeCsvCell`).
- The 220 regression tests, reviewed for business rules worth keeping.
- A v1 → v2 migrator so existing browser-local demos survive.

## Retired
- The prose generation prompt, `normalizeGeneratedDemo`, `validDemo`, `explainGeneratedDemo` and their duplicates.
- About 15 regex-routed chat-edit modules. These are replaced by "AI proposes registry-validated editor commands".
- URL-fragment publishing, the shared access token, the hard 12-screen limit, and the duplicated renderer in `PublishedViewer.tsx`.
