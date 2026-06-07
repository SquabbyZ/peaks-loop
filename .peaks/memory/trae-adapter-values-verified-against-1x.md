---
name: trae-adapter-values-verified-against-1x
description: Trae adapter values (hookEvent, toolMatcher, settingsFileName, TRAE_DENY_SHAPE) verified against Trae 1.x fixture + live dispatch path
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/qa/dogfood-trae-1x-2026-06-07.md
  predecessor: trae-adapter-values-hookevent-toolmatcher-envvar-are-1-x-assumptions-not-verified.md
  status: verified-as-is-2026-06-07
  appliesTo: src/services/ide/adapters/trae-adapter.ts, src/services/ide/hook-protocol.ts
---

The Trae adapter's 4 UNVERIFIED fields (slice #3 closeout code-review M-1) are **VERIFIED-AS-IS** as of slice 009-009-2026-06-07-trae-dogfood (2026-06-07):

| Field | Value | Verified against |
|---|---|---|
| `hookEvent` | `'beforeToolCall'` | Trae 1.x fixture + on-disk `.trae/settings.json` (Path 1 in dogfood report) |
| `toolMatcher` | `'terminal'` | Trae 1.x fixture + dispatch envelope + on-disk settings.json (Paths 1, 8) |
| `settingsFileName` | `'settings.json'` | Trae 1.x fixture + on-disk path resolution (Path 1) |
| `TRAE_DENY_SHAPE` constant | `hookSpecificOutput.{hookEventName, permissionDecision, permissionDecisionReason}` | Unit test `formatDecisionResponse("trae", "deny", "<reason>")` (Path 8 in unit tests) |

The verification was fixture-based (no live Trae 1.x install available in this environment, per slice 009 PRD R-1) but exercised the same `peaks hooks install` / `peaks statusline install` / `peaks hook handle` dispatch path that a real Trae install would trigger. A follow-up slice should re-run the same 5+ dogfood paths on a real Trae 1.x install when one is available; the fixture + new test file make that re-run cheap (1 CLI invocation + 10 unit tests).

**Caveat:** The `mcpInstall: false` and `subAgentToolMatcher: 'Task'` fields are still UNVERIFIED — they are out of scope for this slice. `mcpInstall` is owned by #012 (MCP decoupling). `subAgentToolMatcher` is byte-stable on `'Task'` so the slice #008 install entry stays byte-stable; a real Trae 1.x sub-agent dispatch is needed to confirm/replace.

See: `.peaks/_runtime/2026-06-06-session-5b1095/qa/dogfood-trae-1x-2026-06-07.md` for the full resolution table + verbatim CLI output.
