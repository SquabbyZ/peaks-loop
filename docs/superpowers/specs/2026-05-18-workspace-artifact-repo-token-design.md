# Workspace Artifact Repo Token Design

## Goal

Each workspace should carry the git repository needed for Peaks-managed intermediate artifacts and `.claude/memory`, plus the corresponding git token. The repository remains the existing `artifactRepo` concept so current artifact sync behavior stays compatible.

## Configuration Shape

Extend each `workspaces[]` item in `config.json`:

```json
{
  "workspaceId": "ice-cola",
  "name": "Ice Cola",
  "rootPath": "/path/to/project",
  "installedCapabilityIds": [],
  "artifactRepo": {
    "provider": "github",
    "owner": "YOUR_ARTIFACT_REPO_OWNER",
    "name": "YOUR_ARTIFACT_REPO_NAME",
    "token": "YOUR_GIT_TOKEN"
  }
}
```

`artifactRepo` is the shared git repository for both intermediate artifacts and `.claude/memory`. No separate `memoryRepo` is introduced.

## Behavior

- `WorkspaceConfig.artifactRepo` gains an optional `token` string.
- `peaks config workspace add` gains an optional token flag for writing the token with the repo metadata.
- Artifact sync uses `workspace.artifactRepo.token` first when present.
- Existing `GH_TOKEN` fallback remains for compatibility when a workspace token is not configured.
- Git remote URLs stay public, e.g. `https://github.com/owner/repo.git`; auth is passed through git extra headers.
- Token masking/redaction is intentionally not added in this change per product direction.

## Validation

- Provider remains limited to `github` or `gitlab`.
- Owner and repo name keep the existing safe path segment validation.
- Token is optional and accepted as a non-empty string when provided.

## Documentation

Update README config examples to show `artifactRepo.token` and clarify that this single repo stores both intermediate artifacts and `.claude/memory`.

## Tests

- Config type/default behavior continues to accept workspaces without tokens.
- CLI workspace add writes the token when provided.
- Artifact sync prefers the workspace token over `GH_TOKEN`.
- Existing `GH_TOKEN` behavior still works when no workspace token is configured.
