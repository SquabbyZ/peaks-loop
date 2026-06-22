---
name: 2026-06-22-plan4-closure-verdict
description: Plan 4 (RD 战略/战术 split) closure verdict from 3 independent audit rounds; Plan 5 scope derived from new defects found
metadata:
  type: project
  change_id: 2026-06-22-rd-tactical-split
  plan: 4
  status: closed-with-known-issues
  closes_commit: 208fd34
---

# Plan 4 Closure Verdict — 3-Round Independent Audit

**Commit closed:** `208fd34` (fix(rd): Plan 4 audit R2-W1/W2/W3/W4/W5 — 0-tolerance defense + negative tests)
**Audit window:** 2026-06-22 16:45–17:14 UTC+8
**Session id:** `2026-06-22-session-1f8ba1`
**Audit artifact paths:**
- R1 spec: `.peaks/_runtime/2026-06-22-session-1f8ba1/audit/round-1-spec-compliance.json`
- R2 test: `.peaks/_runtime/2026-06-22-session-1f8ba1/audit/round-2-test-quality.json`
- R3 karpathy+defense: `.peaks/_runtime/2026-06-22-session-1f8ba1/audit/round-3-karpathy-defense.json`

## Verdict

| Round | Dimension | Gate | HIGH | MED | LOW |
|-------|-----------|------|------|-----|-----|
| R1 | spec_compliance | **fail-to-plan5** | 1 | 2 | 2 |
| R2 | test_quality | pass | 0 | 0 | 2 |
| R3 | karpathy_defense | pass | 0 | 0 | 1 |

**Overall:** Plan 4 closes with **8 new defects** (1 HIGH, 2 MED, 5 LOW) handed off to Plan 5.
The 5 R2 weaknesses that motivated commit 208fd34 are **all verified fixed**.

## 3 Mutation Probes (R3) — All Defenses Live

| Probe | Mutation | Expected | Actual | Test that caught it |
|-------|----------|----------|--------|---------------------|
| (a) | Comment out impl.ts:39-46 defense-in-depth | ≥1 fail | 1 fail | `throws when passed=true but violations non-empty (lying-input defense, R2-W2)` — assertion `AssertionError: promise resolved "{ version: '1.0', …(6) }" instead of rejecting` |
| (b) | sha256 regex `[a-f0-9]{64}` → `[a-f0-9]{1,64}` | ≥1 fail | 3 fails | `rejects sha256 — 63-char sha256 (StrategyOutputSchema)`; `rejects impl — 63-char inputSig (ImplOutputSchema)`; `rejects impl — 63-char self sha256 (ImplOutputSchema)` |
| (c) | Empty `externalApiCalls` array in multi-entry test | ≥1 fail | 1 fail | `produces distinct sig for multi-entry externalApiCalls (R2-W4)` — caught at line 101 `expected [] to have a length of 3 but got +0` |

All defenses verified — no silent holes.

## Test Count Delta (R2 verified)

- Before commit 208fd34: **12 tests** (5 in untouched RD files + 7 baseline in 3 touched files)
- After commit 208fd34: **26 tests** (+14 new)
- Commit message claim "14 → 28" is OFF BY 2 in both directions — **documentation defect only** (R2 noted for any downstream consumer of commit message text)

## All 8 Defects Found — Sorted by Severity

### HIGH (1)

#### R1-W2 — H8 STRAT.sig chain equality NOT pinned
- **Location:** `tests/unit/services/rd/types.test.ts` (StrategyOutputSchema + ImplOutputSchema sections)
- **Issue:** Spec H8 + §3.2 row "peaks-rd/战术 | STRAT.sig + context.json | impl.json + TACT.sig" mandates `impl.inputSig === strat.sha256`. Current suite only pins the *format* of inputSig (64-hex), never the *equality* with upstream STRAT.sig. A buggy orchestrator can pass any 64-hex string and the unit suite won't catch the broken chain.
- **Fix (Plan 5):** Add `tests/unit/services/rd/tactical-stage.test.ts` with positive (`runTacticalStage(strat.sha256)` → `tact.inputSig === strat.sha256`) and negative (standalone `runTacticalStage('a'.repeat(64))` → reject "STRAT.sig chain broken").

### MED (2)

#### R1-W1 — Side-effect-only import test has no R?-W? scope tag
- **Location:** `tests/unit/services/rd/ast-gate.test.ts:154-172`
- **Issue:** Test `side-effect-only import produces no false violations` does not map to any R2-W1..W5. Future rounds can't tell whether it's Plan 5 scope creep or a real R2 weakness follow-up.
- **Fix (Plan 5):** Add comment `// R2-EXTRA: side-effect-only import boundary (round-2 boundary_coverage table)`.

#### R1-W3 — impl.ts defense-in-depth comment cites non-existent "spec §4.2 战术审计"
- **Location:** `src/services/rd/impl.ts:29-31`
- **Issue:** Design spec (`docs/superpowers/specs/2026-06-21-context-audit-redesign-design.md`) §4.2 is **"peaks-mut 设计"**, NOT "战术审计". The phrase "spec §4.2 战术审计" appears only in plan files. Grep over design spec for "violations must be consistent" / "AST gate integrity" returns zero matches.
- **Fix (Plan 5):** Either (a) add new §4.X "战术审计" consolidating §3.2/§3.3/H6/H8/AC-2, or (b) rewrite impl.ts:29-31 to cite H6 verbatim: "Defense-in-depth: enforces H6 (CLI 计算裁决) — caller cannot bypass the gate by mutating passed=true while leaving violations[] non-empty."

### LOW (5)

#### R1-W4 — R2-W3 test names read as regression when v2 fixes the v1 limitation
- **Location:** `tests/unit/services/rd/ast-gate.test.ts:111-151`
- **Issue:** Names `namespace import is NOT linked to dep` / `default import is NOT linked to dep` assert `passed=true` and `violations=[]`. Natural reading of the name conflicts with the verdict.
- **Fix (Plan 5):** Rename to `v1 passes namespace import (limitation, R2-W3)` / `v1 passes default import (limitation, R2-W3)`. Future v2 flip is recognizable as design change, not test bug.

#### R1-W5 — Atomic-write crash-mid-rename not tested
- **Location:** `src/services/rd/impl.ts:61-68` (tmp+rename block)
- **Issue:** Spec §4.3 "sig 写入 = 原子(temp + rename)" applies to impl.json by §3.2 inheritance. Catch+unlink fallback is structurally untested.
- **Fix (Plan 5):** `vitest spyOn(node:fs/promises, 'rename').mockRejectedValue(...)` → assert `.tmp` file does NOT remain after writeImpl throws.

#### R2A-L1 — Empty vs 1-element array boundary not probed (R2 dimension)
- **Issue:** R2-W4 test compares `[]` vs 3-element; bug class "empty/1 collapse" not directly tested.
- **Fix (Plan 5):** Add 1-element comparison case.

#### R2A-L2 — Uppercase hex regex not pinned (R2 dimension)
- **Issue:** Regex `/^[a-f0-9]{64}$/` rejects uppercase A-F but no test pins this. Mutation to `/^[A-Fa-f0-9]{64}$/` silently accepts uppercase hex.
- **Fix (Plan 5):** Add 1 case `'uppercase hex', 'A'.repeat(64)` to it.each.

#### R3-W1 — R2-W4 "distinct sig" assertion weakened by non-deterministic `generatedAt`
- **Location:** `tests/unit/services/rd/impl.test.ts:87`
- **Issue:** `expect(multi.sha256).not.toBe(single.sha256)` works only because `generatedAt` differs per call. Mutation probe (c) caught the bug via line-101 length assertion, not the named "distinct sig" assertion. The swap check on line 98 still works (same-second `generatedAt`).
- **Fix (Plan 5):** Either freeze `generatedAt` via test-only `clock: () => string` injection on `WriteImplInput`, or rename test to focus on length/order rather than "distinct sig".

## Plan 5 Scope (Derived)

### Slice 1 (RD) — R1-W2 HIGH (H8 chain equality)
- New file `tests/unit/services/rd/tactical-stage.test.ts` (or extend existing tactical-stage test)
- 2 tests: positive (chain equality) + negative (standalone rejection)
- Coverage ≥ 90% on the new assertion path

### Slice 2 (RD) — R1-W3 MED (spec §4.X consolidation + comment fix)
- New design-spec section OR comment rewrite
- 1 design spec edit + 1 impl.ts comment edit
- Re-grep verify "spec §4.2 战术审计" still appears in plan files only (not impl source)

### Slice 3 (RD) — Consolidated LOW tightening (R1-W1/W4/W5, R2A-L1/L2, R3-W1)
- 6 small fixes, batched into one slice for review efficiency
- All surgical, no behavior change

### Slice 4 (QA) — Verification
- Functional + security + perf gates (R1-W2 is security-relevant: H8 chain break = audit trail forgery vector)
- 2-round independent audit (spec + test quality) on new commit

## Why This Plan 4 Closes Now

- The 5 R2 weaknesses (R2-W1..W5) that motivated commit 208fd34 are **all verified fixed** by R1 (spec), R2 (test), R3 (mutation probes)
- 3 mutation probes verify defenses are not holes
- No HIGH defect from R1 targets the 5 R2 weaknesses themselves — all 5 W? targets are higher-order gaps (H8 chain, spec §4.2 traceability, atomic-write crash, etc.)
- Carrying HIGH R1-W2 forward without fixing it would violate the "不要留问题" hard rule

## Why This Plan 4 Did NOT Pass at First Audit

R1 spec_compliance gate returned `fail-to-plan5`. The Plan 4 fix work itself is sound — R1's verdict is **"scope complete, but bigger picture has gaps"**, not **"R2 weaknesses unfixed"**. Plan 5 inherits the bigger picture.

---

**Signed-off:** Plan 4 closed at 2026-06-22 17:14 UTC+8. Plan 5 scope locked.