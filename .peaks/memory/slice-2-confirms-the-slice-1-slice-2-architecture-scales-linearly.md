---
name: slice-2-confirms-the-slice-1-slice-2-architecture-scales-linearly
description: slice #2 confirms the slice #1 + slice #2 architecture scales linearly
metadata:
  type: module
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

Slice #2's perf baseline shows the cwd-fallback path in `detectIdeFromContext` scales linearly with adapter count: 1 adapter = ~17 µs, 2 adapters = ~27 µs. At 6 adapters (claude + trae + cursor + codex + qoder + tongyi), the fallback would be ~80 µs. Still well under 1ms, but worth re-measuring at slice #6. The env-var hit and stdin-shape detection are essentially free (~0.2 µs) regardless of adapter count. The `assertSafeSettingsFile` cost is dominated by `realpathSync` syscalls and is adapter-agnostic.
