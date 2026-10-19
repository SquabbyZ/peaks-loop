---
name: satisfy-a-gate-s-invariant-at-the-producer-and-make-the-printed-remedy-run-verbatim
description: satisfy a gate's invariant at the producer, and make the printed remedy run verbatim
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-19-session-94b084/txt/handoff-ledger-provisional.md
---

A gate that refuses a state is not the place to fix the state. `peaks job init` created a ledger
that the Step 0.8 gate read as "the decision step was skipped", so every Bash call was refused —
and the printed remedy was itself a Bash call. The durable fix is at the producer: the tool that
creates the state the gate keys on records the decision that state implies. When the producer cannot,
it must surface the failure and the exact command that repairs it.

**Why:** an invariant enforced only by a reader is a report, not an invariant. Moving the write to the
producer removes the reachable bad state instead of teaching every caller to recover from it.

**How to apply:** for every gate, ask which tool creates the state it reads, and make that tool
establish the invariant (or fail loudly). Then execute the remedy the gate prints, verbatim, in a
test: the consequence command may need `--force` because the artifact it replaces already exists,
and a remedy that exits 1 is worse than none.
