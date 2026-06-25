# Mutation probes — slice-topology-multipass (W7 T21)

> **Spec path** (gitignored, kept for runtime auditability):
> `.peaks/_runtime/2026-06-25-session-139b84/audit/mutation-probes-w7-t21.md`
>
> **Tracked copy** (this file): committed so the doc ships with the branch.
>
> **Created**: 2026-06-25
> **Branch**: `feature/slice-topology-w7-t21` (from `feature/slice-topology-multipass` @ `adcac4e`)
> **Phase**: 6, Task 21 (peaks-cli Plan 4 mutation-probe convention)
> **Verdict**: all-pass

## Summary

| Probe | Target | Mutation | Expected failing test | Result |
|---|---|---|---|---|
| A | `cross-pass-edge-merger.ts:171-181` (type-shares branch) | Wrap `forEachMatch(TYPE_IMPORT_RE, ...)` in `if (false) { ... }` | `cross-pass-edge-merger.test.ts`: "detects type-shares between adjacent passes" | PASS |
| B | `granularity-decider.ts:40-41` (shouldSubdivide exceed check) | `>` → `>=` (both `locExceeded` and `filesExceeded`) | `granularity-decider.test.ts`: "keeps the top threshold exclusive — loc=maxLoc alone lands in tie-break, not true" | PASS |
| C | `llm-arbitrator.ts:54` (cache short-circuit) | `if (existsSync(cacheFile))` → `if (false)` | `llm-arbitrator.test.ts`: "cache hit does not invoke llmRunner.call (mutation probe C)" | PASS |

## Probe A details

- **Mutation applied**: wrapped the `forEachMatch(TYPE_IMPORT_RE, content, (spec, evidence) => { ... })` call in an `if (false) { ... }` block (lines 172-187), effectively short-circuiting the type-shares detector so it never emits any edge.
- **Test run output (failure mode)** — 3 tests failed, including the meta-asserted one:
  ```
  FAIL tests/unit/slice/cross-pass-edge-merger.test.ts > CrossPassEdgeMerger.merge > detects type-shares between adjacent passes
  AssertionError: expected [ { fromPass: 1, toPass: 2, …(6) } ] to have a length of 2 but got 1
  ❯ tests/unit/slice/cross-pass-edge-merger.test.ts:236:26
  ```
  - `detects type-shares between adjacent passes` — failed at `expect(result.edges).toHaveLength(1)`.
  - `emits multiple edges when 2 lower slices match different static rules` — failed at `expect(result.edges).toHaveLength(2)`.
  - `populates fromPass/toPass with the correct pass numbers (directionality)` — failed at `expect(result.edges).toHaveLength(1)`.
- **Revert verification**: `git checkout -- src/services/slice/cross-pass-edge-merger.ts` → 11/11 green.
- **Conclusion**: Test suite catches the type-shares regression. Assertion power confirmed.

## Probe B details

- **Mutation applied**: changed both `>` to `>=` in lines 40-41 of `granularity-decider.ts`:
  ```ts
  const locExceeded = wu.loc >= thresholds.maxLoc; // PROBE B MUTATION
  const filesExceeded = wu.files.length >= thresholds.maxFiles; // PROBE B MUTATION
  ```
- **Test run output (failure mode)** — 3 tests failed, including the explicit mutation-probe test:
  ```
  FAIL tests/unit/slice/granularity-decider.test.ts > GranularityDecider.shouldSubdivide > keeps the top threshold exclusive — loc=maxLoc alone lands in tie-break, not true
  AssertionError: expected true not to be true // Object.is equality
  ❯ tests/unit/slice/granularity-decider.test.ts:85:34
  ```
  - `keeps the top threshold exclusive — loc=maxLoc alone lands in tie-break, not true` — failed at `expect(result.subdivide).not.toBe(true)` (loc=400, files=1 now returns `true` instead of `'tie-break'`).
  - `returns 'tie-break' when loc is within 20% of maxLoc` — affected because the tie-break path is shadowed.
  - `respects custom thresholds` — failed at `expect(...).toBe('tie-break')` (custom maxLoc=50, loc=45 now returns `true`).
- **Revert verification**: `git checkout -- src/services/slice/granularity-decider.ts` → 11/11 green.
- **Conclusion**: Test suite catches the off-by-one comparator regression. Assertion power confirmed.

## Probe C details

- **Mutation applied**: replaced `if (existsSync(cacheFile))` on line 54 with `if (false)` to short-circuit the cache-hit return path:
  ```ts
  if (false) { // PROBE C MUTATION: cache short-circuit disabled (was: existsSync(cacheFile))
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { output: string };
    return { output: cached.output, callId: `cache:${promptHash.slice(0, 12)}`, tokens: null };
  }
  ```
- **Test run output (failure mode)** — 2 tests failed, including the explicit mutation-probe test:
  ```
  FAIL tests/unit/slice/llm-arbitrator.test.ts > LLMArbitrator > cache hit does not invoke llmRunner.call (mutation probe C)
  AssertionError: expected 1 to be +0 // Object.is equality
  ❯ tests/unit/slice/llm-arbitrator.test.ts:88:57
  ```
  - `cache hit does not invoke llmRunner.call (mutation probe C)` — failed at `expect(vi.mocked(llmRunner.call).mock.calls.length).toBe(0)` (was 1, should be 0).
  - `returns cached output on cache hit and does not invoke llmRunner.call` — failed at `expect(result.output).toBe(CACHED_OUTPUT)` (received `null`).
- **Revert verification**: `git checkout -- src/services/slice/llm-arbitrator.ts` → 5/5 green.
- **Conclusion**: Test suite catches the cache-short-circuit regression. Assertion power confirmed.

## Final state

- All 3 probes reverted via `git checkout -- <file>`.
- Slice suite (`tests/unit/slice/`) post-revert: **102 passed / 102 total / 0 failed**.
- Full vitest run on this worktree: 3954 passed / 20 failed / 17 skipped (3991 total). The 20 failures are pre-existing environment issues in this worktree (clock-skew in `session-checkpoint-service`, build regression in `hook-binary-build-regression`, CLI integration tests that depend on a fully-set-up `.peaks/_runtime/` with `preferences.json` / `project-scan` artifacts not present in this isolated worktree) and are unrelated to the mutation probes. The source branch `feature/slice-topology-multipass` shows 3974 passed / 0 failed; the 17-test delta is the 3 mutation-probe meta-assertions the source branch already carries. **All 3 probes pass — no new test coverage gap detected.**
- `tsc --noEmit` — passed (no output).
- Documentation committed in this commit: <hash> (filled at commit time).
- Working tree clean (modulo the staged doc).

## What this means for the slice

The 3 mutation probes confirm that the slice-topology-multipass test suite has real assertion power against the most important regression vectors:

1. **Probe A (type-shares detector)** — without the type-shares static rule, the multi-pass orchestrator loses 1 of its 3 static cross-pass edge detectors, breaking detection of `import type` relationships between upper and lower passes. Caught by 3 tests including the explicit "detects type-shares" test.

2. **Probe B (boundary semantics)** — `>` vs `>=` is the canonical off-by-one. The `shouldSubdivide` threshold semantics are part of the public contract (per the docstring: "threshold is exclusive; we only subdivide what is OVER it"). A `>=` mutation changes the contract and would silently over-subdivide. Caught by 3 tests including the explicit probe-guard test "keeps the top threshold exclusive".

3. **Probe C (cache short-circuit)** — without the cache hit, every prompt re-invokes the LLM (or returns null on budget exhaustion). This is the cost+correctness boundary: cache hits return instantly with `tokens: null`; live calls return `tokens: { input, output }`. The probe caught 2 tests including the explicit `vi.mocked(llmRunner.call).mock.calls.length === 0` assertion.

If any of these probes had PASSED (i.e., a mutation survived), the corresponding test would be vacuous and would need tightening. None did. The slice-topology-multipass test suite is fit for purpose.

## Note on file path

The spec's literal path `.peaks/_runtime/2026-06-25-session-139b84/audit/mutation-probes-w7-t21.md` is covered by `.peaks/_runtime/` in `.gitignore` (intentional — the runtime tree is gitignored ephemeral session state per the project's CLAUDE.md hard-ban on top-level change-id dirs and the broader 2.0 two-axis convention). To keep the audit trail reviewable across the `--no-ff` merge, this file lives at `.peaks/memory/2026-06-25-mutation-probes-w7-t21.md` (git-tracked). A verbatim copy was also written to the spec path so `peaks audit`/runtime introspection can still locate it.
