# Plan 3a: peaks-cli Baseline Repair (v3.0 pre-Plan-3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the peaks-cli vitest baseline to green before dispatching Plan 3 (peaks-rd strategic/tactical split). 26 test files / 88 tests failing on `main` after Plan 2 ship. Plan 2's "80/80 PASS" report was a scoped subset, not full suite. This plan fixes all four failure categories with surgical, isolated commits per category.

**Architecture:** Four independent sub-tasks (one per failure category), each fully reviewable. No production code changes except where a Plan 1 followup introduced a regression — those get minimal targeted fixes. Companion/* Windows-env failures get platform-skip guards (production code stays Windows-clean). Each sub-task ends with `pnpm vitest run` showing the category's expected delta.

**Tech Stack:** vitest, TypeScript 5.7, Node `process.platform`. No new deps.

## Global Constraints

Inherited from v3.0:
- TypeScript ≥ 5.7 strict ESM
- File ≤ 800 lines (Karpathy #2)
- Coverage ≥ 80% per module — **relaxed for this plan**: we're fixing tests, not adding coverage. Production code delta must stay minimal.
- peaks-context cross-version isolation promise (Plan 1) MUST still pass after fixes
- peaks-mut MUT.sig chain (Plan 2) MUST still pass after fixes
- 1 commit per category (4 commits total + final green-baseline commit)
- No "out of scope" cleanup — fix only what's broken

## Pre-Flight Conflict Scan (already done)

| Category | Files | Tests | Root cause |
|----------|-------|-------|------------|
| (a) Windows-env companion/* | 6 | 24 | `spawn /bin/sh`/`/bin/echo` ENOENT on Windows |
| (b) Plan 1 followup fallout | ~6 | ~30+ | `--session-id` now required; legacy tests still omit it |
| (c) Plan 2 territory | ~4 | ~10 | RD/QA pipeline + MUT.sig collisions |
| (d) Integration / unrelated | ~6 | ~20 | TBD — investigate in Task 4 |

**Reference memory:** `.peaks/memory/plan-3-blocker-baseline-rot.md` documents the discovery.

---

## Task 1: Fix category (a) — Windows-env companion/* skip guards

**Files:**
- Modify: 6 files under `tests/unit/companion/`
  - `tests/unit/companion/bind-service.test.ts`
  - `tests/unit/companion/cc-connect-resolver.test.ts`
  - `tests/unit/companion/install-service.test.ts`
  - `tests/unit/companion/lifecycle-service.test.ts`
  - `tests/unit/companion/process-manager.test.ts`
  - `tests/unit/companion/setup-service.test.ts`

**Interfaces:**
- Consumes: vitest `describe` API
- Produces: 6 test files where the entire `describe` block is skipped on Windows via `describe.skipIf(process.platform === 'win32')`

**Rationale:** companion/* tests spawn `/bin/sh` and `/bin/echo` — Unix-only test fixtures. Production companion code is OS-agnostic (it's a Claude Code companion that lives in user-space); the tests use Unix shell semantics as their test harness. Skipping on Windows is correct behavior, not a workaround. CI runs on Linux (per peaks-cli default test target), so this doesn't lose coverage.

- [ ] **Step 1: Verify all 6 files are still in their pre-fix state**

Run: `git status tests/unit/companion/`
Expected: clean (no uncommitted edits).

- [ ] **Step 2: Inspect one file to confirm pattern**

Read: `tests/unit/companion/process-manager.test.ts` (head 5 lines)
Expected: `import { describe, it, expect, ... } from 'vitest'`

- [ ] **Step 3: Apply skipIf guard to each file**

For each of the 6 files, replace the top-level `describe('...', () => {` with `describe.skipIf(process.platform === 'win32')('...', () => {`. If a file has multiple top-level describes, guard all of them. Use `Edit` with `replace_all: false` per unique opening line.

- [ ] **Step 4: Run scoped test to confirm**

Run: `pnpm vitest run tests/unit/companion/`
Expected: all 6 files skip on Windows; previously-passing tests (208 of 232 in earlier scan) still pass.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/companion/
git commit -m "test(companion): skip Unix-spawn tests on Windows (platform-conditional)"
```

---

## Task 2: Fix category (b) — Plan 1 followup fallout (legacy `request init` calls)

**Files:**
- Modify: ~6 files in `tests/unit/`
  - `tests/unit/request-commands.test.ts`
  - `tests/unit/request-artifact-service.test.ts`
  - `tests/unit/request-query-service.test.ts`
  - `tests/unit/request-transition-service.test.ts`
  - `tests/unit/bypass-tracker.test.ts`
  - `tests/unit/pipeline-verify-service.test.ts`
  - `tests/unit/artifact-prerequisites.test.ts`

**Strategy:** Two-pronged fix:
1. For tests that test happy-path behavior: add a stable `--session-id` arg to each `request init/transition` call.
2. For tests that test pre-followup dual-root behavior: rewrite the assertion to match the new one-axis behavior, OR mark as `.skip` with a TODO referencing the Plan 1 followup commit.

**Interfaces:**
- Consumes: existing test helpers (`runInit`, `runCommand`, etc.)
- Produces: tests that pass against the current one-axis CLI

- [ ] **Step 1: Read each test file's `beforeEach` and helpers**

For each of the 7 files, find the test helper that invokes `request init`. The pattern is `await runCommand(['request', 'init', '--role', 'rd', '--id', '<rid>', '--project', innerProject, '--json'])` (missing `--session-id`).

- [ ] **Step 2: Choose a stable `--session-id` per file**

Pick a per-file stable sid matching `.peaks/_runtime/<sid>` shape (e.g., `2026-06-22-baseline-test`). Pre-create the session dir in `beforeEach` (the slice-008 F21 fix expects it for sid-shaped values).

- [ ] **Step 3: Add `--session-id <sid>` to each helper invocation**

For happy-path tests: insert `'--session-id', stableSid,` into the `runCommand` arg array. For tests that asserted on the OLD dual-root behavior (envelope at `.peaks/_runtime/<rid>/`), rewrite the path assertion to `.peaks/_runtime/<sid>/rd/requests/`.

- [ ] **Step 4: Run scoped test to confirm**

Run: `pnpm vitest run tests/unit/request-commands.test.ts tests/unit/bypass-tracker.test.ts tests/unit/pipeline-verify-service.test.ts`
Expected: previously-failing 30+ tests now pass; no regressions in already-passing tests.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/request-*.test.ts tests/unit/bypass-tracker.test.ts tests/unit/pipeline-verify-service.test.ts tests/unit/artifact-prerequisites.test.ts
git commit -m "test(plan1-followup): align legacy request-init tests with one-axis --session-id required"
```

---

## Task 3: Fix category (c) — Plan 2 territory (RD/QA + MUT.sig collisions)

**Files:**
- Modify: ~4 files
  - `tests/unit/dispatch/run-dag-dogfood-mvp.test.ts`
  - `tests/unit/rd/repair-cycle-2-cli-wiring.test.ts`
  - `tests/unit/rd/standards-overlay.test.ts`
  - `tests/unit/skills/orphan-scan.test.ts`

**Strategy:** Investigate each test's failure mode before patching. Most likely Plan 2's MUT.sig gate addition to `qa-commands.ts` (commit `cad634a`) changed the qa-handoff behavior that these tests assert against.

- [ ] **Step 1: Run each test file individually, capture failure messages**

```bash
for f in tests/unit/dispatch/run-dag-dogfood-mvp.test.ts tests/unit/rd/repair-cycle-2-cli-wiring.test.ts tests/unit/rd/standards-overlay.test.ts tests/unit/skills/orphan-scan.test.ts; do
  echo "=== $f ==="
  pnpm vitest run "$f" 2>&1 | grep -E "FAIL|AssertionError|expected" | head -10
done
```

- [ ] **Step 2: Categorize each failure**

For each failure, classify:
- **(c1)** Test asserts pre-Plan-2 behavior (no `mutation` gate in qa-handoff) → rewrite assertion to match new gate presence, OR pass `--no-mutation` flag.
- **(c2)** Test asserts MUT.sig chain that Plan 2 didn't deliver (e.g., expects `mut.sig` in qa-test-reports) → add MUT.sig generation to test fixture.
- **(c3)** Test asserts RD pipeline path that moved (e.g., `rd.requests/` vs `rd/srd/requests/`) → update path.

- [ ] **Step 3: Apply per-failure fixes**

For each (c1)/(c2)/(c3), make the minimal assertion change. Do NOT change production code unless the test exposes a real regression in Plan 2 — if it does, escalate to user before fixing.

- [ ] **Step 4: Run scoped test to confirm**

Run: `pnpm vitest run tests/unit/dispatch/ tests/unit/rd/ tests/unit/skills/orphan-scan.test.ts`
Expected: all 4 files green.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/dispatch/run-dag-dogfood-mvp.test.ts tests/unit/rd/repair-cycle-2-cli-wiring.test.ts tests/unit/rd/standards-overlay.test.ts tests/unit/skills/orphan-scan.test.ts
git commit -m "test(plan2-territory): align RD/QA + MUT.sig collateral tests"
```

---

## Task 4: Fix category (d) — Integration / unrelated failures

**Files:**
- Modify: ~6 files
  - `tests/integration/workspace-clean-cli.test.ts`
  - `tests/unit/project-standards-write-path.test.ts`
  - `tests/unit/sub-agent-commands.test.ts`
  - `tests/unit/workspace-consolidate-service.test.ts`
  - `tests/unit/standards/missing-standards-detector.test.ts`
  - `tests/unit/cli/options-no-flag-bug-class.test.ts`

**Strategy:** Same investigation pattern as Task 3. Likely pre-existing rot that pre-dates Plan 2, but Plan 2's `.gitignore` changes (deleting `.peaks/2026-*-*/` rule in `81f00ce`) may have shifted filesystem expectations for workspace-clean.

- [ ] **Step 1: Run each test file individually, capture failure messages**

```bash
for f in tests/integration/workspace-clean-cli.test.ts tests/unit/project-standards-write-path.test.ts tests/unit/sub-agent-commands.test.ts tests/unit/workspace-consolidate-service.test.ts tests/unit/standards/missing-standards-detector.test.ts tests/unit/cli/options-no-flag-bug-class.test.ts; do
  echo "=== $f ==="
  pnpm vitest run "$f" 2>&1 | grep -E "FAIL|AssertionError|expected" | head -10
done
```

- [ ] **Step 2: Categorize each failure**

Same (c1/c2/c3) classification, plus potential **(d4)** workspace path expectations from the gitignore change.

- [ ] **Step 3: Apply per-failure fixes**

Minimal assertion changes only. If a test exposes a real production bug, escalate.

- [ ] **Step 4: Run scoped test to confirm**

Run: `pnpm vitest run tests/integration/workspace-clean-cli.test.ts tests/unit/project-standards-write-path.test.ts tests/unit/sub-agent-commands.test.ts tests/unit/workspace-consolidate-service.test.ts tests/unit/standards/ tests/unit/cli/options-no-flag-bug-class.test.ts`
Expected: all 6 files green.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/workspace-clean-cli.test.ts tests/unit/project-standards-write-path.test.ts tests/unit/sub-agent-commands.test.ts tests/unit/workspace-consolidate-service.test.ts tests/unit/standards/ tests/unit/cli/options-no-flag-bug-class.test.ts
git commit -m "test(integration): align workspace/standards/cli-bug tests with current state"
```

---

## Task 5: Final baseline confirmation + push

- [ ] **Step 1: Run full suite**

Run: `pnpm vitest run --reporter=default 2>&1 | tail -10`
Expected: `Test Files  0 failed` (or only pre-existing env-specific failures documented as platform-conditional), `Tests  0 failed` (or matching baseline expectation).

- [ ] **Step 2: Run tsc**

Run: `pnpm tsc --noEmit`
Expected: 0 errors (or matching the documented pre-existing 2-error state in `tests/unit/rd/qa-reverify-strict-standards.test.ts`).

- [ ] **Step 3: Update memory file**

Modify: `.peaks/memory/plan-3-blocker-baseline-rot.md` — change metadata to mark as resolved, add a `## Resolution (2026-06-22)` section.

- [ ] **Step 4: Commit baseline-green marker**

```bash
git add .peaks/memory/plan-3-blocker-baseline-rot.md
git commit -m "docs(memory): mark baseline-rotation blocker as resolved (Plan 3a ship)"
```

- [ ] **Step 5: Push all 5 commits**

```bash
git push origin main
```

---

## Self-Review

### Spec coverage

| AC | Task |
|---|---|
| AC-1 Windows-env companion/* tests no longer fail | Task 1 |
| AC-2 Plan 1 followup legacy tests aligned | Task 2 |
| AC-3 Plan 2 RD/QA/MUT.sig collateral tests aligned | Task 3 |
| AC-4 Integration / workspace / standards / cli-bug tests aligned | Task 4 |
| AC-5 Full suite green | Task 5 |

### Risk register

- **R1**: Category (b) test count is a guess (~30+); actual may be larger if `tests/unit/artifact-prerequisites.test.ts` requires deep assertion rewrites.
- **R2**: Category (c) and (d) failures may expose real production bugs in Plan 1 or Plan 2. Each such finding escalates to user before fixing production code.
- **R3**: Coverage target relaxed intentionally; this plan is repair, not feature work.

### File size

- All edits are test-only; no production files modified unless escalation triggers.
- Each commit is one category = reviewable in isolation.

## Execution Handoff

Plan complete. Two options:
1. Subagent-Driven (recommended) — fresh subagent per category
2. Inline Execution

Which approach?