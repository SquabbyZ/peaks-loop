# Slice execution regime

> Created 2026-09-22. Four efficiency levers the user adopted after the S13–S16
> run produced ~20 sub-agent-hours for −45 findings, with three of those slices
> producing **zero** findings.
>
> This file records the *decisions* and their **boundaries**, so the carve-outs
> below can be told apart from drift.

---

## Why this file exists — the measured cost

| slice | wall clock | findings |
|---|---|---|
| S13 | 4.2 h | −26 (and mainly *proved its premise false*; stop-loss cut one small cluster) |
| S14 | 4.5 h | **0** |
| S14b | 0.1 h | 0 (one pin literal) |
| S15 | 6.9 h | −19 |
| S15b | 1.7 h | 0 (repairing S15's out-of-scope behaviour change + adding its tests) |
| S16 | 3 h+ | 0 (timeout budget + two pin literals) |
| **total** | **~20 h** | **−45** |

For contrast, S12 alone was −258.

**The single sharpest symptom:** `tests/unit/standards/esm-relative-import-extension.test.ts`
has been re-pinned **five times** in five consecutive slices (S12 `1197→1201`,
S13 `2738→2748`, S14b `2748→2786`, S15 `2786→2792`, S16 `2792→2793`).
One integer, five round trips. That is a structural defect, not bad luck.

---

## Lever 1 — batch, don't slice one root at a time

**Decision:** one dispatch covers **3–5** roots rather than one.

**Why it pays:** verification is paid **per slice**, not per root. The gate, the
census, the AST count, the six tsc runs and the suite are all whole-repo costs,
so they are amortised over the batch instead of repeated per root.

**Accepted cost:** a larger blast radius per dispatch, and a harder time
attributing a regression to a single root. Budget the extra attribution effort
into the batch rather than discovering it later.

---

## Lever 2 — the full suite runs at batch boundaries, not per slice

**Decision:** `pnpm test:unit` (full) runs **once per batch boundary**.
Within a batch, run **scoped** test files only.

**Why it pays:** the full suite is ~40 minutes on this host and is the largest
single block of per-slice time — and it is run 2–3× per slice because it is
flaky. For slices that only touch test helpers, scoped runs also carry **more**
information than a whole-suite pass.

**Accepted cost:** no whole-repo regression signal *inside* a batch. The
boundary run is therefore **mandatory and must not be skipped**, and it must be
run when nothing else is loading the host — three contaminated measurements in
one day came from measuring under concurrent work.

**This does not change the pre-push gate.** `.husky/pre-push` still runs the
full suite; what changes is how often *we* run it while iterating.

---

## Lever 3 — the pin must stop needing manual maintenance

**Decision:** redesign the pin so adding a file does not require editing a
literal.

**Why it pays:** it removes the recurring round trip described above. Five
re-pins is five dispatches' worth of overhead for one integer.

**Boundary — this is the part that must not be got wrong:** the pin exists to
notice **unintended** movement (a walk that stops early, a node kind that gets
dropped). A redesign that makes the number self-derived is only acceptable if
**the guard can still fail**. Concretely, it must keep:

- a **reach** pin (how many files / specifiers were actually walked), so a
  broken traversal cannot pass as a clean one; and
- an **injection control** (break the walk → the guard goes red).

A pin that auto-derives its own expectation from the same code it guards is
**not** a guard — it is a tautology. Whatever replaces the literal must keep a
*separately measured* number and an arm that proves it can fail.

---

## Lever 4 — mechanical one-line changes: orchestrator may apply directly

**Decision (explicit user re-confirmation, 2026-09-22):** the **Code-Change Red
Line** is carved out for **mechanical one-line changes only**, so the
orchestrator does not spend a multi-hour sub-agent round trip on a single
literal.

### What is allowed

- changing a **numeric literal** in an existing assertion pin
  (e.g. `toBe(2793)` → `toBe(2794)`) **where the measured value is independently
  confirmed by the orchestrator** — not taken from an agent's report;
- adding or changing a **`timeout` option** on an existing test, using the
  repo's existing convention in `tests/unit/_setup/subprocess-timeouts.ts`.

### What is NOT allowed

- changing what an assertion **means**, or its comparison operator;
- adding, deleting or skipping a test;
- touching **production** code (`src/`, `packages/`) for any reason;
- touching `config/`, `bin/`, `scripts/`, or `.peaks/lint/gate-baseline.json`
  (the baseline stays the orchestrator's, as before);
- any edit whose justification is *"it's basically one line"* rather than
  *"it is one line and here is the measurement"*.

### The declaration obligation

Every such edit is declared in the orchestrator's summary with: the file, the
line, the before/after value, and **the measurement that justifies it**. An
undeclared direct edit is a Red Line violation, not a convenience.

### Why the carve-out is narrow

The Red Line exists so the orchestrator is not the implementer. That purpose is
served as long as direct edits cannot change **behaviour** or **assertion
strength** — a pin literal and a timeout budget change neither. The moment an
edit could change what the code *does*, it goes back to a sub-agent.
