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

- `pass` — every AC has a passing test, the test suite is green, **and the approved-scope contract was delivered**: the `prd/handoff.md` source block reached the reviewer with its WHOLE byte count (`FOUND at … — N bytes`), because "complete" is defined against the approved scope and its non-goals, and a test report alone shows only that *something* was built.
- `fail` — one or more ACs are unmapped, the targeted test is failing, or the suite is red on a non-flaky ground.
- `inconclusive` (needs-human) — the mapping is plausible but the human needs to confirm that a passing test truly reflects the business intent of an AC. Example: a test exists for "config-service splits into 3 modules" but the human must decide whether the *seam* the test exercises is the seam they actually wanted.

### When the scope contract does not arrive — same rule as dimension 4

The service keys this dimension's `pass` on the **delivery** of its scope contract, not on its existence on disk, for the same reason dimension 4 keys its `pass` on the delivered baseline:

| Situation | What the reviewer is told | Verdict the service allows |
|---|---|---|
| `prd/handoff.md` inlined in full | `STATUS: FOUND at … — N bytes` | `pass` is available |
| `prd/handoff.md` present but the budget did not reach it, or the read was truncated | `STATUS: MISSING (omitted)`, or `TRUNCATED, showing the first N of M bytes` | `pass` is downgraded to `inconclusive`, with a `scope-contract-gate` marker in the summary |
| `prd/handoff.md` exists for this run but carries nothing (0 bytes / whitespace) | `STATUS: MISSING (empty)` | Same downgrade: the PRD phase ran and the reviewer was given no contract. An empty contract is a delivery failure, not an absent phase. |
| `prd/handoff.md` exists but this process could not read it (EACCES / EBUSY / EISDIR) | `STATUS: UNREADABLE` | Same downgrade. Deliberately NOT reported as "no PRD phase": the file is there, the read failed, and only one of those two facts is fixable. |
| No `prd/handoff.md` in this project at all — ENOENT (no PRD phase) | `STATUS: MISSING (missing)` | Not a delivery failure — the dimension is judged on the evidence that exists. Absence is not the same fact as non-delivery. |

The delivery rule is deliberately not "some bytes arrived": `qa-test-report` also supports this dimension, which is exactly how a `pass` used to survive while the contract that defines the dimension was inlined with **zero** bytes. See `enforceScopeContractDelivery()` in `src/services/final-review/final-review-service.ts`.

The contract source holds a **floor** in the byte allocator: its whole unit is reserved for this dimension, so a saturated run can no longer drop it as a side effect of the allocation order. The downgrade rows above are therefore about a document that is genuinely absent, empty or unreadable — not about a contract that merely happened to sit last in the order.

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

- `pass` — the baseline was **compared and delivered**: the pre/post diff block reached the reviewer **with its conclusion** (`STATUS: FOUND`, and the `VERDICT:` line is in the delivered bytes — the verdict is the first thing in the artifact, so an over-cap slice still carries it), and every measured dimension (tests, API, behavior) is unchanged or changed only in ways that the slice was explicitly authorized to change (e.g. AC-2 says "add a new exported helper `resolveWithSchema()`" — that IS the authorized change).
- `fail` — an unauthorized change slipped in: an exported symbol disappeared, a test was deleted rather than updated, a behavior baseline drifted without a corresponding AC.
- `inconclusive` (needs-human) — a change is present that *could* be authorized drift or *could* be an unintentional regression. The human rules.

### When the baseline itself is missing — the one case where no verdict can be earned

A `pass` here rests on a **comparison**, so two things must both be true: the producer had to *compute* a baseline, and that baseline had to *reach the reviewer's prompt* — conclusion included. Neither substitutes for the other.

| Situation | What the reviewer is told | Verdict the service allows |
|---|---|---|
| Baseline computed and inlined | `STATUS: COMPUTED` + the diff block | `pass` is available |
| Baseline computed, dropped by the evidence budget | `STATUS: COMPUTED ON DISK, NOT DELIVERED` + the block marked `MISSING (omitted)` | `pass` is downgraded to `inconclusive` |
| Baseline inlined but larger than the per-file cap | `STATUS: FOUND … TRUNCATED, showing the first N of M bytes` — the slice still opens with the `VERDICT:` line | `pass` is available (the conclusion is in the delivered bytes) |
| No base ref resolves / base resolves to HEAD (empty range) | `STATUS: UNAVAILABLE` + the reason | `pass` is downgraded to `inconclusive` |
| The project is not a git work tree | `STATUS: UNAVAILABLE` + the reason | `pass` is downgraded to `inconclusive` — permanently, on every run |

The "dropped by the evidence budget" row is now a defensive branch rather than the expected failure: this source holds a **floor** in the allocator — its whole unit is reserved for this dimension — so when a baseline IS computed it is delivered, and the reviewer is never asked to judge this dimension against a comparison it was not shown. The rows that still fire are the ones where no baseline exists to deliver.

Three consequences worth stating plainly, because all three read like defects and are not:

- **A non-git project can never reach `allPass === true`.** Dimension 4 is permanently `inconclusive` there: no comparison exists to hand over, so there is no honest way to have it green. The service does not invent one, and a design-intent document (`rd/tech-doc.md`, `prd/handoff.md`) is not a substitute — it states what was intended, not what changed. There is no CLI way out either: `--base <ref>` names a COMMIT to compare against, so it cannot help a project that has no git history to resolve a ref in — the reason the reviewer is given is the project's state, not a missing argument.
- **A dimension whose evidence was omitted does not get a pass "because the file exists".** If the block is not in the prompt, the reviewer never saw it; the service downgrades the verdict and does **not** attach the artifact as an `EvidenceItem`, because an envelope citing evidence the reviewer never received is the forged clean handoff this gate exists to prevent.
- **A saturated run can redden more than one dimension, and that is the honest reading.** The evidence budget allocates each source WHOLE or not at all (never a partial slice), so a run whose sources do not all fit drops whole sources — and each dimension whose contract source was dropped loses its `pass`: dimension 4 when the baseline goes, dimension 1 when the approved-scope contract does.

### Example

> `dimension: "existing-functionality-intact"`, `verdict: "pass"`, `summary: "Public API snapshot: 0 symbols removed, 1 symbol added (resolveWithSchema — authorized by AC-2). Test count: +12 (new tests for resolveWithSchema), -3 (deleted tests for the old monolithic resolve that resolveWithSchema supersedes). CLI help text byte-identical to pre-fix golden."`, `evidence: [{ kind: "pre-post-diff", description: "Public API surface diff: +resolveWithSchema, -3 obsolete test files, no other deltas", artifact: ".peaks/_runtime/<sessionId>/final-review/api-diff.txt" }]`, `confidence: "high"`.

---

## How `allPass` and `needsAttention` are computed

The service contract (`src/services/final-review/final-review-service.ts:23-31` and `:88-93`):

- `allPass === true` iff every dimension's `verdict === 'pass'` **and** the service itself has nothing to flag. The two fields are derived from the verdicts, never copied from the model's own summary: a model that wrote a fabricated `pass` plus a matching `allPass: true` cannot hand over an unsupported clean review.
- `needsAttention` is the list of dimension names whose verdict is `fail` or `inconclusive`, **plus** any dimension the service has to flag mechanically even though the reviewer passed it. The one such flag today is a delivered pre/post baseline whose own `VERDICT:` line reports `STRUCTURAL DRIFT DETECTED` (or a verdict line the service cannot classify): a detected structural removal may well be authorized, but a review that says "4/4 pass, nothing needs attention" directly above a diff that reports a removal it attached itself is self-contradicting, so that dimension is listed and `allPass` is `false`. The dimension's verdict is left as the reviewer wrote it — the call on whether a removal was authorized stays with the reviewer and the human. A second, related case is NOT a mechanical flag but a structural red the service explains: when **every** source on disk supporting a dimension is larger than the per-file cap (10,240 bytes, derived from `MAX_EVIDENCE_BYTES_TOTAL`), no source can ever be delivered under the `whole` rule, so the reviewer is told so in a `## Evidence delivery reachability (structural)` block and the dimension's summary carries a `delivery-reachability` marker naming the source and its byte count. Such a dimension is `inconclusive` by byte arithmetic — never by having passed and been overruled — and it appears in `needsAttention` through the ordinary non-`pass` route, which is what makes the CLI envelope state the reason instead of leaving a permanent red unexplained.
- The LLM does NOT need to populate `needsAttention` — the service enforces presence of all 4 dimensions and derives the field.
- An `IncompleteFinalReviewError` is thrown when JSON is malformed or any required dimension is missing. That is a **gate failure**, not a `fail` verdict — the LLM call is invalid and must be re-prompted, not surfaced to the human.

## Confidence and what it means

- `high` — evidence is concrete (named test file, named artifact, deterministic run).
- `medium` — evidence is concrete but covers only part of the dimension; the LLM is being honest about coverage gaps.
- `inconclusive` verdicts should always be `medium` or `low` confidence; `high` confidence on `inconclusive` is a contradiction and the LLM should be re-prompted. The service does not rely on the re-prompt alone: it clamps a `high` on an `inconclusive` verdict to `medium` and marks the summary, so the contradiction cannot reach the human in the envelope even if the model keeps producing it.
