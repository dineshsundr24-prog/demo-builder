# Demo Builder integration contract (planned)

This is a contract for later integration with MEYON; **nothing in this repository currently calls MEYON**.

## Operating modes
- `standalone`: a user creates projects and enters requirements directly in Demo Builder.
- `embedded`: MEYON launches Demo Builder inside Project → Demo, sharing approved project requirements and company design guidelines through a secure backend handshake.

## Proposed launch context (v1)

```json
{
  "contractVersion": 1,
  "mode": "embedded",
  "companyId": "company-id",
  "projectId": "project-id",
  "storyId": "story-id",
  "demoId": null,
  "demoVersion": null,
  "designGuidelines": {"theme": "banking", "brandColors": []},
  "approvedRequirements": [{"id": "story-id", "title": "Customer sign up", "content": "..."}]
}
```

All identifiers refer to MEYON-owned resources. Identity and permissions must be verified server-side; they **must not** be trusted from query parameters or iframe messages. Avoid putting requirement content or access tokens into the URL. Session auth must be time-limited, origin-bound, auditable, and protected against replay.

## Future lifecycle endpoints (not implemented)

- `POST /api/v1/embed/sessions`: server-to-server, signed context exchange; returns short-lived launch handle.
- `POST /api/v1/projects/:projectId/demo/generate`: interprets selected requirement and creates a draft version.
- `POST /api/v1/demos/:demoId/edits`: targeted Locate → Patch → Verify operations.
- `GET /api/v1/demos/:demoId/versions/:version`: immutable definition snapshot.
- `POST /api/v1/demos/:demoId/publish`: publishes versioned read-only public snapshot.
- `GET /api/v1/projects/:projectId/demo`: retrieves existing demo across story additions.

## Integration invariant
One Demo Builder service and renderer; standalone and embedded workspaces share the same capabilities. A project retains its demo ID across successive stories. No cross-project data access. Published demo URLs use a separately sandboxed viewer; no access to editor credentials or MEYON resources.

## Piece 4 current readiness (November 2026)

- Standalone projects, chat-generated Demo Definition, and scope-verified single-screen/global-header refinements work without MEYON.
- Read-only portable published snapshots are available at the frontend's `#/view/<encoded-snapshot>` route. These do **not** implement the future MEYON version API, server publication database, access permissions, or revocation.
- Shared viewer is a client-side route on the same frontend origin; it is **not** an iframe sandbox or separately hosted isolated renderer.
- The future MEYON Project → Demo tab must pass **server-authenticated, permission-checked** context with explicit feature/story baseline versions, not a user-controllable URL string.
- A durable `demoId` and version ID, story/feature baseline references, design guidelines, change provenance, optional custom component allowlisting and a signed embed session are requirements for a production integration.
- Do not expose `DEMO_ACCESS_TOKEN` or `OPENAI_API_KEY` to an embedded viewer. The current shared access token is a NONPROD measure, not proper project isolation.
- No MEYON repository, deployment or database was modified by Piece 4.

## Current browser-only limitations

The project editor stores drafts, chats and saved snapshot-link metadata in its own local browser storage. Files record names only. A published URL embeds demo content, so links must be treated as publicly shareable data, not private links. No automatic sync or server-side project record exists yet.

