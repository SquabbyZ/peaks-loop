---
name: dispatch-prompt-is-the-choke-point-for-context-enforcement
description: dispatch-prompt-is-the-choke-point-for-context-enforcement
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-09-06-session-a87ca4/txt/handoff.md
---

## Dispatch system prompt is the choke point for context enforcement

When a scan/detection exists but a behavior (e.g. "use the installed UI component library, not native DOM") still isn't honored, the reliable enforcement point is `src/services/context/build-dispatch-system-prompt.ts` — the single composer every role dispatch passes through. Surfacing the detected context as a pre-composed block (like the existing `codegraphBlock`) is more reliable than relying on the sub-agent to read a standards file.

**Why:** standards files (`.peaks/standards/**`) are indirect — the sub-agent may skip them; the dispatch prompt is in-context and authoritative at the moment code is written.

**How to apply:** when any project-scan signal (component library, build tool, CSS framework, routing, state) needs to be *enforced* downstream, add an optional pre-composed block field to `DispatchPromptInput` (keep the composer pure — thread data in, no IO) and render it at the dispatch site for the roles that generate that code. Reuse the existing rule/label helpers as the single source of truth.

Also: `peaks sub-agent dispatch` now REQUIRES `--graph-node <id>` (RD §4 D4c) — prepare it via `peaks workflow init --skill peaks-code` then `peaks workflow node prepare --workflow <wid> --node <nid> --kind dispatch`, then dispatch with `--graph-node <nid> --workflow-id <wid>`.
