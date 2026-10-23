---
name: resolve-the-gate-that-refuses-you-and-do-not-call-the-bypass-a-decision
description: Resolve the gate that refuses you, and do not call the bypass a decision
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-t1-backlog-2026-10-23.md
---

Measured 2026-10-23 (T1 backlog campaign, rid `rid-t1-doc-claim-corrections`).
`peaks request transition <rid> --role rd --state qa-handoff` refused with `PREREQUISITES_MISSING`:
"Unit test files for the implemented changes (enforces peaks-rd Gate B2) — none of the escape-hatch
markers present: `test(`, `it(`". The slice had changed only prose — one backlog claim, one source
comment, one test-setup comment — so `qa/test-cases/<rid>.md` carried the `## Test cases` heading
with no real test invocation behind it.

The escape hatch was one flag away: `--allow-incomplete --reason`. The repository's own record says
not to take it. `.peaks/docs/diagnosis-2026-10-02-cli-build-drift-recheck.md` records the shape by
name — "the machine refused; I bypassed it and then blamed the machine" — and `.peaks/docs/backlog.md`
§9.x records that the bypass "is exactly the move a gate should not teach".

The resolution was to produce what the refusal names: a test that locks the two claims the slice
corrected, RED against the pre-change shape and GREEN after. That was also the better engineering —
the slice's own thesis was that a claim carried without measuring rotted, and a correction with no
test is one edit away from rotting back.

**How to apply.** Read a `PREREQUISITES_MISSING` refusal as a SPECIFICATION of the artifact it wants:
it names the path and the marker. Produce that artifact and re-run the transition. Reserve
`--allow-incomplete` for a pre-existing violation that is not yours to fix, and give it a reason
that names the boundary.
