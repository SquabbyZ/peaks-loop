---
name: peaks-memory-start-blocks-must-survive-the-slice-close-not-stay-under-peaks-runtime
description: peaks-memory:start blocks must survive the slice close, not stay under .peaks/_runtime
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-07-03-session-ee2aba/txt/handoff.md
---

peaks-txt's Step 11 BLOCKING contract: durable, LLM-authored memories land in `.peaks/memory/` (the canonical project-local store). The .peaks/_runtime/<sid>/txt/handoff.md file is the artifact-scoped source — `peaks memory extract --artifact <handoff.md> --apply --json` is the **only** CLI that writes the .peaks/memory/ directory. Calling it without `--apply` only previews and writes nothing. embed `<!-- peaks-memory:start -->` blocks **inside the handoff capsule body**, not as separate files. Each block pairs a stable fact with the kind header (`lesson` / `rule` / `project` / `decision` / `convention` / `reference` / `module`). Without `--apply`, the workflow is silently incomplete and the slice-close claim is unsupported.

Affected skills: peaks-txt, peaks-solo (Step 11 gate enforcement).
Stable for memory: yes — applies to every Solo completion that should leave a trail.
