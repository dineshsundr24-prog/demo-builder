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
- Model is configured with `OPENAI_MODEL`, default `gpt-6.1-sol`.
- Input/output tokens are logged to the chat response; financial cost calculations are not yet implemented.
- No live banking calls. The demo is interactive UI only.

### Required secure Render configuration

Open the Render service `demo-builder-ai-nonprod` and add the following *service environment variables* in the Render dashboard (do not put keys in GitHub, the chat UI or this README):

```
OPENAI_API_KEY=<your OpenAI Platform API key>
DEMO_ACCESS_TOKEN=<long random secret>
FRONTEND_ORIGIN=https://demo-builder-nonprod.onrender.com
OPENAI_MODEL=gpt-6.1-sol
```

`DEMO_ACCESS_TOKEN` has been set on the deployed service by the development assistant; the secret is only for authorized tester access. The chat's **Connect AI** dialog accepts this Demo Builder access token, **never** the OpenAI API key. Tokens entered in the chat interface are held only in memory, not localStorage. The OpenAI API key stays server-side.

**Security limits:** This is a controlled NONPROD proof of functionality, not a multi-tenant authenticated product. CORS origin checks are not authentication; an access token, basic per-IP rate limits, fixed model and input/output caps are enforced. Do not distribute the access token publicly. Before broader release, replace the shared token with per-user authentication, durable rate limits, audit logs, quotas, and cost ceilings.

**Storage limits:** Projects are saved in browser localStorage only. Files currently save filenames but do not upload, extract or send document contents to AI. Screenshot ingestion, asynchronous generation jobs, persistent server projects, custom code extensions, and precise edit preservation are not yet implemented.

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

## Next pieces

**Piece 4**: Secure publishing, sandboxed custom extensions, real user auth, persistent storage, cross-browser/visual tests, and MEYON embed readiness.

Do not imply that the product does anything not connected and verified.
