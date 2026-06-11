---
name: openspec-proposal-md-format-title-case-sections-plain-bullets-no-checkboxes
description: OpenSpec proposal.md format — Title Case sections, plain bullets, no checkboxes
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-06-11-session-f0312d/txt/handoff.md
---

The OpenSpec parser (`src/services/openspec/openspec-scan-service.ts:60-64`) requires exact Title Case section names (`## What Changes`, `## Acceptance Criteria`, `## Out of Scope`, `## Dependencies`, `## Risks`) and plain `- ` bullets. `parseBullets` explicitly filters out lines starting with `[ ]`, `[x]`, or `[X]`. Future OpenSpec authors should default to this format; the validator silently rejects non-conforming proposals.
