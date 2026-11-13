# Demo Builder — standalone AI experience studio

A separate standalone application (MEYON is unchanged).

## Local development

```bash
npm install
npm run dev
npm run build
node server/index.mjs
```

### Current deployments

- Frontend: https://demo-builder-nonprod.onrender.com
- AI backend: https://demo-builder-ai-nonprod.onrender.com
- Backend configuration health: https://demo-builder-ai-nonprod.onrender.com/api/status

## Piece 1 — Approved foundation
- Equal-width chat and presentation with independent scroll
- Projects and design guidelines, with browser-local project storage
- Professional starter renderer, interactive screens, fixed-size mobile phone with zoom 50%-150%
- Structured Demo Definition JSON import/export
- Future MEYON embed contract: [docs/MEYON-INTEGRATION.md](docs/MEYON-INTEGRATION.md)

## Piece 2 — AI generation

The chat now sends requirements to a dedicated server API using OpenAI's Responses API, **only when the server is configured and a Demo Builder access token is supplied**. The model generates a structured Demo Definition, not executable React code. The backend validates screen IDs, navigation targets, element types, field rules, count limits and channel before returning the definition. The frontend validates it again before rendering.

- The chat uses the current project brief plus new user instruction for initial generation.
- A **Generate demo** action regenerates from the stored project brief.
- Generation progress, provider failures, and token usage are displayed without fake AI responses.
- Model is configured with `OPENAI_MODEL`, default `gpt-4.1-mini`.
- Input/output tokens are logged to the chat response; financial cost calculations are not yet implemented.
- No live banking calls. The demo is interactive UI only.

### Required secure Render configuration

Open the Render service `demo-builder-ai-nonprod` and add the following *service environment variables* in the Render dashboard (do not put keys in GitHub, the chat UI or this README):

```
OPENAI_API_KEY=<your OpenAI Platform API key>
DEMO_ACCESS_TOKEN=<long random secret>
FRONTEND_ORIGIN=https://demo-builder-nonprod.onrender.com
OPENAI_MODEL=gpt-4.1-mini
```

`DEMO_ACCESS_TOKEN` has been set on the deployed service by the development assistant; the secret is only for authorized tester access. The chat's **Connect AI** dialog accepts this Demo Builder access token, **never** the OpenAI API key. Tokens entered in the chat interface are held only in memory, not localStorage. The OpenAI API key stays server-side.

**Security limits:** This is a controlled NONPROD proof of functionality, not a multi-tenant authenticated product. CORS origin checks are not authentication; an access token, basic per-IP rate limits, fixed model and input/output caps are enforced. Do not distribute the access token publicly. Before broader release, replace the shared token with per-user authentication, durable rate limits, audit logs, quotas, and cost ceilings.

**Storage limits:** Projects are saved in browser localStorage only. Files currently save filenames but do not upload, extract or send document contents to AI. Screenshot ingestion, asynchronous generation jobs, persistent server projects, and custom code extensions are not yet implemented. Targeted edits do verify preservation of unrelated screen definitions, but visual correctness still needs user review.

## Piece 3 — Controlled single-screen chat refinement

- **Open the screen to change** in the preview screen tabs, then type the change in the same AI chat (e.g. "Add a mandatory Confirm Mobile Number field; preserve everything else").
- If a demo already exists, the chat calls `POST /api/refine` instead of triggering full regeneration.
- The server passes just the selected screen and the list of allowed navigation destinations to the model, never asking it to regenerate other screens.
- Server merges *only* the selected screen back into a copy of the original demo, validates supported components and screen links, and asserts that every other screen is byte-for-byte JSON-equivalent. Invalid patches are rejected; original demo remains unchanged.
- Client verifies unrelated screens again before accepting the new definition.
- Every successful change records an in-browser snapshot; click **Undo edit** to restore the last snapshot, up to 8 levels. No undo data is uploaded to a server.
- **Generate demo** remains an explicit full-regeneration action based on the original project brief (it clears refinement undo history). The initial project brief is not appended with refinement instructions.
- Run `npm test` for deterministic preservation, navigation and invalid-change regression tests. Production build also executes these tests.

**Current limitations:** Each chat refinement targets the selected screen only. Cross-screen workflow refactors require multiple edits or full regeneration; custom React/code extensions, screenshots and document content are not consumed. Browser-local history is not a server-backed audit log. Semantic confirmation that every requested business rule was fully implemented still requires user testing.

## Piece 4 — Versioned, portable publishing (NONPROD)

- In the preview toolbar, **Publish** freezes the current working demo and creates a read-only share link with a numbered version.
- **Versions** lists the latest eight published snapshots; **Copy link** and **Open** show the shareable interactive viewer; **Restore draft** loads an earlier published version back into the editable project. Restoring a draft never alters a previously shared snapshot.
- The viewer uses the same supported demo elements, forms, validation and navigation and the 390×780 mobile phone with zoom. It does not expose AI editor controls or API access tokens.
- The share link stores a **complete, immutable copy of the Demo Definition inside the URL fragment**. It does **not** write to a publication database. The link remains usable independently of later edits as long as this frontend stays hosted, the link stays intact, and the supported schema remains compatible.
- A large demo is rejected rather than creating an unusable URL. Snapshots are limited to ~24k JSON characters; URL length is limited to 32k. Browser / chat / email link-length policies vary.
- **Privacy:** Anyone with the link can decode and view all included demo content. Do not publish actual customer data, secrets, proprietary materials, or internal production requirements. Sharing is an intentional public action; it does not use access controls.
- **Persistence:** The published-versions list lives in localStorage, is not synced across computers, and can be lost if browser data is cleared. The link itself remains self-contained if the full URL is retained.
- Tests cover Unicode, immutable snapshots, content exposure, incorrect schema, broken links, and URL-size rejection.

### Not yet production-ready

Hosted publication IDs with revocation, access control, view analytics, durable versions across devices, a real login, per-user AI limits, persistent server-backed projects, an extension-component security sandbox, cross-browser end-to-end testing, and signed MEYON embed sessions are **not implemented**. The standalone viewer is a separate read-only route, **not** a security sandbox or different origin. A production rollout requires backend persistence, authentication, publication authorization and privacy review.

### MEYON integration readiness

The standalone and embedded contract is documented in [docs/MEYON-INTEGRATION.md](docs/MEYON-INTEGRATION.md). MEYON remains unchanged and not connected. The portable viewer does not accept MEYON project data through query parameters or iframe messages.

Do not imply that the product does anything not connected and verified.

## Scoped visual refinement and preview acceptance (November 2026)

The existing editor now has a **Select** toggle in the preview toolbar. It preserves the chat/preview split and full-size mobile phone.

- Turn **Select** on, click an entire screen/background, the shared header, a rendered section, a form field or an action button.
- A blue selection highlight and a small comment box identify the target. Enter an instruction and select **Preview change**.
- Chat remains available without selection and defaults to the current screen. Explicit all-screen shared-header instructions use the existing deterministic global-header capability.
- The `POST /api/plan` API returns a **proposal**, not a committed edit. A zero-AI fast path handles simple header-icon changes and target renames. Other changes use a single OpenAI call to propose up to eight constrained JSON operations.
- The backend rejects operations that escape the selected target, unknown IDs, arbitrary code/style properties, invalid navigation, duplicate fields, broken schema or no-ops. It verifies requested definition-level changes and checks that untouched screens/global settings are preserved.
- The editor shows the proposed result and its verification checks **without saving**. **Apply change** saves a revision and enables Undo. **Discard** leaves the old draft intact.
- Publishing/exporting/restoring versions is blocked while a proposed edit is pending; pending previews are ephemeral and are lost on browser reload.
- Only the supported operation vocabulary is enabled: property edits to screen, header, form fields, actions, basic content components; removal of an existing element; adding a field to an existing form. Novel components, layout/CSS edits, and complex business-rule generation must be added to the renderer/schema before AI can safely apply them.
- The current gate verifies **definition-level** outcomes and effective header settings. It does **not** perform real-browser screenshot diffs, complete workflow E2E testing, or user-level visual acceptance; the human Preview → Apply step remains required.
- The previous `/api/refine` endpoint is retained for backward compatibility, but the current editor chat uses the staged `/api/plan` route.

No MEYON project or database has been changed. The current shared access token and browser-local drafts remain NONPROD-only.
