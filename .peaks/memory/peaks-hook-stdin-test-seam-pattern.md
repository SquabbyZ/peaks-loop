---
name: peaks-hook-stdin-test-seam-pattern
description: PEAKS_HOOK_STDIN test seam pattern
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

The `PEAKS_HOOK_STDIN` env var is the test seam for hook stdin in both `peaks gate enforce` (gate-commands.ts) and `peaks hook handle` (hook-handle.ts). Production reads stdin when the env var is unset; the env var short-circuits to allow tests to inject a JSON payload without hanging on real stdin. DO NOT add a `NODE_ENV` guard — the seam is reachable from any process env, but the payload still routes through `enforceBashCommand` SOP gate, so practical impact is bounded (security-review M-1). Future hook-related commands should follow the same pattern.
