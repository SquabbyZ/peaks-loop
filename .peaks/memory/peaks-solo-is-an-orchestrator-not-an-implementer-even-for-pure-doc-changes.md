---
name: peaks-code-is-an-orchestrator-not-an-implementer-even-for-pure-doc-changes
description: peaks-code is an orchestrator, not an implementer, even for pure doc changes
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-07-03-session-ee2aba/txt/handoff.md
---

Confirmed in practice (slice 001-skill-authoritative-sentence): even when the implementation surface is a single SKILL.md line (zero code, zero CLI, zero schema), peaks-code's hard ban still applies — the orchestrator does **not** call Edit/Write directly on the source file. The proper flow is:

  solo → peaks-audit (6-dim envelope) → peaks request init --role rd (state=draft) → inline Edit (RD is a sub-agent running under the main loop when solo is the parent in assisted mode; solo owns the skill presence) → peaks-qa (independent re-run; here: vitest single-file) → peaks-final-review (4-dim JSON envelope to `.peaks/_runtime/<sid>/final-review/<rid>.json`) → peaks-txt (handoff + peaks memory extract --apply).

The Edit call only happens because the dispatched role is **peaks-rd** — not because peaks-code has an Edit exception. Skipping the audit/rd/qa/final-review/txt chain for "small docs" is exactly the kind of silent shortcut that the v2.18.3 audit flagged. Stay on the runbook.

Affected skills: peaks-code, peaks-rd.
Stable for memory: yes — applies to every peaks-code invocation regardless of slice size.
