# M8 — Dogfood: Real Crystallization

**Goal:** Run a real task on the peaks-loop repo (the spec + plan + M0 we just authored) and crystallize it into a real `loop_release` + `bee_release` + `crystallization_event`. The brief is reviewed by SquabbyZ; the user-side verdict is saved as a memory entry.

**Architecture:** The dogfood is the test that proves M2..M7 all work end-to-end. The chosen loop is the "spec + plan authoring loop" that produced this very spec. The main bee is the M0..M7 implementation bee.

**Procedure:**
1. Run a real task on the peaks-loop repo: "author a multi-slice Loop Engineering spec + plan + M0 implementation".
2. After M0..M7 ship, gather the workflow trace + run-state.
3. Build the `evidence_brief` (4 sections) from the trace.
4. Run `peaks asset crystallize --loop <id> --main-bee <id>` with the brief.
5. The CLI writes a real `crystallization_event` with the brief persisted; the loop lands as `candidate`.
6. Save a memory entry `.peaks/memory/2026-07-07-loop-engineering-first-crystallization.md` capturing the user verdict ("looks like a real loop; the brief was actually useful; the ratchet held; the import-as-candidate gate held").

**Validation (M8 exit):** the `crystallization_event` row exists; the brief passes lint; the memory entry is committed; the user-side verdict is recorded.

**Karpathy 4-section form (M8 enforces the existing RL-2 / RL-7; introduces no new red line):**
- Failure modes: dogfood produces an empty brief; dogfood bypasses the ratchet; dogfood fabricates evidence.
- Rewrite: every step in M8 must produce a real artifact (a real trace pointer, a real run-state, a real brief); no simulated numbers.
- Self-check: `crystallization_event.evidence_brief.sections.length === 4` and every section has a source trace pointer.
- Out-of-scope: simulated dogfood; "trust me" briefs.
