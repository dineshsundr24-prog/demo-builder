# Demo Builder — AI experience studio

Standalone Demo Builder application, developed independently from MEYON.

## Run locally

```bash
npm install
npm run dev
npm run build
```

## Four-piece delivery

**Piece 1 — Workspace foundation (implemented)**

- Chat-and-preview workspace with equal panels and independent scroll
- Create and switch projects, choose mobile or web channel
- Project context and design guidelines
- Capture requirements in an ordered conversation-style project brief
- Attach reference filenames (not uploaded file bytes)
- Built-in interactive mobile and portal sample previews (clearly labeled as samples)
- Version 1 JSON definition import/export and functional preview
- Browser-local project storage
- Future MEYON integration contract: [docs/MEYON-INTEGRATION.md](docs/MEYON-INTEGRATION.md)

**Piece 2 — Real AI generation (not implemented)**: Secure AI backend, project/stories interpretation, generated screens and behavior, real cost telemetry.

**Piece 3 — Precise conversational refinement (not implemented)**: Locate → Patch → Verify, stable IDs, preservation and visual checks, conversation-backed patches.

**Piece 4 — Publishing and hardening (not implemented)**: Versioned public demos, sandboxed extensions, verification suites, auth, integrations.

## Important boundaries

The Piece 1 chat stores the entered requirements only; it does not respond as AI and does not modify demos. Attachment selection records filenames but does not parse the file content. Project state lives in the current browser's `localStorage` and is not synchronized across devices. The sample banking demos are examples, not AI-generated output.

There is no active connection to MEYON, external APIs, backend database, or OpenAI. Never expose API keys or proprietary server functionality in the static frontend.

The JSON renderer avoids dynamic code evaluation but its current validation is preliminary. Future extensions require proper sandboxing and security controls.
