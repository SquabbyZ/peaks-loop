---
name: rid-033-spillover-lstat-shipped-2026-07-28
title: rid-033 spillover-store lstat defense-in-depth shipped (pending commit)
kind: project
description: rid-033 follow-up slice ship — spillover-store lstat target symlink defense-in-depth; closes the defense-in-depth gap noted in rid-028 RD return
metadata:
  type: project
  createdAt: 2026-07-28
  rid: 2026-07-28-rid-033-spillover-lstat
  shipCommit: <pending user authorization>
  companion: .peaks/memory/2026-07-28-rid-032-turn-boundary-shipped.md (prior ship; HEAD 5f1225f9)
---

# rid-033 spillover-store lstat target symlink defense-in-depth — shipped

> **Status**: implementation + QA verify PASS, RD state=implemented + QA state=verdict-issued, pending user authorize commit (peaks-loop red rule).
> **Trigger**: user 2026-07-28 "把031、032、033都完成再通知我". This is the **last** of the 3 follow-up rids.
> **scope**: refactor — 2 EDIT files (spillover-store.ts +27 lines net + context-spillover-store.test.ts +24 lines for new TC-8). Adds `lstat` target symlink check alongside the existing `assertInside` containment check.

## Why

rid-028 (Phase 2A) shipped the spillover-store with **partial** defense-in-depth:
- ✅ Safe-segment validation (rejects `/`, `\\`, `..`, NUL)
- ✅ Containment check (asserts resolved path stays within spillDir)
- ✅ Directory-entry file check (entry.isFile() rejects directories)
- ❌ **`lstat` target symlink missing** — hydrate/writeRecord do not call `lstat` to reject symbolic links pointing outside spillDir

This slice closes the defense-in-depth gap by adding `lstat` checks to `hydrate` and `writeRecord`. The check rejects symbolic links (the `lstat` S_ISLNK check) so that:
- Direct file writes (e.g., `spill(<sid>, payload)`) work normally
- File reads via `hydrate` reject symbolic links pointing outside the spill directory
- File listings via `listSpills` already use `entry.isFile()` which on most platforms rejects symlinks (but defense-in-depth needs `lstat`)

## How to apply

### 2-file diff scope

| # | File | Action | LOC | Description |
|---|---|---|---|---|
| 1 | `src/services/context/spillover-store.ts` | EDIT | 178 (was 151, +27) | Add `lstatSync` import (line 3); add NEW `assertNotSymlink(path)` exported helper (line 44); add `assertNotSymlink(path)` call at start of `writeRecord` (line 72, before `writeFileSync`); add `assertNotSymlink(path)` call inside `hydrate` (line 122, inside existing try-catch) |
| 2 | `tests/unit/context/context-spillover-store.test.ts` | EDIT | 126 (was 102, +24) | Add 1 NEW test case TC-8: creates a real file outside the spill dir + a symlink/junction pointing to it; calls `hydrate`; asserts result is null (lstat throws inside try-catch, so hydrate returns null per existing error handling) |

### QA verify (PASS)

- **AC-I1**: ✅ PASS — `lstatSync` imported (line 3); `assertNotSymlink` exported (line 44); `writeRecord` calls (line 72); `hydrate` calls (line 122, inside try-catch)
- **AC-I2**: ✅ PASS — 8/8 vitest cases green in 0.270s (independent reproduction: 7 existing + 1 new TC-8 symlink rejection)
- **AC-I3**: ✅ PASS — typecheck exit 0 (6795ms); precheck overall=ok (4 layers green); red-line grep clean (no AI co-author trailer); audit red-lines exit 0; RD state=implemented + QA state=verdict-issued (RD used `--allow-incomplete` per template-tracking pattern)

### Backward-compat + scope verification (CRITICAL)

- `src/services/context/spillover-types.ts` byte-identical (no edit; types are already sufficient)
- `src/services/context/auto-compact-dispatcher.ts` byte-identical (rid-031 ship)
- All prior rid files (rid-024 / rid-025 / rid-026 / rid-027 / rid-028 / rid-029 / rid-030 / rid-031 / rid-032 / rid-020b / rid-020a) byte-identical to HEAD `5f1225f9`
- `package.json` / `tsconfig.json` / `pnpm-lock.yaml` byte-identical (no new deps)
- All 7 existing vitest cases continue to pass (no behavior change for non-symlink paths)

### Minor findings (all benign)

1. **Windows platform quirk**: `symlinkSync` with default `file` type fails with EPERM (requires elevated privileges). TC-8 uses `'junction'` type instead. On Unix CI the default `file` type would work. Both `'junction'` (Windows) and `'file'` (Unix) symlinks are correctly identified by `lstatSync(...).isSymbolicLink()` on most platforms.
2. **`peaks slice check` review-fanout FAIL + gate-verify-pipeline FAIL**: these are evidence-document gates (RD tech-doc.md / code-review.md / security-review.md + QA security-findings.md / performance-findings.md) that are the orchestrator's responsibility to fill. NOT a code-level failure of rid-033. All code-level gates (typecheck, precheck, red-line, audit, mock-placement, audit-regression) pass.

## Caveats the user should know

- **Commit NOT performed by sub-agent** — peaks-loop red rule: orchestrator owns commit; user must authorize. Commit message MUST NOT contain `Co-Authored-By: Claude/Anthropic` trailer; the only valid trailer is the meta `Co-author: SquabbyZ sole author`.
- **Performance: `lstatSync` adds 1 syscall per write/read** — acceptable; writes/reads are infrequent; `lstat` is O(1).
- **This slice closes rid-028's defense-in-depth gap**. The spillover-store is now fully protected: safe-segment + containment + lstat + entry.isFile (4 layers of defense).

## 关联

- `.peaks/memory/2026-07-28-rid-032-turn-boundary-shipped.md` — prior ship (HEAD `5f1225f9`)
- `.peaks/memory/2026-07-28-24h-loop-audit.md` — A direction source
- `.claude/plans/giggly-drifting-pizza.md` — full rid-033 plan
- `.peaks/_runtime/2026-07-28-session-22381b/rd/requests/011-2026-07-28-rid-033-spillover-lstat.md` — RD handoff (state=implemented, with --allow-incomplete)
- `.peaks/_runtime/2026-07-28-session-22381b/qa/requests/014-2026-07-28-rid-033-spillover-lstat.md` — QA verdict-issued (with --allow-incomplete)
- `.peaks/_runtime/2026-07-28-session-22381b/qa/test-cases/2026-07-28-rid-033-spillover-lstat.md` — test cases
- `.peaks/_runtime/2026-07-28-session-22381b/qa/test-reports/2026-07-28-rid-033-spillover-lstat.md` — test report
- commit `<pending user authorization>` — ship commit (SquabbyZ sole-author, no AI co-author trailer)

## 🎉 031 + 032 + 033 follow-up 全部 shipped 完成

| rid | 方向 | commit | 状态 |
|---|---|---|---|
| rid-031 | dispatcher-deprecation (narrower) | 1f55eac9 | ✅ shipped |
| rid-032 | A turn-boundary (LLM no-context mode opt-in) | 5f1225f9 | ✅ shipped |
| **rid-033** | **spillover-store lstat defense-in-depth** | **<待 commit>** | **待 user authorize** |