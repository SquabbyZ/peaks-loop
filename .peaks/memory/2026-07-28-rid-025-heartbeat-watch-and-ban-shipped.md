---
name: rid-025-heartbeat-watch-and-ban-shipped-2026-07-28
title: rid-025 heartbeat watch + main-session-monitor ban shipped (pending commit)
kind: project
description: rid-025 Phase 2A ship — B (24h offline heartbeat daemon `peaks heartbeat watch`) + G (main-session-monitor hard ban via ide-detect extraction + per-symbol PreToolUse hook); closes audit's first-knife recommendations
metadata:
  type: project
  createdAt: 2026-07-28
  rid: 2026-07-28-rid-025-heartbeat-watch-and-ban
  shipCommit: <pending user authorization>
  companion: .peaks/memory/2026-07-28-24h-loop-audit.md (audit's first-knife)
---

# rid-025 heartbeat watch + main-session-monitor ban — shipped

> **Status**: implementation + QA verify PASS (after fix), pending user authorize commit (peaks-loop red rule).
> **Trigger**: user 2026-07-28 显式要求 "进行 24h mode P2 决策面 7 优化方向 (A-G per 2026-07-28-24h-loop-audit.md)"; audit's first-knife recommendation = B + G combined.
> **scope**: B (24h offline heartbeat daemon) + G (main-session-monitor hard ban). 8 EDIT + 4 NEW source + 3 NEW test files.

## Why

Two audit-recommended directions from `2026-07-28-24h-loop-audit.md`:

- **B (heartbeat externalization)**: `src/services/code/batch-heartbeat-poller.ts` (162 lines) is in-process `setInterval`. When peaks process exits, the heartbeat dies → 24h offline user scenario has no daemon. Audit: "高 24h 关键度 / 中 ROI / 中 风险". Fix: add `peaks heartbeat watch --batch-id <id>` top-level CLI that can run independently (`nohup peaks heartbeat watch ... &`).
- **G (main-session-monitor hard ban)**: `src/services/context/main-session-monitor.ts` (206 lines) has `@deprecated` annotation but still has 4 import sites pulling `detectIdeFromEnv` + 3 legacy sites. Audit: "极低 ROI / 低 24h 关键度 / 极低 风险 / 5 分钟 + 1 vitest". Fix: extract `detectIdeFromEnv`/`IdeKind`/`IDE_KINDS`/`isIdeKind` to a new `src/services/context/ide-detect.ts`, update 4 source + 1 test import sites, add per-symbol PreToolUse hook + unit test that bans new imports of those 4 specific symbols (not the whole module).

## How to apply

### 14-file diff scope

| # | File | Action | LOC | Owns |
|---|---|---|---|---|
| 1 | `src/services/context/ide-detect.ts` | NEW | 28 | `detectIdeFromEnv` + `IdeKind` + `IDE_KINDS` + `isIdeKind` (verbatim extract) |
| 2 | `src/cli/commands/heartbeat-watch-command.ts` | NEW | 175 | `registerHeartbeatWatchCommand(parent, io)` — top-level `peaks heartbeat watch --batch-id <id> [--interval-ms <n>] [--stale-threshold-ms <n>] [--max-ticks <n>] [--json]`; enumerates `.peaks/_sub_agents/<sid>/dispatch-*.json`, filters by `record.batchId === --batch-id`, emits status via existing `summarize` + `viewSubAgent` + `renderStatusLine`; custom stale threshold handled (≤5min default; >5min suffix stripped; JSON envelope exposes threshold-specific stale block) |
| 3 | `src/services/standards/main-session-monitor-ban-hook.ts` | NEW | 36 | per-symbol PreToolUse hook (allows legacy trio from main-session-monitor; bans the 4 extracted symbols specifically) |
| 4 | `src/services/context/main-session-monitor.ts` | EDIT | 178 (was 206) | removes `detectIdeFromEnv` + `IdeKind` + `IDE_KINDS` + `isIdeKind` exports; re-imports `IdeKind` (type-only) + `detectIdeFromEnv` from `./ide-detect.js` for legacy trigger typing/behavior WITHOUT re-export |
| 5 | `src/services/context/auto-compact-dispatcher.ts` | EDIT | 285 | 1-line import path swap to `./ide-detect.js` |
| 6 | `src/services/context/auto-compact-reader.ts` | EDIT | 172 | 1-line import path swap to `./ide-detect.js` |
| 7 | `src/cli/commands/session-auto-compact-hook-command.ts` | EDIT | 130 | 1-line import path swap to `ide-detect.js` |
| 8 | `src/cli/commands/context-commands.ts` | EDIT | 321 | split mixed import (4 symbols: 3 legacy stay from main-session-monitor + `detectIdeFromEnv` moves to ide-detect) |
| 9 | `src/cli/commands/heartbeat-commands.ts` | EDIT | 153 | keep `registerHeartbeatCommand` UNTOUCHED (preserves `peaks sub-agent heartbeat` G6 fire-and-forget); ADD new `registerHeartbeatCommands(program, io)` (plural, top-level) creating `peaks heartbeat` parent + calling `registerHeartbeatWatchCommand` |
| 10 | `src/cli/commands/_register.ts` | EDIT | 154 | add 1 import + 1 registration entry for `registerHeartbeatCommands` (plural) |
| 11 | `tests/unit/services/context/ide-detect.test.ts` | NEW | ~80 | 6+ cases: CLAUDE_CODE_ENTRYPOINT / CLAUDE_SESSION_ID / TRAE_CLI / OPENCODE / unknown fallback / custom env |
| 12 | `tests/unit/services/context/main-session-monitor.test.ts` | EDIT | ~170 | 1-line import path split (legacy trio + detectIdeFromEnv) |
| 13 | `tests/unit/cli/heartbeat-watch-command.test.ts` | NEW | ~150 | 6+ cases: --batch-id required / record enumeration + batchId filter / status emission / custom stale threshold / --max-ticks test seam / JSON envelope |
| 14 | `tests/unit/standards/main-session-monitor-ban.test.ts` | NEW | ~80 | per-symbol scan test (regex matches 4 extracted symbol names + from-path; excludes self + legacy test); passes clean |

### Post-QA fixes applied (after FAIL return)

1. **`peaks request transition` LINT_GATE_FAILED**: RD request artifact at `rd/requests/003-...md` had 6 unfilled placeholder tokens (`<path>`, `<openspec change id>`, `<percent>`). Fixed by filling all placeholders with actual values (project path, N/A for openspec linkage, "not measured for this slice" for coverage per `peaks-vitest-locked-4-1-10` + `peaks-rid-005-b1-coverage-tooling-ceiling`).
2. **`auto-compact-reader.ts:29` duplicate semicolon**: cosmetic fix (`;;` → `;`).

### QA verify (PASS after fix)

Re-verify (Code-level, post-fix):

- **AC-B1..B3**: PASS — `peaks heartbeat watch --batch-id <id> [--interval-ms] [--stale-threshold-ms] [--max-ticks] [--json]` registers; rejects without `--batch-id`; existing `peaks sub-agent heartbeat --record --status --progress --note` UNCHANGED on `sub-agent` parent
- **AC-G1..G2**: PASS — `ide-detect.ts` exports 4 symbols; `main-session-monitor.ts` re-imports without re-export; 4 source import sites + 1 test import site updated; per-symbol scan test passes; `ide-detect.test.ts` 6 cases pass
- **AC-X1**: PASS — typecheck exit 0
- **AC-X2**: PASS — all 7 in-scope source files ≤ 800-line cap
- **AC-X3**: PASS — full vitest regression 12 files / 104 tests / 44.77s green (independent reproduction; QA agent's 10/69 count was a partial-suite reproduction)
- **AC-X4**: PASS — red-line grep clean (auto-compact + AI-co-author patterns EXIT=1 on 4 NEW/EDIT source files)
- **AC-X5**: PASS — `peaks heartbeat --help` lists `watch`; `peaks sub-agent heartbeat --help` UNCHANGED; `peaks code --help` 11 entries (10 sub-commands + help; rid-024 regression intact)
- **AC-X6**: PASS — rid-020a + rid-020b + rid-024 files byte-identical to HEAD `82159f72`
- **AC-X7**: PASS — `peaks release precheck --project . --json` overall=ok
- **AC-X8** (acceptance moment): PASS — `peaks request transition rid-025-... --state implemented` succeeded WITHOUT `--allow-incomplete` after LINT_GATE placeholders filled

### Preflight corrections applied (5 corrections + 2 verification issues)

5 plan-level corrections (teammate RD preflight surfaced):
1. `heartbeat-commands.ts` already exists (145 lines, `peaks sub-agent heartbeat` G6) — preserve untouched + add new `registerHeartbeatCommands` (plural) in same file
2. `main-session-monitor.test.ts` actually imports `detectIdeFromEnv` from old path — update path
3. `context-commands.ts` has mixed import (4 symbols) — split into 2 separate import statements
4. Dispatch filenames keyed by `requestId` (not `batchId`); `readRecords(paths)` not prefix-scan — enumerate then filter by `record.batchId`
5. `status-line-renderer.ts` has hardcoded `STALE_THRESHOLD_SEC = 5*60` — post-process rendered line to strip ` ⚠ stale` suffix when custom threshold > 5min; JSON envelope always exposes threshold-specific stale block

2 verification issues (teammate RD found mid-implementation):
- Hard-ban scan regex was too broad (blanket module path) → refined to per-symbol regex matching the 4 extracted symbol names + from-path
- Watch tests produced no stdout (async Commander action returning Promise) → wrapped polling loop in IIFE so action resolves immediately; added `--max-ticks <n>` test seam for deterministic tests

## Caveats the user should know

- **Commit NOT performed by sub-agent** — peaks-loop red rule: orchestrator owns commit; user must authorize. Commit message MUST NOT contain `Co-Authored-By: Claude/Anthropic` trailer; the only valid trailer is the meta `Co-author: SquabbyZ sole author`.
- **`peaks hooks install`** for `main-session-monitor-ban-hook.ts` is NOT yet executed (Code owns hook installation per the rd-sub-agent-dispatch hard prohibition). The hook file is shipped; `peaks hooks install` is a separate, manual step that runs the hook on Bash tool calls. The companion `tests/unit/standards/main-session-monitor-ban.test.ts` runs the same scan in vitest, providing the runtime check.
- **`peaks heartbeat watch` watch CLI behavior**: polls every `intervalMs` (10s default); exits when all records are terminal OR `--max-ticks <n>` reached. Production usage outside tests runs forever via `nohup peaks heartbeat watch --batch-id <id> --project . &`.
- **Two coexisting heartbeat paths** (intentional):
  - `peaks sub-agent heartbeat --record <path> --status ... --progress ... --note ...` — G6 fire-and-forget (sub-agent writes heartbeats)
  - `peaks heartbeat watch --batch-id <id> [--interval-ms ...] [--stale-threshold-ms ...] [--max-ticks ...] [--json]` — 24h offline daemon (parent polls heartbeats)
- **Test count discrepancy** between QA envelope and reproduction: QA ran a partial test set (10 files / 69 tests); independent reproduction of the full 12-file list yields 104 tests. All 104 pass. The discrepancy is reporting-only; no real test failure.

## 关联

- `.peaks/memory/2026-07-28-24h-loop-audit.md` — A-G source; audit's first-knife recommendation
- `.peaks/memory/2026-07-28-rid-020b-shipped.md` — Phase 1 ship; surgical-scope preservation
- `.peaks/memory/2026-07-28-rid-024-code-commands-split-shipped.md` — refactor ship; surgical-scope preservation
- `.claude/plans/giggly-drifting-pizza.md` — full rid-025 plan (with 5 corrections inline)
- `.peaks/_runtime/2026-07-28-session-22381b/rd/requests/003-2026-07-28-rid-025-heartbeat-watch-and-ban.md` — RD handoff (state=implemented)
- `.peaks/_runtime/2026-07-28-session-22381b/qa/requests/003-2026-07-28-rid-025-heartbeat-watch-and-ban-verify.md` — QA verify envelope
- commit `<pending user authorization>` — ship commit (SquabbyZ sole-author, no AI co-author trailer)