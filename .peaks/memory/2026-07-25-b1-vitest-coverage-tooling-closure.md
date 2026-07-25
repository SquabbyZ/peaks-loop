# B1 — vitest-coverage-tooling — Closure

**Date:** 2026-07-25
**Session:** `2026-07-24-session-f13da7`
**Author:** MiniMax (Opus 4.8) — engineer-write ACTIVE
**Status:** **✅ B1 TOOLING RESOLVED; coverage gate produces real numbers; 100% threshold fails on real test coverage gap (G5-clean state)**

> Closure for the B1 (vitest coverage tooling) fix. After 7
> attempts (v1-v5 + B6-1 + B6-2 + c8-final + c8-fix), the
> tooling pipeline is finally working with real V8 coverage
> numbers. The 100% threshold fails on a **real test coverage
> gap** in `src/services/openspec/artifact-boundary.ts`
> (5 statements + 3 branches uncovered out of 68 statements
> + 11 branches). This is the G5 no-fake-green state: the
> gap is real, not synthetic.

---

## 1. Outcome

| Metric | Value |
|---|---|
| Tooling pipeline | ✅ WORKING (c8 reads V8 raw output correctly) |
| Real coverage numbers | ✅ 92.64% statements / 72.72% branches / 100% functions / 92.64% lines |
| 100% threshold | ❌ FAILS (real test coverage gap) |
| G5 no-fake-green | ✅ PRESERVED (no threshold weakening) |
| Apply-gate Pre-condition 2 | ⚠ PARTIALLY MET (tooling works; threshold fails on real gap) |

**Cost:** 8 dispatches (B6-1 + B6-2 + c8-final + c8-fix + 4 supporting plan dispatches) | **Time:** ~2 hours of sub-agent work | **Scope:** 95 files modified

## 2. The 7 attempts timeline

| Attempt | Strategy | Outcome |
|---|---|---|
| **v1** | Defer with root cause documented | Identified v8 fork-counter merge race |
| **v2** | Add 4th `coverage` project with `pool: 'threads'` | 0% with full config (forks-mode bug) |
| **v3** | Switch 4th project's provider to istanbul via `@vitest/coverage-istanbul` | 96.29% single-file; crashes on uncovered-file synthesis |
| **v4** | Add `sequence.groupOrder: 1-4` (fixes 4-project collision) | 0% still (separate bug) |
| **v5** | Scope `coverage.include` per project | DEAD-END: vitest 4.1.10's coverage resolver ignores project-level blocks (root config always wins) |
| **B6-1** | Upgrade vitest 4.1.10 → 5.0.0-beta.7 (with 5 fragile test fixes) | 5/5 fragile files passed (112/112 tests); config rename `experimental.fsModuleCache` → top-level `fsModuleCache` |
| **B6-2** | Per-project coverage scoping on vitest 5.x | DEAD-END: vitest 5.0.0-beta.7's `configResolved` + `resolveConfig.ts` retain the same `if (globalConfig) { resolved.coverage = globalConfig.coverage }` structural block |
| **c8-final** | Install c8; replace vitest's built-in coverage with c8 post-test merge | c8 reads V8 raw output correctly; 92.64% / 72.72% / 100% / 92.64% (REAL numbers, not 0%) |
| **c8-fix** | Replace `execSync` + `JSON.stringify` shell command with direct `mkdirSync` import (Windows backslash bug) | c8 wrapper now runs on Windows; 42/42 tests pass + real coverage numbers produced |

**The architectural lesson:** vitest's coverage pipeline (both 4.1.10 and 5.0.0-beta.7) has a structural block where per-project coverage config is silently overwritten by the root config at `configResolved` + `resolveConfig.ts`. c8 sidesteps this entirely by reading V8 raw output directly from process forks.

## 3. What was added (c8 post-test merge)

- **`scripts/coverage-c8.mjs`** (NEW) — spawns `c8 --check-coverage --100 --reporter=text-summary --reporter=json-summary` wrapping `vitest run [files|tests/unit]`. Hard-coded 100% thresholds via `--100` (no weakening). Includes an anti-fake-green guard that exits 1 if zero V8 counter files were collected.
- **`package.json`** — renamed `test:coverage` from `vitest run --coverage` to `node ./scripts/coverage-c8.mjs`; added `test:coverage:c8` (alias) + `test:coverage:vitest` (preserved diagnostic) + `test:coverage:workflow` (existing); deleted `test:coverage:threads` + `pretest:coverage` (both referenced the removed 4th project from B6-1); added `c8: ^10.1.3` to devDependencies.
- **`vitest.config.ts`** — removed the 4th `coverage` project (109 lines); removed the 3 `sequence.groupOrder` blocks (no longer needed; the uniqueness requirement was to disambiguate fast/slow/io-heavy/coverage which all had different maxWorkers — without `coverage`, all 3 can share the default). Kept top-level `fsModuleCache: true` (B6-1 promotion — clean improvement per dispatch). Net: 579 → 449 lines (-130).

## 4. The real coverage gap (G5-clean, requires user action)

The current 100% threshold fails because of **5 statements + 3 branches** in `src/services/openspec/artifact-boundary.ts` that aren't covered by the 42 tests in `artifact-boundary.test.ts`. The gap is real — it's a test-coverage gap, not a tooling gap. To pass the 100% threshold:

**Option A: Add more tests** (the G5-clean path)
- Identify the 5 uncovered statements + 3 uncovered branches (c8 can list them in the report)
- Add 1-3 more test cases that exercise the missing paths
- Run `pnpm test:coverage:c8 tests/unit/services/openspec/artifact-boundary.test.ts` to verify 100%

**Option B: Weaken the threshold** (the G5-fake-green path — **NEVER do this**)
- Would be fake-green per the project's `peaks-cli-version-shared-chicken-egg` sediment precedent
- The apply-gate is supposed to enforce 100% to catch real test coverage gaps

**Recommendation: Option A.** The gap is small (5 statements + 3 branches); the additional tests would also strengthen the contract preservation guarantees for the rid-009 helpers.

## 5. Apply-gate status (post-B1 fix)

Per the `openspec-enforce-artifact-policy.md` §4:
- Pre-condition 1 (tasks.md auto-flip): ⏸ ready on apply
- Pre-condition 2 (100% coverage): ❌ STILL FAILS (real test coverage gap on artifact-boundary.ts; tooling works correctly)
- Pre-condition 3 (test + typecheck + coverage): test ✅, typecheck ✅, coverage ⚠ (tooling works; threshold fails on real gap)
- Pre-condition 4 (downstream declaration): n/a (root)

`peaks openspec archive` for the 5 OpenSpec proposals is **still correctly deferred** until either:
- (a) The test coverage gap is closed (Option A above), OR
- (b) The user explicitly accepts the gap via AskUserQuestion + the threshold is documented as a known carve-out

## 6. Files written this turn

- `.peaks/_runtime/2026-07-24-session-f13da7/rd/2026-07-25-vitest-coverage-tooling/plan.md` (16K)
- `.peaks/_runtime/2026-07-24-session-f13da7/rd/2026-07-25-vitest-coverage-tooling/subslice-b6-1-evidence.md` (5.4K)
- `.peaks/_runtime/2026-07-24-session-f13da7/rd/2026-07-25-vitest-coverage-tooling/subslice-b6-2-evidence.md` (15.5K)
- `.peaks/_runtime/2026-07-24-session-f13da7/rd/2026-07-25-vitest-coverage-tooling/subslice-c8-evidence.md` (15.7K)
- `.peaks/_runtime/2026-07-24-session-f13da7/rd/2026-07-25-vitest-coverage-tooling/subslice-c8-fix-evidence.md`
- `.peaks/_runtime/2026-07-24-session-f13da7/rd/2026-07-25-vitest-coverage-tooling/vitest.config.ts.b6-2-baseline.bak` (31.6K backup)
- `scripts/coverage-c8.mjs` (NEW, 6.6K)
- `package.json` MODIFIED (3 line edits + lockfile regen)
- `vitest.config.ts` MODIFIED (579 → 449 lines, -130 net)

## 7. Hard rules held

- 0 source-code edits done by me directly
- 0 publish / tag / npm
- 0 red-rule file edits
- 0 IDE adapter edits
- 0 parked-test edits
- 0 OpenSpec apply (correctly deferred)
- 0 AI co-author trailer
- 0 100% threshold weakening (would be fake-green per G5)
- peaks-code orchestrator red line honored throughout

## 8. Status

**B1 tooling: ✅ RESOLVED.** c8 produces real V8 coverage numbers (not 0%, not a fake-green). **100% threshold: ❌ fails on a real 5-statement + 3-branch test coverage gap in `src/services/openspec/artifact-boundary.ts`** (this is a separate problem from the B1 tooling problem and is the G5-clean state per the project's sediment precedent).

**Apply-gate Pre-condition 2**: technically still fails (the threshold is unmet), but the failure is now a **legitimate test coverage gap** rather than a tooling bug. The user has two clean paths forward: (a) add 1-3 more tests to close the gap, then apply; (b) accept the gap via AskUserQuestion + carve-out, then apply.

End.