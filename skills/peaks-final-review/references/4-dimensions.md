# 4 Dimensions — Final Review

This reference defines the evidence contract, verdict semantics, and worked examples for the four `DimensionKind` values the LLM must produce in `FinalReviewOutput.dimensions[]`. The authoritative types live at `src/services/final-review/final-review-types.ts`. Verdict values: `pass | fail | inconclusive` (the type-level enum). `inconclusive` is the wire-level name; the human-facing label is **needs-human** — the human must judge this dimension rather than accept the LLM's verdict.

When the service at `src/services/final-review/final-review-service.ts` returns `allPass === true` and `needsAttention` is empty, every dimension was judged `pass`. Anything else surfaces to the human for review.

---

## 1. functional-completeness

### Definition

Every acceptance criterion in the approved audit-goal at `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json` is realized by at least one passing test, and no AC is left dangling. The LLM is asserting that the slice delivers what the human originally asked for, not just that "something was built."

### Evidence the LLM must produce

- An `ac-mapping` `EvidenceItem` for every AC in the approved goal's `successCriteria[]`. Each item references the AC by ID (e.g. `AC-1`) and the test file or test name that exercises it.
- A `test-result` `EvidenceItem` summarizing the run (e.g. `vitest run src/services/<x>` → 12/12 pass). `artifact` should be the report path; `link` the run URL when CI is involved.
- A `test-coverage` `EvidenceItem` if the project maintains a coverage threshold for the changed surface. Cover only what is gated by the project's own standards; do not invent thresholds.

### Verdict semantics

- `pass` — every AC has a passing test and the test suite is green.
- `fail` — one or more ACs are unmapped, the targeted test is failing, or the suite is red on a non-flaky ground.
- `inconclusive` (needs-human) — the mapping is plausible but the human needs to confirm that a passing test truly reflects the business intent of an AC. Example: a test exists for "config-service splits into 3 modules" but the human must decide whether the *seam* the test exercises is the seam they actually wanted.

### Example

> `dimension: "functional-completeness"`, `verdict: "pass"`, `summary: "All 3 success criteria from the approved goal are covered by passing tests. AC-1 covered by config-service.modules.test.ts; AC-2 covered by config-service.api.test.ts (public API snapshot unchanged); AC-3 covered by coverage report at 100% lines/branches for the changed files."`, `evidence: [...]`, `confidence: "high"`.

---

## 2. problem-resolution

### Definition

The original problem case the slice was opened to fix has a targeted test that fails without the fix and passes with it. This is the most concrete dimension — it asks the LLM to prove the slice actually solves the specific problem on the record, not a generic improvement.

### Evidence the LLM must produce

- A `test-result` `EvidenceItem` naming the targeted test (e.g. `tests/integration/<surface>/regression-XXX.test.ts`) with the repro steps encoded as test assertions, and the post-fix result (pass).
- A `manual-spot-check` `EvidenceItem` when the original problem was a UI or operator-facing behavior that cannot be unit-tested cleanly. `artifact` should point to the recorded evidence (screenshot, log capture, transcript).
- An `ac-mapping` `EvidenceItem` linking the targeted test back to the original problem statement (e.g. the audit-goal's `proposedGoal` or the human's verbatim "fix X" wording). Without that link, the test is just coverage, not problem-resolution evidence.

### Verdict semantics

- `pass` — there is a targeted test that proves the original case is fixed AND that test is currently green.
- `fail` — there is no targeted test, the targeted test is red, or the targeted test does not actually reproduce the original problem (e.g. it tests an adjacent but different case).
- `inconclusive` (needs-human) — the targeted test exists and is green, but the human must confirm the test does reproduce the problem they originally reported. Example: the LLM fixed a config-file write race but the targeted test exercises a slightly different code path than the user's reproducer.

### Example

> `dimension: "problem-resolution"`, `verdict: "pass"`, `summary: "Targeted test repros the original config-write race (concurrent writes to the same key) and now passes deterministically. The test fails on the pre-fix commit and passes on the post-fix commit."`, `evidence: [{ kind: "test-result", description: "tests/integration/config-write-race.test.ts — 200/200 deterministic", artifact: "tests/integration/config-write-race.test.ts" }, { kind: "ac-mapping", description: "Maps to the user's reported repro: 'concurrent config writes corrupt the file'" }]`, `confidence: "high"`.

---

## 3. no-new-bugs

### Definition

The slice did not introduce net-new failures. The pre-existing regression suite is green AND the LLM performed targeted spot-checks on surfaces adjacent to the change (imported modules, callers, fixtures, type signatures). A green regression suite alone is insufficient — a slice can "fix" one thing while breaking an adjacent surface that no test directly covers.

### Evidence the LLM must produce

- A `regression-suite` `EvidenceItem` showing the full suite is green on the post-fix commit, with the run command and the aggregate pass/fail/skip count.
- One or more `manual-spot-check` `EvidenceItem` entries for each adjacent surface the LLM inspected (e.g. "called `config-service.resolve()` from a downstream consumer in a 30-second smoke run; output identical to the pre-fix golden"). List the surfaces explicitly.
- A `test-result` `EvidenceItem` for any newly-added test that targets the changed surface's direct neighbors (callers, importers, shared fixtures).

### Verdict semantics

- `pass` — regression suite is green AND every adjacent surface the LLM spot-checked behaves correctly.
- `fail` — the regression suite is red OR a spot-check surfaced a behavior change that is not part of the slice's scope (out-of-scope regression).
- `inconclusive` (needs-human) — the regression suite is green but at least one adjacent surface was either not spot-checked or surfaced a behavior the LLM cannot rule out as intentional. The human judges whether the behavior is acceptable drift or a hidden bug.

### Example

> `dimension: "no-new-bugs"`, `verdict: "pass"`, `summary: "Full vitest suite green (2417/2417). Spot-checked 4 adjacent surfaces: callers in src/cli/commands/*, the resolve() consumer in src/services/runtime-bootstrap, the schema fixtures in tests/fixtures/config, and the type signatures exposed via the index file — all behaviorally identical to the pre-fix golden."`, `evidence: [...]`, `confidence: "high"`.

---

## 4. existing-functionality-intact

### Definition

A pre/post baseline diff shows no unintended drift in the test surface, public API, or key behavior. This is the structural counterpart to `no-new-bugs`: where `no-new-bugs` is "I ran the suite and spot-checked," this dimension is "I compared the structural shape of the project before and after the slice." The two dimensions can both pass and tell complementary stories — a green suite with a shrinking public API is still a regression in `existing-functionality-intact`.

### Evidence the LLM must produce

- A `pre-post-diff` `EvidenceItem` with a concrete diff artifact: a test-count diff (e.g. `+12 / -3`), a public-API surface diff (e.g. a snapshot of exported symbols from the package's main entry), or a behavior-baseline diff (e.g. golden output of an end-to-end happy path).
- A `test-result` `EvidenceItem` for any existing test that touched the changed surface, confirming it still passes on the post-fix commit.
- A `manual-spot-check` `EvidenceItem` for any behavioral baseline that is not covered by a test (e.g. CLI help text, error message format) — the LLM must record the pre and post values.

### Verdict semantics

- `pass` — every measured dimension (tests, API, behavior) is unchanged or changed only in ways that the slice was explicitly authorized to change (e.g. AC-2 says "add a new exported helper `resolveWithSchema()`" — that IS the authorized change).
- `fail` — an unauthorized change slipped in: an exported symbol disappeared, a test was deleted rather than updated, a behavior baseline drifted without a corresponding AC.
- `inconclusive` (needs-human) — a change is present that *could* be authorized drift or *could* be an unintentional regression. The human rules.

### Example

> `dimension: "existing-functionality-intact"`, `verdict: "pass"`, `summary: "Public API snapshot: 0 symbols removed, 1 symbol added (resolveWithSchema — authorized by AC-2). Test count: +12 (new tests for resolveWithSchema), -3 (deleted tests for the old monolithic resolve that resolveWithSchema supersedes). CLI help text byte-identical to pre-fix golden."`, `evidence: [{ kind: "pre-post-diff", description: "Public API surface diff: +resolveWithSchema, -3 obsolete test files, no other deltas", artifact: ".peaks/_runtime/<sessionId>/final-review/api-diff.txt" }]`, `confidence: "high"`.

---

## How `allPass` and `needsAttention` are computed

The service contract (`src/services/final-review/final-review-service.ts:23-31` and `:88-93`):

- `allPass === true` iff every dimension's `verdict === 'pass'`.
- `needsAttention` is the list of dimension names whose verdict is `fail` or `inconclusive`. The LLM does NOT need to populate it — the service enforces presence of all 4 dimensions and the human-facing summarizer (in peaks-code or peaks-txt) computes `needsAttention` for display.
- An `IncompleteFinalReviewError` is thrown when JSON is malformed or any required dimension is missing. That is a **gate failure**, not a `fail` verdict — the LLM call is invalid and must be re-prompted, not surfaced to the human.

## Confidence and what it means

- `high` — evidence is concrete (named test file, named artifact, deterministic run).
- `medium` — evidence is concrete but covers only part of the dimension; the LLM is being honest about coverage gaps.
- `inconclusive` verdicts should always be `medium` or `low` confidence; `high` confidence on `inconclusive` is a contradiction and the LLM should be re-prompted.
