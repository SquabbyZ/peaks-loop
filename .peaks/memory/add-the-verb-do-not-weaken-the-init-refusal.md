---
name: add-the-verb-do-not-weaken-the-init-refusal
description: add-the-verb-do-not-weaken-the-init-refusal
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-qamarker.md
---

The fix adds `peaks request mark-qa-initiated`; it does not make `request init --role qa` accept an
existing artifact. The refusal is a real guard against overwriting a request record, and the stuck
case needed an alternative path, not a looser guard.

**Why:** weakening the guard would let `init` rewrite or race a real artifact; the in-order verb writes
only the marker and never enters `qa/requests/`.

**How to apply:** when a guard blocks a legitimate state, add the narrow operation the state needs
rather than relaxing the guard.
