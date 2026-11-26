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

## D10. Toolchain (as built in Phase 1)
- **npm workspaces** (`packages/schema`, `packages/runtime`, `apps/studio`) instead of pnpm, so Render and local machines need no extra tooling. Root lockfile committed.
- TypeScript 5.9.3 with `erasableSyntaxOnly`, so Node runs the `.ts` sources directly for tests (no build step). TypeScript 7 is not on the critical path.
- **Node's built-in test runner** for unit and contract tests (no Vitest dependency). **Playwright 1.63** for browser end-to-end tests.
- Fastify 5 for the API arrives in Phase 2.
- All dependency versions pinned exactly. v1 had no lockfile or `.gitignore`; both now exist on this branch.

## Retained from v1 (ported, not rewritten blindly)
- Pure edit-operation pattern (`visualEditor.mjs`), mobile slot semantics (`mobileLayout.mjs`), row-action semantics (`tableRowActions.mjs`).
- Declarative action engine ideas (`componentRuntime.mjs`), simulation copy (`mobileComponents.mjs`), CSV export safety (`safeCsvCell`).
- The 220 regression tests, reviewed for business rules worth keeping.
- A v1 → v2 migrator so existing browser-local demos survive.

## Retired
- The prose generation prompt, `normalizeGeneratedDemo`, `validDemo`, `explainGeneratedDemo` and their duplicates.
- About 15 regex-routed chat-edit modules. These are replaced by "AI proposes registry-validated editor commands".
- URL-fragment publishing, the shared access token, the hard 12-screen limit, and the duplicated renderer in `PublishedViewer.tsx`.

## D3a. Editor: direct editing on the runtime render (supersedes Puck in D3), 25 Nov 2026
**Decision.** The visual editor edits on the real `DemoRuntime` render instead of a Puck canvas. Puck is not used.
**Why.**
- Puck draws the canvas with its own component implementations. That is a second renderer, and it breaks the "editor = preview = published" guarantee. Our designed patterns and templates also need the runtime's contexts (session, forms, theme).
- Every rendered node already carries `data-node-id`, so selection on the real render is exact. Template parts select their template.
- Smaller bundle: the whole studio is 122 KB gzipped, versus about 360 KB for the Puck editor alone. No external font fetch, and no new dependency.
**How.**
- Pure, immutable edit operations live in `packages/schema/src/edit.ts`: insert, move, duplicate, remove, rename, nudge and screen operations. Ids stay unique and invalid nesting is refused. All are unit-tested.
- The property panel is generated from each component's JSON Schema, derived from the registry. Screen, collection and template references become pickers. Discriminated unions (actions) become a type picker plus that type's fields. New components get an editor automatically.
- Layers is a tree with HTML5 drag and drop (before, after, inside), plus toolbar buttons and keyboard shortcuts: Delete, Ctrl+D, Esc, Ctrl+Z, Ctrl+Shift+Z.
- Undo history: 100 steps, and typing into one field merges into a single step. A local draft survives reloads. The presenter window (`?present=1`) follows edits live.
- Portals render at 1280 px and are scaled to fit the stage, never reflowed into a narrow column.
**Trade-off.** Drag and drop happens in Layers, not on the canvas itself. Canvas drag can be added later on `@dnd-kit` without changing the operations layer.

## D9. AI edits are targeted operations, on a stronger model (26 Nov 2026)
**Problem (UAT).** "Add a date filter" produced inputs that filtered nothing. Small edits also garbled unrelated text, because the model rewrote the whole screen.
**Decision.**
- **Operations.** The assistant returns a reply plus operations: replace, insert, remove, move, screen. They are applied with the editor's own command layer, so anything not named is byte-identical by construction.
- **A reply.** The AI explains what it changed, or why it can't, offering what it can do instead. With no operations, nothing changes.
- **Real capabilities instead of fakes.** Tables have search, up to 3 dropdown filters and a date-range filter. Lists have search and filter chips. An edit that adds inputs outside a form (which do nothing) is refused and repaired once.
- **Model.** Edits to existing screens use `ASSIST_MODEL` (default `gpt-4.1`, about USD 0.004–0.02 per edit). Generation and new screens stay on `OPENAI_MODEL` (`gpt-4.1-mini`).
**Evidence.** In the live evaluation (`packages/generator/scripts/edit-eval.ts`, 10 banking requests), 10 of 10 were correct: 8 precise edits with other screens untouched and 0 validation errors, and 2 honest "not possible" replies with an alternative. Total USD 0.09.
**Follow-up, 26 Nov 2026 (UAT, Customer Search).** The assistant said it had replaced a form with a table, but only a section title changed. Cause: replacing a container kept its old children and silently dropped the new ones. Fixes:
- A container replace now takes the new children; an empty list keeps the current ones.
- **Every operation is verified after it is applied.** An operation without effect is an error, repaired once and then refused, so a reply can never claim a change that did not happen.
- **New `data` operation.** The AI creates fitting sample data during an edit, e.g. customers for a customer search, instead of reusing unrelated records.
- **Broken parts are flagged.** The outline marks buttons without actions and inputs outside forms "[does nothing]", so "rework" or "clean up" removes them.
Live: the UAT request handled correctly 3 of 3 times; the 10-case evaluation 10 of 10.

## D10. Saved demos, immutable versions and a principal-based authorization model (Phase A1)
**Decision.**
- **Principals.** One per identity source and subject: Supabase Auth for standalone users, MEYON launch sessions (A2), the shared UAT token (interim) and SSO later. Every source maps into the same workspace and role model, so adding SSO is a new source value, not a new authorization model. MEYON's shared login is never treated as an individual identity.
- **Workspaces and roles.** Workspaces are the tenant boundary, with owner, editor and viewer roles.
- **Sessions.** A Builder session (A2) is additionally confined to one workspace, one project and a list of operations.
- **Demos.** A demo is one application (mobile app or staff portal) with an autosaved working draft protected by a revision number (compare-and-swap). It has a primary flag (at most one per workspace, project and application type; the first demo becomes primary) and an optional fork origin.
- **Versions.** Immutable snapshots numbered per demo, with a content hash, note and validation metadata. A database trigger rejects any update.
- **Publications.** Read-only links to one exact version. Only the SHA-256 of the token is stored, links are revocable, and a version with validation errors cannot be published.
- **Generation jobs.** Each job records the principal that started it. Jobs are listed and opened only by that principal; legacy unowned jobs stay visible to the UAT token only.
- **Access path.** The Studio never touches these tables. RLS is enabled with no browser policies, and the API (service role) authorizes every request. Atomic steps (save version, set primary, fork) are database functions executable only by the service role.

**Evidence.**
- Migration tests on Supabase-like Postgres (`supabase/tests/demos_test.sql`) cover immutability, concurrency, the primary rule, cross-workspace references and browser privileges.
- API tests (`apps/api/test/demos.test.ts`) cover isolation, conflicts, versions, publication, primary/fork, session scope and job ownership.
- Browser tests (`apps/studio/e2e/persistence.spec.ts`) cover the user journeys.

## D11. Opening Demo Builder from MEYON: launch grants, confirmation and requirement traceability (Phase A2)
**Decision.**
- **Launch.** MEYON issues a short-lived (5 minutes), single-use launch grant and opens `<studio>/#launch=<code>`. The code is in the URL fragment, so it is never sent to a server or logged, and the Studio removes it from the address bar immediately.
- **Exchange.** The Studio posts the code to `POST /api/v2/launch/exchange`. The Builder API consumes the grant with MEYON server-to-server (`POST {MEYON_BASE_URL}/demo-builder/v1/launch-grants/consume`, `Authorization: Bearer <MEYON_INTEGRATION_KEY>`), a credential separate from MEYON's main API key. MEYON consumes atomically; the Builder additionally records each `grantId` once (`demo_launches.grant_id` is unique), so a replayed package is refused.
- **Launch package v1** (`apps/api/src/launch/package.ts`) is validated strictly: tenant, actor (with `verified`), project, approved story (id, artifact version, content hash), feature, mode (create or extend), application type, base demo (extend: stable demo id and version; the URL is display only), the prompt reviewed in MEYON (revision), approved acceptance criteria and business rules with stable ids, actors, integrations to simulate, optional AI suggestions, branding and sources.
- **Identity.** The tenant is a workspace. MEYON's shared login is not an individual identity: until MEYON sends `verified: true`, everyone launching from a tenant acts as that tenant's one shared MEYON principal (editor role). The confirmation screen says so.
- **Session.** A signed Builder session (8 hours) confined to the tenant workspace, the launch's project and the operations read, edit, version, publish, fork, primary and create (no archive), held in the browser tab's sessionStorage. An HttpOnly cookie is planned for the Cloud Run deployment, where Studio and API share one origin; on Render the two services are separate sites under a public suffix, where a cross-site cookie would be blocked.
- **Confirmation.** Nothing happens until the user confirms what MEYON sent. Create starts the plan step (the user still reviews the screen plan before anything is generated); confirming twice never starts two generations. Extend checks that the base demo is in the same tenant, project and application type and that the version exists, then opens it. Cancel is final.
- **Approved versus suggested.** Approved items are labelled as such in the brief and must be demonstrated; AI suggestions are a separate, optional section and are never treated as requirements. A plan edited in the Studio cannot change the approved requirements.
- **Traceability.** The planner maps every approved criterion to the screens that demonstrate it (ids from the approved list only; unknown ids are dropped; criteria no screen demonstrates are reported in the plan). Each generated screen records `trace` entries: story, criteria, confidence (high: most of the criterion's key words are visible on the screen; medium: some; low: planned but not visible yet) and source (generated or confirmed by the user). The Studio shows story coverage per criterion and lets the user confirm or remove links. Every saved version records a coverage summary (story → criterion → screens, best confidence) for syncing back to MEYON (A4). Published links never include traceability.
- **Simulated MEYON** (`MEYON_SIMULATOR=on`, testing and UAT only, never with a real `MEYON_BASE_URL`): three approved banking stories in a "Simulated MEYON tenant", a stand-in for the Demo tab at `?sim=meyon` for signed-in users, and the real exchange path over HTTP with an integration key.

**Evidence.**
- Migration tests (`supabase/tests/launches_test.sql`): one record per grant, mode and baseline consistency, browser and server-role privileges.
- API tests (`apps/api/test/launch.test.ts`): the full Create path to a published link without requirement references; single use, expiry and integration key; replayed, invalid and unavailable packages; tenant and project confinement and tampered sessions; cancel versus confirm and double confirmation; Extend baseline checks.
- Generator tests (`packages/generator/test/trace.test.ts`): criteria planning, honest confidence, forged criteria never reaching the document.
- Browser tests (`apps/studio/e2e/launch.spec.ts`): Create, Cancel and Extend journeys through the simulator.

## D12. Prompt preparation and demo quality rules (UAT review of A2)
**Decision.**
- **Prompt.** MEYON's Demo tab composes the full screen-generation prompt deterministically from governed data: request and audience (locale UAE, AED), the approved story, numbered acceptance criteria with ids, business rules with exact values, integrations to simulate, and demo expectations (complete journey, review before submission, success with a reference, consistent fictional data). The simulator's `composePrompt` is the reference template for MEYON's composer (Phase B).
- **AI screen suggestion (hybrid).** On request, the Builder proposes the screens and journey (home screen, task steps, review, success, tracking) as a numbered list labelled as an AI suggestion, with the criteria each screen demonstrates and open questions instead of invented rules. The user edits it in the prompt; the brief parser then keeps those screens exactly. Cost about USD 0.002 per suggestion.
- **Brief.** Approved items the reviewed prompt already contains are not repeated.
- **Deterministic quality rules.** Document uploads use a designed upload layout (one upload per document with format and size hints); instructions, computed figures and integration checks never become form fields; amount + tenure steps use the loan calculator; the calculator also provides the total repayable; review and success screens show what was entered; no reference number before submission; app menus list destinations, never journey steps; dashboard quick actions never repeat the menu, and an optional promo is the entry point to the demonstrated task; status counts on dashboards come from the sample records; sample data rows name each value's field (a merged value cannot shift columns); record amounts are formatted as AED; KPI figures never wrap.

**Evidence.** `packages/generator/test/demo-quality.test.ts`; browser test of the composed prompt and suggestion in `apps/studio/e2e/launch.spec.ts`; real gpt-4.1-mini runs of US-101 (mobile, 7 screens, about USD 0.017 including the suggestion) and US-102 (portal, 5 screens, about USD 0.012).

## D13. EXTEND: change plan, approval, journey check and new version (Phase A3)
**Decision.**
- **Plan.** For a confirmed Extend launch, the Builder proposes a change plan against the exact base version MEYON named (one AI call, about USD 0.002): new screens (with the criteria they demonstrate and where they open from), changed screens (a precise instruction each), screens that are possibly no longer needed, the navigation the changes add, unchanged screens, criteria nothing addresses, and open questions. Existing screen ids only; one entry per screen; an "add" that repeats an existing title is dropped.
- **Approval.** The user ticks what to apply. Removals are never pre-selected. A changed or removed screen that also demonstrates other stories carries a warning.
- **Apply.** New screens first (built by the add-screen engine and linked from their entry screen), then changes (screen editor, told which new screens are already linked so entries are not duplicated), then ticked removals. Each affected screen records the story and criteria it demonstrates. Runs in the background with progress (about USD 0.01 per change).
- **Journey check.** Every screen reachable before is still reachable, every new screen is reachable, and no new validation errors appear. Passed: the result is saved as the draft and a new version (note "Extended with US-xxx", metadata with the story, base version, applied changes, journey check and coverage). Failed: saved to the draft only, with the problems listed; no version is created. Published versions are never changed.
- **Base changed.** Applying checks that the demo is still at the planned version with an unchanged draft. Otherwise the user chooses: plan again on the latest version, apply to a copy of the planned version (a fork; never primary), or cancel. Saving uses the draft revision captured before applying, so a concurrent edit is never overwritten.
- **Confirmation step.** A new `confirm` action shows an in-app dialog before the following actions run (Cancel stops them). Card controls use it for freeze and unfreeze; the card status follows the freeze state.

**Evidence.** `packages/generator/test/extend.test.ts`, `apps/api/test/extend.test.ts`, `packages/runtime/test/engine.test.ts` (confirm), browser journey in `apps/studio/e2e/launch.spec.ts`; real run extending the US-101 loan app with US-103 (card freeze): plan USD 0.0015, apply USD 0.018, journey check passed (7 to 8 reachable screens).

## D14. Sync events to MEYON (Phase A4)
**Decision.**
- **Outbox.** Every change MEYON must know about is recorded in `demo_events` (migration 0005) and delivered afterwards by the API (every 10 seconds, 20 at a time, each claimed with a one-minute lease so two instances never send the same event). Recording never fails the user's action.
- **Events.** `launch.confirmed`, `launch.cancelled`, `demo.created` (including forks), `demo.version_saved` (number, content hash, note, screens, validation, story coverage, and for Extend the base version, applied changes and journey check), `demo.published` / `demo.publication_revoked` (publication id and version; never the link), `demo.primary_changed`. Only demos of MEYON tenants produce events; standalone demos never do. Each event carries the tenant, project, demo, the launch (with MEYON's grant id) and who acted.
- **Delivery contract.** `POST {MEYON_BASE_URL}/demo-builder/v1/events`; headers `x-demo-builder-event` (id, MEYON's idempotency key), `x-demo-builder-signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + raw body)>`, `x-demo-builder-key` (first 8 hex of SHA-256 of the signing secret). MEYON verifies against any active secret (two during rotation) within 5 minutes, processes each id once, and answers 2xx (or 409 for a repeat). Anything else is retried: 15 seconds, doubling, at most one hour, until delivered.
- **Secrets.** `MEYON_EVENT_SECRETS` (comma-separated, 32+ characters each; the first signs). The simulator generates its own.
- **Simulated MEYON** verifies, de-duplicates and lists what it received on its page ("Received by MEYON").

**Evidence.** `apps/api/test/sync.test.ts` (event trail, signatures and rotation, retries with backoff, idempotency, no link token or document content, standalone demos silent); `supabase/tests/events_test.sql`; browser journey ends with MEYON showing the received version and coverage.
- **MEYON to Builder.** `POST /api/v2/integration/suggest-screens` (Bearer `MEYON_INTEGRATION_KEY`, the same shared integration key): AI screen suggestions for the prompt MEYON's Demo tab is preparing; a base demo is read only when it belongs to the requesting tenant.
- **Signing without shared secrets (preferred).** `BUILDER_SIGNING_KEY` (Ed25519, base64 PKCS#8) on Demo Builder: launch-grant requests and events carry `x-demo-builder-signature: t=<unix>,ed25519=<base64url signature of "t.body">`; Demo Builder publishes its public key at `GET /api/v2/integration/public-key`. MEYON keeps its own Ed25519 key in its database, publishes the public key at `GET /v1/demo-builder/v1/public-key`, and signs suggestion requests (`x-meyon-signature`). Each side fetches the other's public key over HTTPS from the address it is configured with (cached 10 minutes, re-fetched once on a failed check, so rotation needs no coordination). The shared-key mode remains for the simulator and tests.
