# Artifact Retention

Each refactor slice must retain code and intermediate artifacts together, but the default retention target is local `.peaks/_runtime/<session-id>/` storage rather than git.

## Required retained artifacts

- PRD goal and acceptance artifacts;
- RD slice spec and task graph;
- QA coverage and validation reports;
- TXT context capsule and lessons;
- SC change impact and sync state;
- retention-boundary report, including commit details only when commits were explicitly authorized.

The next slice cannot start until code changes and intermediate artifacts are traceable in local `.peaks/_runtime/<session-id>/` storage. Commit or sync those artifacts only after explicit user confirmation or an active profile that clearly authorizes git/external retention.
