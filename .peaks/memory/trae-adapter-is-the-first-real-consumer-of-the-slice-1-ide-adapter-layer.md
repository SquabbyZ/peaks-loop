---
name: trae-adapter-is-the-first-real-consumer-of-the-slice-1-ide-adapter-layer
description: Trae adapter is the first real consumer of the slice #1 IDE-adapter layer
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

Slice #2 registers Trae as a second built-in IDE. Confirms the slice #1 + slice #2 architecture: "fill the table" is genuinely cheap. Future adapters (Cursor / Codex / Qoder / Tongyi) are each ~50 lines of adapter file + a few tests. The `peaks-ide` skill is the user-facing surface for IDE install/switch/status; existing peaks CLI primitives are the only side-effect path (no new CLI command was added, per the dev-preference red line).
