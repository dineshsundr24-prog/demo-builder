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

## Piece 1 boundaries
The Piece 1 UI persists drafts only in the current browser's local storage. It allows adding requirement text, project settings and attachment *names*; uploaded file content is not retained or parsed. The chat collects user instructions **but does not call AI**. It never invents a response. The live preview uses a labeled sample or imported JSON definition.

Do not describe Piece 1 as AI-powered generation, screenshot parsing, durable server-side saving, or MEYON integration. Those are later pieces.
