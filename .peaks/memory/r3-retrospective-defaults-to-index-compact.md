---
name: r3-retrospective-defaults-to-index-compact
description: Retrospective reads come from `peaks retrospective index --json`, not the legacy `.peaks/retrospective/<id>/*.md` dirs.
kind: lesson
sourceArtifact: src/services/retrospective/retrospective-index.ts
---

# r3 — retrospective reads come from index.json

Slice 023 (R3). The 88 legacy `.peaks/retrospective/<id>/*.md` files
(853 KB total) are gone from the live tree. They are archived at
`.peaks/_archive/retrospective-2026-06-09-pre-r3.tar.gz` and the live
tree contains only `.peaks/retrospective/index.json`.

To read retrospective data, ALWAYS use `peaks retrospective index --json`
or `peaks retrospective show <id> --json`. The legacy MD paths are not
loaded on the hot path; if you need an old body, re-hydrate from the
archive (`tar -xzf .peaks/_archive/retrospective-2026-06-09-pre-r3.tar.gz`)
into a temp dir and read from there.

## Rules

- **Never** `cat .peaks/retrospective/<id>/**` on the live tree (it
  returns ENOENT after the migration).
- **Always** use the CLI:
  - `peaks retrospective index --json` — list
  - `peaks retrospective show <id> --json` — one entry
  - `peaks retrospective show <id> --pretty --json` — pretty form
- Re-running the migration is a no-op: `peaks retrospective migrate --apply --json`
  on a migrated tree returns `status: 'no-op'`.

## Why

The MD tree was never read by the LLM in the typical flow; it was
write-only disk weight. 16× compression at the storage layer and a much
larger win at runtime (the JSON array parses once, then never re-reads).
The 50% context-budget target (PRD AC11) is gated on this slice.
