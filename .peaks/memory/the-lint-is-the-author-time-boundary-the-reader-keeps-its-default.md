---
name: the-lint-is-the-author-time-boundary-the-reader-keeps-its-default
description: the-lint-is-the-author-time-boundary-the-reader-keeps-its-default
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lint.md
---

§14.6 was closed at the LINT boundary, not by changing `extractMetadata`. A present-but-unusable
`- type:` still falls back to `DEFAULT_REQUEST_TYPE` at read time; the difference is that `request
lint` now refuses it while the artifact is being written, and the commit leg already names the
fallback. An ABSENT `- state:` line is still not flagged (that is §10.5's remaining half).

**Why:** changing the reader's default would alter every untyped request's prerequisite table and
re-decide a documented fail-closed rule. The author-time boundary is where the producer can act.

**How to apply:** keep read-time defaults stable; make write-time validation loud. If an absent
metadata line must also be refused, that is a separate ruling with its own compatibility cost.
