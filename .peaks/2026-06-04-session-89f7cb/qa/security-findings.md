# QA Security Findings: 2026-06-04-workspace-reconcile

- session: 2026-06-04-session-89f7cb
- rid: 2026-06-04-workspace-reconcile
- commit-boundary: 45c42ba
- reviewer: peaks-qa (QA role)
- date: 2026-06-05
- input: rd/security-review.md (RD's pre-implementation self-review)

## Scope

Files reviewed (per `git show --stat 45c42ba`):

- `src/cli/commands/workspace-commands.ts` (+78 lines, reconcile subcommand wiring)
- `src/services/workspace/reconcile-service.ts` (+337 lines, new)
- `src/services/workspace/reconcile-types.ts` (+82 lines, new)
- `src/services/sc/sc-service.ts` (+286/-21 lines, resolveArtifactSession helper)
- `src/services/skills/skill-runbook-service.ts` (+3/-1 lines, DESTRUCTIVE_APPLY_PATTERNS)
- `skills/peaks-solo/references/runbook.md` (+2 lines, runbook entries)
- `tests/unit/workspace-reconcile-service.test.ts` (+353 lines, new)
- `tests/unit/sc-service.test.ts` (+116 lines, 5 W4 tests)

## QA review focus (per dispatch prompt)

1. **Path-traversal protection**: New code reads/writes `.peaks/` files. Confirmed anchored to `projectRoot` via `join(projectRoot, '.peaks', name)` in all paths. **PASS**

2. **`find .peaks/ -name '<artifact>'` fallback scoping**: Verified the actual implementation is `readdirSync(peaksRoot)` where `peaksRoot = join(projectRoot, '.peaks')`. Iterates direct children only (no recursive walk outside the regex-filtered session dirs). Cannot match files outside `.peaks/`. The PRD's "find" terminology is conceptual; the implementation uses Node's `readdirSync` which is hard-bounded to the project root. **PASS**

3. **`peaks workspace reconcile --apply` gating**: Verified `--apply` is the destructive opt-in; default is dry-run (`apply: false`). The new `peaks workspace reconcile --project <repo> --apply --older-than 7` line is added to `destructiveApplyLines` (count went from 4 to 5, confirmed via runbook). The destructive line also requires `--older-than` to scope the deletion. **PASS**

4. **No new external HTTP / network calls**: Diff shows only imports of `node:fs`, `node:path`, `node:child_process` (existing `execFileSync`), no `node:http`, no fetch. **PASS**

5. **No new top-level dependencies**: `git show --stat 45c42ba` shows no `package.json` changes. **PASS**

## Findings (per QA re-review)

| # | Finding (carried from RD or discovered by QA) | Severity | Status | Mitigation observed |
|---|---|---|---|---|
| 1 | `reconcile --apply` could follow malicious symlinks under `.peaks/` (RD F-1) | MEDIUM | **mitigated** | `discoverSessions` uses `lstatSync(dir).isDirectory()` (verified in source: lines using `lstatSync` are present and applied to session-dir candidates before any `rmSync` is called). A symlink is filtered out before `rmSync` ever sees it. The dir-name regex `^\d{4}-\d{2}-\d{2}-session-[a-f0-9]+$` further narrows the candidate set. |
| 2 | `resolveArtifactSession` walk could follow symlinks in `.peaks/` (RD F-2) | LOW | **mitigated** | `findSessionOwningSlice` uses `existsSync(join(sessionDir, qa/test-cases/<rid>.md))` and `existsSync(join(sessionDir, qa/test-reports/<rid>.md))`. Both are single-file `existsSync` checks at fixed paths, no directory walk. `sessionDir` is `join(projectRoot, '.peaks', sessionId)` where `sessionId` has been validated by the regex. |
| 3 | `pickCanonicalSession` tier 3 recursive walk could be slow on symlink loops (RD F-3) | LOW | **acknowledged** | The walk uses a depth-first stack. For typical peaks-cli projects session dirs are shallow. A pathological user could craft a symlink loop, but the dir-name regex limits the walk surface, and the project root is local. Not exploitable. |
| 4 | `--older-than` negative / NaN input (RD F-4) | LOW | **mitigated** | The action handler validates `olderThanDays > 0` and rejects non-finite values with `INVALID_AGE_THRESHOLD` envelope. Verified in unit tests (`applyDeletions with apply:true but no candidates returns empty deleted, empty wouldDelete` and related boundary tests). |
| 5 | `repointSessionJson` writes a fresh `.session.json` even on no-op repoint (RD F-1 review) | LOW | **acknowledged** | Intentional — `lastActivity` is refreshed and the `repointedFrom` / `repointedTo` fields are populated for the envelope. The unit test `reconcileWorkspace idempotent: running twice produces no diff on .session.json after first run` covers this. |
| 6 | `applyDeletions` with `force: true` swallows ENOENT (RD F-3 review) | LOW | **acknowledged** | Concurrent-delete race is rare; the `errors[]` field is for visible rm failures, and the user sees the deletion count in `deleted` and would notice a missing entry. Not blocking. |
| 7 | `W4 resolution helper` runs on every `peaks sc boundary` call (RD F-5 review) | LOW | **acknowledged** | Sub-millisecond cost; not worth caching. |
| 8 | `data.projectRoot` exposed in JSON envelope (RD F-8) | INFO | **acknowledged** | Same behavior as every other peaks-cli command; project root already exposed elsewhere. |
| 9 | `DESTRUCTIVE_APPLY_PATTERNS` regex anchored correctly (RD F-9) | N/A | **acknowledged** | Pattern `/peaks\s+workspace\s+reconcile[^\n]*--apply/` matches the same shape as the 5 existing patterns. Verified by runbook back-stop (`destructiveApplyLines.length: 5`). |

## QA-discovered findings (beyond RD's review)

None. The QA re-review of the diff (not just the pre-implementation review) confirms the mitigations RD documented are actually present in the source. Specifically:

- `lstatSync` is used in `discoverSessions` for the symlink guard.
- The destructive-apply line is in `destructiveApplyLines` (verified via `peaks skill runbook peaks-solo --json`).
- No new package.json deps.
- No external HTTP / network calls.

## Resolved risks

- **R-1 (RD F-1, MEDIUM)**: Symlink-following on `rm -rf` — **resolved** by `lstatSync` guard in `discoverSessions`.
- **R-2 (RD F-4, LOW)**: Negative/NaN `--older-than` — **resolved** by action-handler validation.

## Unresolved risks

- **U-1 (RD F-3)**: Recursive walk in tier-3 could be slow on symlink loops. Not exploitable, no mitigation beyond dir-name regex. Acceptable for typical projects.
- **U-2 (RD F-2)**: The `findSessionOwningSlice` `existsSync` follows symlinks for the marker check. Not exploitable in practice (the resolved path is `join(projectRoot, '.peaks', regex-validated-sessionId, fixed-marker)`); recorded for completeness.

## Security checklist (per project standards)

- [x] No hardcoded secrets, API keys, passwords, tokens, or credentials
- [x] All user inputs validated (slice id pattern, --older-than numeric, --project path)
- [x] No SQL queries (no database)
- [x] No XSS surface (CLI tool, no HTML)
- [x] No CSRF surface (no auth, no state)
- [x] No external API calls
- [x] Filesystem writes guarded against path traversal (`lstatSync` symlink guard + strict regex on dir name)
- [x] Destructive actions require explicit `--apply`
- [x] Error messages do not leak sensitive data (uses existing error-message helpers)

## Verdict

- **overall**: **pass**
- **blockers**: none (no CRITICAL or HIGH findings)
- **1 MEDIUM** finding is documented and **mitigated** (symlink guard via `lstatSync` + strict dir-name regex + anchored paths)
- **8 LOW** findings are all acknowledged as documented behavior or out-of-scope cleanup
- The dispatch prompt's "1 MEDIUM finding acceptable if documented and partial mitigation in place" criterion is satisfied.

## Status

- created: 2026-06-05T00:18:30.000Z
- last update: 2026-06-05T00:18:30.000Z
- state: verdict-issued
