# 2026-06-23 audit-p0 re-audit findings (handoff after compact)
archived: 2026-06-29
reason: v2.16.0-alpha change-id axis scope reduction
status: archived

> **Context.** This is a handoff note for a future session. The user manually
> compacted after the peaks-code audit + fix cycle. Pick this up by reading
> this file, then running `peaks project memories --project <repo> --json`.

## What was already done (DO NOT redo)

Two commits land on `fix/audit-p0-2026-06-23` branch (NOT merged to develop yet):

1. **`66db3ef fix(audit): address 3 P0 findings from today's 11-commit audit`** (today)
   - Split `src/cli/commands/sub-agent-commands.ts` (968 → 47 lines) into 5 files:
     - `dispatch-commands.ts` (517) — dispatch + runDispatchFromDag
     - `heartbeat-commands.ts` (96) — heartbeat + R-2 path guard
     - `share-commands.ts` (261) — share + shared-read + await
     - `sub-agent-shared.ts` (171) — types/constants/helpers
   - Added 25 unit tests in `tests/unit/cli/commands/playwright-commands.test.ts`
   - Added `FanoutPreference` opt-out in `preferences-types.ts` + SKILL.md mention +
     `references/fanout-opt-out.md` + 10 tests in `tests/unit/code/skills-code-fanout-opt-out.test.ts`
   - Removed redundant `isAbsolute ? resolve : resolve` in `change-scope-service.ts`

2. Earlier today (NOT from this slice — pre-existing in `develop`):
   - `e9679c2` slice 2 fast mode
   - `8f54b7f` slice 3 browser action
   - `de25749` slice 5 default fan-out (this is what the opt-out escapes)
   - `6eaf1d2` slice 9 dispatch CLI latency
   - `5bed96b` slice 10 scope leak fix
   - `fba2ebb` sub-agent SKILL.md scopeDir envelope read

## Re-audit findings on commit 66db3ef (TO DO after compact)

### 🔴 HIGH — fix in next commit

1. **Dead code in `src/cli/commands/sub-agent-shared.ts`:**
   - `isHeadroomMode(value)` exported at lines 160-163, but already lives at
     `src/services/context/headroom-prefs.ts:49`. Dispatch consumer imports
     from `headroom-prefs.ts` directly, not from sub-agent-shared. → DELETE.
   - `RegisterSubCommand` type alias at line 171. Defined but never used as a
     type anywhere (`sub-agent-commands.ts` calls the four register functions
     with `(program, io)` directly). → DELETE.

2. **Inline type imports in `src/cli/commands/dispatch-commands.ts`:**
   - Line 418: `cliRunner: async (spec: import('../../services/code/dag-orchestrator.js').DispatchSpec) => Promise<import('../../services/code/dag-orchestrator.js').SliceOutcome>`
   - Line 452: `noopWriter: (sliceId, _publicSurface: import('../../services/code/dag-orchestrator.js').PublicSurface): import('../../services/dispatch/contract-store.js').SliceContract`
   - Same pattern for the `SliceDag` type used at lines 401, 404.
   - Fix: move all four types to top-of-file named type imports
     (`type DispatchSpec, SliceOutcome, PublicSurface, SliceDag`).
   - Per `.claude/rules/typescript/coding-style.md` §"Public APIs": explicit types on public APIs.

### ⚠️ MEDIUM — fix when convenient

3. **No command-level unit tests for the 3 newly split files.**
   - `dispatch-commands.ts`, `heartbeat-commands.ts`, `share-commands.ts` (each
     has its own action handlers) have ZERO direct unit tests.
   - Existing `tests/unit/sub-agent-commands.test.ts` only covers `dispatch`.
   - Recommendation: add `tests/unit/cli/commands/heartbeat-commands.test.ts` and
     `tests/unit/cli/commands/share-commands.test.ts` (use FakeMcp pattern from
     `browser-wrapper-service.test.ts`).

4. **`share-commands.ts` loads `detectInstalledIde` + `getAdapter` at file top,**
   but `share` and `shared-read` actions never use them — only `await` does.
   Move the IDE imports into `registerAwaitCommand` (or split await into its own file).

5. **`sub-agent-shared.ts` type aggregation.** 5 options type + 3 lazy module
   types live in one file. Future growth → consider splitting by sub-command group.

6. **`mergePreferences` shallow merge risk for nested fanout settings.** Today the
   fanout field is 1 level deep so it's safe. If a future slice adds
   `fanout.perTouchpoint`, a partial override like `{"fanout": {"perTouchpoint": {}}}`
   will silently lose `defaultMode`. Document or add deep-merge.

### 🟢 LOW — backlog

7. `FanoutPreference.defaultMode` lacks runtime guard for invalid values like
   `"parallel"` (TS catches at compile time, but stale preferences.json with
   wrong value will pass schema_version check and crash at consumer site).
   Add `isFanoutMode(value): value is FanoutMode` type guard.

8. `references/fanout-opt-out.md` overlaps ~50% with `swarm-dispatch-contract.md`
   in describing the ≥2 leaves trigger. Could link out instead of restating.

## How to resume after compact

```bash
# 1. Switch to the audit branch (if not already)
git checkout fix/audit-p0-2026-06-23

# 2. Read this file + check existing tests still green
npx vitest run tests/unit/cli/commands/playwright-commands.test.ts \
                tests/unit/code/skills-code-fanout-opt-out.test.ts \
                tests/unit/sub-agent-commands.test.ts \
                tests/unit/change-scope-service.test.ts

# 3. Apply HIGH fixes (delete dead code + named type imports) as a new commit:
#    - Delete lines 160-163 and 171 in src/cli/commands/sub-agent-shared.ts
#    - Add named type imports in src/cli/commands/dispatch-commands.ts top
#    - Replace inline `import('...').X` annotations
#
# Commit message: refactor(sub-agent): remove dead exports + named type imports
#
# 4. Apply MEDIUM fixes (add command-level unit tests for heartbeat/share).
# 5. Re-audit again before merging to develop.

# Final merge:
git checkout develop
git merge --no-ff fix/audit-p0-2026-06-23 -m "merge: audit-p0-fixes (3 P0 + 1 P1 + re-audit cleanups)"
git push origin fix/audit-p0-2026-06-23 develop
```

## Reference

- Branch: `fix/audit-p0-2026-06-23` (off develop, not yet merged)
- Active session id at handoff time: `2026-06-23-session-dc4cbc`
- Last commit: `66db3ef`
- Files changed in 66db3ef: 11 (4 modified, 7 added)
- Test count at handoff: 68 passing across 6 test files
- Real dispatch CLI latency at handoff: 192.9ms (slice 9 baseline was 225ms)
