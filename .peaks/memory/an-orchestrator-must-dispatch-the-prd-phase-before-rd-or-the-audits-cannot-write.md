---
name: an-orchestrator-must-dispatch-the-prd-phase-before-rd-or-the-audits-cannot-write
description: Skipping the PRD phase in a peaks-code run leaves the handoff capsule unwritten and every audit blocked
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-28-session-2ffed0/sc/briefs/qa-all.md
---

In a four-slice peaks-code run (2026-10-28), the orchestrator dispatched **RD** directly and skipped
the **PRD** phase. The PRD role owns two artifacts the RD phase's gate depends on:
`prd/requests/<rid>.md` (the product body) and `prd/handoff-<rid>.md` (the sha256-locked capsule
that `peaks prd handoff init` writes). Without the capsule:

- `peaks security-audit run` **refused to write its artifact** with `HANDOFF_MISSING`;
- `AUDIT_REQUIRES_HANDOFF` in the prereq table then blocked `rd → qa-handoff`;
- the RD sub-agent that hit this **correctly refused to author the PRD artifact itself** ("that is
  the PRD role's artifact") — and was then **stuck**, because nothing else was going to write it.

**Why:** the refusal was right and still produced a blocked slice. A sub-agent that respects a role
boundary and has no counterpart running will simply stop. The orchestration error was invisible from
inside the RD slice: the RD skill's own dispatch prompt lists the handoff as a prerequisite, but the
prompt does not say who produces it.

**How to apply:** in a peaks-code run, **PRD is not optional even when the "product" is already
decided** (a backlog item is a decided product). Dispatch `peaks sub-agent dispatch prd` for
every rid, in parallel with or before RD. The PRD agent's job is then narrow: fill the request
body with goals/non-goals/preserved-behavior/acceptance criteria and the four mandatory blocks,
then `peaks prd handoff init --apply` (the CLI computes the sha256 — **a hand-written capsule does
not satisfy the gate**) and transition `prd → confirmed-by-user → handed-off`.

Two related traps from the same run:
- **The RD sub-agent may be blocked by a SIBLING's missing work.** The type-corroboration gate
  reads the whole session's working tree, so a chore slice was blamed for another slice's
  `src/**` change. That is a real gate behaviour, not a bug to route around — see
  [[a-gate-that-reads-the-wrong-identifier-blames-a-sibling-slice]].
- **A sub-agent that reports "I cannot satisfy this gate" is reporting an ORCHESTRATION gap**, not
  a technical obstacle. The fix is to dispatch the missing role, not to widen the sub-agent's
  remit. When a sub-agent stops at a role boundary, read it as "the counterpart is not running".
