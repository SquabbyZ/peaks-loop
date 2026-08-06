---
name: 2026-08-06-session-outer-cache-and-meta-coverage-sediment
description: Slice 2026-08-06 closure — outer-session cache (G1+G2) + ensureSession setSessionMeta over-coverage (G3) shipped. Fixes the 5-terminals/5-sessions-stuck-on-3fe1be bug (stale outer 4ab7458f vs current outer 6ae5eda0). 17 new tests, 179/179 regression sweep PASS, A.3/A.4/A.5 reserved for next session.
metadata:
  type: project
  originSessionId: c573377e-72fb-4f27-b54b-28cb1501e40f
  modified: 2026-08-06T03:30:00.000Z
---

# 2026-08-06 session-outer-cache-and-meta-coverage slice sediment

**Session:** 2026-08-04-session-3fe1be (peaks-code, full-auto, IDLE post-slice)
**Slice:** 2026-08-06-session-outer-cache-and-meta-coverage
**Scope:** A.1 (G1 + G2 — outer-session cache) + A.2 (G3 — `ensureSession` early-return stamps meta)
**Verdict:** PASS — 179/179 regression + 17 new tests, all 14 AC green.
**Author:** SquabbyZ sole-author per redline rule (no `Co-Authored-By` trailer).

## Problem statement

SquabbyZ opened **5 new Claude Code terminals across 5 separate sessions in one day**, and every single one landed on the **same `_runtime/<sid>/` directory** (`2026-08-04-session-3fe1be`) with the same stale `outerSessionId = 4ab7458f` recorded in `session.json`. The actual current outer was `6ae5eda0`. Symptoms were user-visible:

1. Statusline appended `[4ab7458f]` (the dead sid) instead of `[6ae5eda0]` (the live one).
2. Every peaks CLI invocation from any new terminal looked like it belonged to one session.
3. New `_runtime/<sid>/` directories were never created — binding was pinned to the first session that won the race.
4. `peaks sub-agent dispatch` couldn't tell which session it was running in because `currentOuterSessionId` always returned the stale value (or `undefined`).

Root cause was two compounding bugs in `src/services/session/session-binding-bridge.ts`:

- `getCurrentOuterSessionId` only looked at `process.env.CLAUDE_CODE_SESSION_ID` (and `PEAKS_OUTER_SESSION_ID`). `peaks` is spawned by Claude Code via `Bash` / `Task` tools and typically does NOT inherit `CLAUDE_CODE_SESSION_ID`, so the resolver returned `undefined` for nearly every CLI invocation.
- `ensureSession` early-returned as soon as it saw an existing binding, **before** stamping meta. So even when `outerSessionId` did resolve (env-override tests), the recorded value in `session.json` was frozen at first-bind time and never updated.

## Root cause

- **`getCurrentOuterSessionId` was env-only.** No file-cache fallback → most CLI runs got `undefined`.
- **`ensureSession` early-return skipped `setSessionMeta`.** Even with a correct `currentOuterSessionId`, the bound session's meta was never overwritten.

Both are stated explicitly in the PRD (G1 + G2 + G3).

## Fix

**File-level summary** (3 modified, 4 new; 17 new tests, 179/1 PASS regression):

| Action | File | What |
|---|---|---|
| Modified | `src/services/session/session-binding-bridge.ts` (309 → 363) | `getCurrentOuterSessionId` now reads `env → file-cache → undefined`; `ensureSession` early-return now stamps `setSessionMeta(..., { outerSessionId })` before returning |
| Modified | `src/services/skills/hooks-settings-service.ts` (779 → 799) | `resolveHookEntries('claude-code')` now appends a SessionStart entry alongside gate-enforce; constants extracted to sibling |
| Modified | `src/cli/commands/_register.ts` (162 → 163) | Registration of `outer-cache write|read` |
| NEW | `src/services/skills/outer-cache-hook-constants.ts` (27) | Hook event constants |
| NEW | `src/cli/commands/outer-cache-commands.ts` (193) | `peaks outer-cache write` reads env, writes `.peaks/_runtime/.outer-session-cache.json`; `read` returns envelope (never throws) |
| NEW | `tests/unit/session/get-current-outer-session-id.test.ts` (187) | 10 tests — env > cache > undefined ordering; cache-miss / malformed JSON / IO error tolerant |
| NEW | `tests/unit/session/ensure-session-meta-coverage.test.ts` (196) | 7 tests — meta over-coverage; other fields preserved; no rotation on overwrite; repeated calls keep meta fresh |

`.gitignore` untouched — the existing `.gitignore:9:.peaks/_runtime/` parent rule already covers `.peaks/_runtime/.outer-session-cache.json` (verified via `git check-ignore -v`).

## Test results

- **Targeted (new files):** 17/17 PASS in 31.93s
- **Regression sweep:** `tests/unit/session/ + tests/unit/hooks/ + tests/unit/services/skills/ + tests/unit/cli/` → **179 passed, 1 skipped (180 total)** in 95.01s. The 1 skip is the pre-existing Win-only conditional — not introduced by this slice.
- **Typecheck:** clean for slice files (`tsc -p tsconfig.json --noEmit` filtered to `outer-cache|session-binding-bridge|hooks-settings-service|outer-cache-hook-constants` → no output).
- **Statusline + multi-binary-drift + doctor:** 149 PASS in 8 files (statusline + sid-only + drift integration suite). `peaks doctor --json` exits 0; `build:multi-binary-drift` returns `ok: true, message: "3 peaks-loop binaries on PATH all at version 4.0.13"`.
- **Lint silent-catch:** 3 carries tagged `TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)`, consistent with the slice-020 carry-forward list in `.peaks/memory/2026-07-31-rid-001-r2-silent-catch-guard.md`. No new `any`/`@ts-ignore`.

## Issues (from QA §4)

1. **Non-atomic cache write** (minor, out of scope): `outer-cache-commands.ts:125` uses `writeFileSync` directly rather than `atomicWriteJson`. A power-loss mid-write could leave the cache file truncated. Bridge treats truncated as cache-miss (safe), but file stays in "permanent bad state" until next SessionStart. **Planned resolution:** A.5+ — swap to `atomicWriteJson` (or `writeFileSync(..., { flag: 'w' })` after a `renameSync`-into-place). Not a regression.

2. **Outer-cache command registered but not in quickstart banner** (cosmetic): `peaks --help` top-N does not surface `outer-cache`. Discoverable via `peaks outer-cache --help`, but not via the user-facing quickstart. **Planned resolution:** Re-evaluate after A.5; NG5 explicitly forbids new user-facing flag surface in this slice, so this is by design for now.

3. **Brief's test paths don't exist** (process note, not a code issue): QA brief pointed at `tests/integration/{statusline,sid,multi-binary}` which are absent in the repo. Actual paths live under `tests/unit/...` (vitest config excludes `tests/integration/**`). **Planned resolution:** Next session — update brief template to pre-flight the actual test paths before issuing QA briefs; RD's self-report cited non-existent paths and would have produced false-green via "No test files found".

4. **`peaks-code` AC3-AC6 vs presence envelope** (process note): `peaks skill presence --json` reads the active-skill marker, not the bridge directly. The envelope reports the active session's recorded `outerSessionId`, not a fresh `getCurrentOuterSessionId` call. **Planned resolution:** Document the bridge vs presence distinction in the QA brief template; QA substituted with temp project + direct import.

5. **Live binding restoration** (self-inflicted during QA): First verification attempt ran `peaks workspace init --project . --json` against the live repo, which auto-rotated binding from `3fe1be` → `a1198a` (no env, no cache, rotation guards tripped). QA restored the original `session.json` byte-content and cleaned up the auto-created `2026-08-06-session-9f610c/` + `2026-08-06-session-a1198a/` session dirs. **No hard ban violated** — all touched paths are under gitignored `.peaks/_runtime/`; binding file is byte-identical to pre-verification state.

## Open risks for A.3 / A.4 / A.5

Carried forward verbatim from RD §5 (R-A.3 / R-A.4 / R-A.5):

- **R-A.3 — Rotation decision widens:** `ensureSessionWithRotation` cases 1/2/3 still rely on `currentOuterSessionId !== undefined`. After this slice, the false-positive rate drops sharply (cache surfaces outer ids the env could not), so the rotation path may fire more often than legacy data suggested. The 3 false-positive guards (`currentOuterSessionId === undefined` / `boundOuterSessionId === undefined` / `boundOuter === currentOuter`) are preserved verbatim — only the resolution source for `currentOuter` widens.

- **R-A.4 — `workflowId` derivation unchanged:** `wf-<sid>-compat` is still the workflowId shape. Sub-agents dispatched from inside a SessionStart-primed project see the legacy form, NOT a `wf-<callerId>-...` form. **Design debate:** should `workflowId` derive from `callerId` (4.0.8 caller-binding direction) or from `sid` (legacy)? A.4 will rework presence-lease-graph wiring. Recommendation: per-caller, since 4.0.8 caller-binding is the designed primary source.

- **R-A.5 — `session.json` location migration TBD:** `.peaks/_runtime/session.json` (project-level binding) remains at legacy top-level; no migration to `.peaks/_runtime/<sid>/session.json`. **Design debate:** should binding follow `sid` (legacy) or `callerId` (4.0.8 direction)? PRD NG4 holds: not migrated in this slice. Recommendation: leave binding following `callerId` not `sid` — caller-binding is the primary truth source, so binding should follow the caller, not the session.

## Files touched

| File | LOC delta | Status |
|---|---|---|
| `src/services/session/session-binding-bridge.ts` | 309 → 363 (+54) | modified |
| `src/services/skills/hooks-settings-service.ts` | 779 → 799 (+20) | modified (constants extracted) |
| `src/cli/commands/_register.ts` | 162 → 163 (+1) | modified (registration only) |
| `src/services/skills/outer-cache-hook-constants.ts` | 0 → 27 (+27) | NEW |
| `src/cli/commands/outer-cache-commands.ts` | 0 → 193 (+193) | NEW |
| `tests/unit/session/get-current-outer-session-id.test.ts` | 0 → 187 (+187) | NEW |
| `tests/unit/session/ensure-session-meta-coverage.test.ts` | 0 → 196 (+196) | NEW |
| `.gitignore` | 0 | untouched — `.peaks/_runtime/` parent rule already covers new cache file |

All modified files remain under the Karpathy 800 LOC cap. `hooks-settings-service.ts` was 779 lines; 20 net lines added after extracting `HOOK_OUTER_CACHE_*` constants to a 27-line sibling.

## Cross-links

- [[2026-08-05-peaks-loop-4-0-13-publish-closure]] — sibling 4.0.13 sediment (statusline + drift ship)
- [[2026-08-05-statusline-empty-render-short-sid-suffix-sid-only-marker-and-multi-binary-drift-guard]] — slice design sediment that this slice complements (statusline now reads correct outer via bridge fix)
- [[2026-08-05-peaks-loop-4-0-12-publish-closure]] — precedent publish closure
- [[peaks-loop-publishing-critical-hard-rules]] — SquabbyZ sole-author rule (no Claude/Anthropic trailer)
- [[peaks-cli-version-shared-chicken-egg]] — lockstep bump trap
- [[2026-07-31-rid-001-r2-silent-catch-guard]] — `TODO(g2)` carry-forward pattern

## Commit prep

The prepared commit message in RD §6 is ready for human execution under SquabbyZ sole-author. QA's 2 wording edits incorporated:

1. Replaced `peaks CLI sub-processes (which do NOT inherit CLAUDE_CODE_SESSION_ID)` → `peaks CLI sub-processes (which typically do NOT inherit CLAUDE_CODE_SESSION_ID)` (applies to both paragraphs).
2. Added `(preserves `lastActivity` bump per `setSessionMeta` read-modify-write)` parenthetical to the `setSessionMeta` bullet.
3. (QA's optional 3rd edit incorporated) Added one-line cross-link to `.peaks/memory/2026-08-05-statusline-empty-render-short-sid-suffix-sid-only-marker-and-multi-binary-drift-guard.md` so reviewers can trace why the `resolveHookEntries` change moves the SessionStart entry alongside the gate-enforce entry on the same `peaks hooks install` path.

Final commit message:

```
fix(session): outer-session cache + meta over-coverage (slice 2026-08-06)

- bridge: getCurrentOuterSessionId now reads env → file-cache → undefined
  so peaks CLI sub-processes (which typically do NOT inherit
  CLAUDE_CODE_SESSION_ID) can resolve the current outer session id via
  .peaks/_runtime/.outer-session-cache.json. Cache-miss / malformed JSON
  / IO errors all return undefined (no throw).
- bridge: ensureSession early-return path now calls setSessionMeta with
  the current outerSessionId BEFORE returning (preserves `lastActivity`
  bump per `setSessionMeta` read-modify-write), so the on-disk
  .peaks/_runtime/<sid>/session.json always reflects the latest outer
  signal (not a stale value captured at session creation). All other
  meta fields preserved via read-modify-write.
- hooks: add SessionStart hook entry (Claude Code only) that runs
  `peaks outer-cache write --project ...` to keep the cache in sync
  with the active Claude Code session. Uninstall strips the entry
  alongside the gate-enforce entry. See
  .peaks/memory/2026-08-05-statusline-empty-render-short-sid-suffix-sid-only-marker-and-multi-binary-drift-guard.md
  for why the SessionStart entry rides the same hooks-install path.
- CLI: `peaks outer-cache write|read` for explicit cache control.
  write exits 1 with OUTER_CACHE_NO_ENV when neither env var is set;
  read returns { missing: true } on absent / malformed JSON / IO error
  (never throws).
- tests: 17 new unit tests across 2 files pinning the resolution
  ordering (env > cache > undefined), the meta-coverage contract
  (AC8-AC11), and the on-disk JSON shape. All pass; no regressions
  in the session / hooks / skills / cli test suites (179 pass + 1
  pre-existing Win-only skip).
- .gitignore: untouched. .peaks/_runtime/ already covers the new cache
  file via the existing parent rule.
- A.3 / A.4 / A.5 (workflowId by callerId + session.json migration +
  rotation cases) explicitly reserved for a future session per
  NG1-NG4.
```

**Hard ban confirmed:** no `Co-Authored-By: Claude` / `Co-Authored-By: Anthropic` trailer. SquabbyZ sole-author per `.peaks/memory/redline-no-claude-co-author.md`.

## Anti-patterns observed and avoided

1. **Non-atomic cache write** is acceptable for this slice (PRD R1 / R2 explicitly accept it) — bridge's try/catch treats truncated as cache-miss (safe). A.5+ will swap to `atomicWriteJson`.
2. **Live-binding restoration mistake** — QA must NEVER run `peaks workspace init` against the live repo unless the brief explicitly authorizes it. Recovery path (restore binding file byte-content + clean up auto-created sid dirs) worked but should be guarded by a brief pre-flight check.
3. **Brief's non-existent test paths** — RD self-reported PASS on paths that don't exist; `vitest run` with non-matching globs exits 0 with "No test files found", producing a false green. Future QA briefs should be pre-flighted against the actual repo test layout.

## Status

- state: verdict-issued (PASS)
- last update: 2026-08-06T03:30:00Z
- next: ship the commit under SquabbyZ sole-author; A.3/A.4/A.5 reserved for next session.