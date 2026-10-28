---
name: the-same-identifier-disagreement-made-two-different-defects
description: One rid spelling mismatch produced an accusation in the gate and a wrong number in the metric
metadata:
  type: lesson
  sourceArtifact: .peaks/docs/backlog.md#23
---

In one session (2026-10-28) **two unrelated surfaces** were defeated by the **same** identifier disagreement.
A slice's rid exists in two spellings: the request writer stamps `NNN-` on the artifact **filename**
(`002-2026-10-28-22-3-runtime-root-guard`), while the transition CLI is handed the **un-numbered** rid
(`2026-10-28-22-3-runtime-root-guard`). `requestIdFromFileName` is the repository's own rule that maps one to
the other — and **neither surface used it**.

- **The claim-table gate** (§23.1) looked up the claim table with the numbered rid, missed, and fell back to
  judging **the whole working tree**. It then accused a `chore` slice of carrying another slice's `src/**`.
- **The new compliance reader** (§23.10) keyed its sets on the **raw** rid string, so every slice was judged
  **twice** — 8 readings for 4 slices — and the reported rate was the mean over **8**, not over 4. Worse, the two
  spellings scored **differently** (0.5 vs 0.1667) because the artifact resolver finds `rd/requests/002-<rid>.md`
  but not `rd/requests/<rid>.md`, so one slice was counted once at each value.

**Why this is the lesson**: the second defect was **invisible in the first one's terms**. A gate that refuses is
loud; a metric that is quietly wrong is not — and it was wrong in the way that matters most for a measurement:
**the denominator was the count of spellings, not the count of things measured**. Nothing crashed, nothing was
red, and the number looked like a number.

**How to apply:**
- **When two surfaces disagree about an identifier, find the ONE rule that already reconciles them** and use it in
  both. The normalisation existed (`requestIdFromFileName` / `NUMBERED_PREFIX_RE`) — it was available and unused
  twice, in two files, by two authors.
- **A metric's denominator deserves the same scrutiny as its numerator.** "Mean over the session's slices" was
  the stated contract; the implementation averaged over rid strings. Ask what the count is *of*, and check it
  against the noun in the sentence.
- **The same spelling appearing in two forms is a hint, not noise.** Two spellings for one thing means something
  upstream is not normalising — hunt the producer before patching the consumer.

Related: [[a-gate-that-reads-the-wrong-identifier-blames-a-sibling-slice]],
[[a-test-that-asserts-a-value-pins-the-value-not-its-provenance]]
