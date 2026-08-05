---
name: 2026-08-05-statusline-empty-render-short-sid-suffix-sid-only-marker-and-multi-binary-drift-guard
description: 2026-08-05 two-slice statusline bundle — callerId fallback + active [short-sid] (commit 4be37d08) + idle/stale sid-only marker + multi-binary drift guard with severity-aware buildReport (commits 95654d48 + 34de6c22 repair). Shipped to 4.0.13.
metadata:
  type: project
  originSessionId: c573377e-72fb-4f27-b54b-28cb1501e40f
  modified: 2026-08-05T21:06:54.163Z
---

# 2026-08-05 statusline empty-render + short-sid suffix + sid-only marker + multi-binary drift guard

**Session:** 2026-08-04-session-3fe1be (peaks-code, full-auto)
**Slices shipped (SquabbyZ sole-author, 3 commits on main):**

| Commit | Slice | Fix |
|--------|-------|-----|
| `4be37d08` | callerId fallback + active `[short-sid]` | G1: statusline `empty` → active lease render; G2: `peaks-loop [3fe1be]` suffix when state=active |
| `95654d48` | sid-only marker (idle/stale) + multi-binary drift check | G3: idle/stale states also append sid; G4: `peaks doctor check` detects multi-version peaks-loop on PATH |
| `34de6c22` | QA repair cycle | AC7 fix (severity-aware `buildReport` → `summary.ok = errors === 0`); LOC cap recovery (extract `computeRootSuffix` to sibling module) |

## Root cause of "statusline shows empty despite active peaks-code lease"

Two surfaces, both fixed by `4be37d08`:

1. **Caller id mismatch**: `resolveCallerId` (in `src/services/skills/skill-statusline-service.ts`) resolves `stdin.caller_id > process.env.CLAUDE_CODE_SESSION_ID > null`. When the harness injects a caller_id that does NOT match the lease's caller_id, `resolveActiveSkillForCaller` returns `{ source: 'none', skill: null }` → renderer falls back to `empty`. Fix: callerId-filtered resolution returns none → retry with `callerId: null` (the existing "most recent in-flight lease" branch).

2. **Project name + short-sid suffix**: User wanted `[3fe1be]` after `peaks-loop` for visual session identification. Fix: `formatShortSid(sessionId: string): string` helper = `sessionId.split('-').pop() ?? sessionId`. Appended only when state='active' and shortSid !== ''.

## Root cause of "Hook JSON output validation failed — (root): Invalid input" on fresh IDE sessions

Multi-binary PATH pollution. On Windows hosts where peaks-loop is installed via both nvm4w (`/c/nvm4w/nodejs/peaks`) AND npm-global (`/c/Users/smallMark/AppData/Roaming/npm/peaks`), the second install may carry an older version that lacks `--json` flag and `gate.enforce` subcommand. When the IDE's PATH order picks the older binary, the PreToolUse hook fails to produce valid JSON.

Verified case on 2026-08-05: nvm4w had `peaks-loop@4.0.12` (today) but Roaming-npm had `peaks-loop@3.1.2` (Jul 4 install). 3.1.2 lacks `gate.enforce` and the `--json` flag (added in slice 2 commit `eb13e44c`).

Fix: `peaks doctor check` now runs a new check `build:multi-binary-drift` that scans PATH for all `peaks` binaries, resolves each to its `node_modules/peaks-loop/package.json`, and emits `PEAKS_MULTI_BINARY_DRIFT` warning when ≥ 2 versions coexist. Default warn-only — does not block doctor.

## Severity-aware buildReport pattern (key design lesson)

**The hard rule** (effective 2026-08-05, this slice): `peaks doctor check` exits 1 only on `severity: 'error'` findings, never on `'warning'`. Implementation:

- `DoctorCheck` carries `severity: 'error' | 'warning'`
- `buildReport` separates `errors` and `warnings`; `summary.ok = errors === 0`
- `summary.passed = passedChecks`, `summary.warnings = warningCount`, `summary.failed = errorCount`
- `multi-binary-drift` emits `severity: 'warning'`

Lesson for future checks: when a check is observational (not gating), emit `'warning'`. The QA cycle that discovered this is **the canonical reference** for "warning vs error" — see QA reject on `95654d48` and the fix on `34de6c22`.

## Karpathy #2 LOC cap recovery pattern

The renderer (`src/services/skills/skill-statusline-renderer.ts`) was 806 LOC after the sid-only marker changes — over the 800-line cap. Recovery:

- Extract pure helpers (`computeRootSuffix`, `formatShortSid`) to sibling module `src/services/skills/skill-statusline-sid-suffix.ts` (78 LOC).
- Renderer re-exports the helpers for byte-identical test import compatibility.
- Result: renderer 806 → 776 LOC.

This is **the canonical extraction pattern** when a renderer file grows past 800 LOC. The extracted module must be PURE (no I/O) so existing tests don't need updating.

## Repair cycle (slice `95654d48` → `34de6c22`)

Prior QA rejected `95654d48` with two findings. RD repair cycle:

1. AC7 (BLOCKER): unit test asserted JSON envelope shape but never ran the CLI dispatcher → `peaks doctor check` exited 1 when drift fired. Fix: severity-aware `buildReport`. New tests: `tests/unit/doctor/final-summary-severity.test.ts` (7 cases) + `tests/unit/doctor/doctor-exit-code-warn-only.test.ts` (5 cases) cover BOTH the buildReport unit AND the CLI exit-code path.
2. LOC cap (RECOMMENDED): `wc -l` exceeded 800. Fix: extract `computeRootSuffix` to sibling module.

**Lesson**: when adding a "warn-only" claim to a PRD, **MUST** add an integration test that runs the actual CLI dispatcher and asserts `process.exitCode === 0` — a unit test on the JSON envelope alone is insufficient because the dispatcher is a separate code path.

## Carry-forward

1. User should run `npm uninstall peaks-loop peaks-cli peaks peaks-app` to clean Roaming-npm 3.1.2 residue (one-time fix; not blocking 4.0.13 release because drift guard warns about it).
2. Short-sid extraction is `sessionId.split('-').pop() ?? sessionId` — never use regex; the kebab-tail approach is robust to all current and future sessionId formats.
3. Multi-binary drift check is cross-platform via `process.env.PATH` + `path.delimiter` split + Windows binary naming (`peaks.cmd`, `peaks.ps1`).
4. Skipped previous-task memories carried forward: [[peaks-loop-publishing-critical-hard-rules]] (4.0.13 cutover must observe 5 traps), [[peaks-cli-version-shared-chicken-egg]] (lockstep bumps), [[peaks-loop-4-0-12-publish-closure]] (precedent for 4.0.13).

Related: [[peaks-loop-publishing-critical-hard-rules]] / [[peaks-cli-version-shared-chicken-egg]] / [[peaks-loop-4-0-12-publish-closure]] / [[2026-07-27-windows-shell-pref]]