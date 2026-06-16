---
name: 2026-06-16-six-issue-user-feedback-batch
description: 6 user-reported issues from real Claude Code usage → 6 PRDs (rules-write-path, fact-forcing-gate-format, hook-governance, peaks-rd-no-gates, playwright-restart-loop, cli-logging) + 1 follow-up PRD (peaks-solo-auto-scaffold). All shipped to develop @ 914e9ef on 2026-06-16. Notable lessons: realpath-guard false-positive (caught only by dogfood, not QA), Fact-Forcing Gate fix verified by test seam but NOT by real Claude Code hook (still fires in this session), and the peaks-cli-vs-consumer-project integration gap that motivated PRD#7.
kind: feedback
---

For session `2026-06-16-session-aaf8c7` on `/Users/yuanyuan/Desktop/peaks-cli`, the user gave 6 real-world Claude Code usage issues + 1 follow-up observation about integration gap. All 7 PRDs shipped to develop on 2026-06-16 (commits `8f15bba` through `914e9ef`).

**The 6 issues:**
1. `.claude/rules` 写到全局而非项目内 — but investigation revealed `~/.claude/rules/` is BY DESIGN (postinstall baseline from `scripts/install-skills.mjs:408-409`); the real bug is (a) `peaks standards init` with no `--project` and cwd == homedir falls back to global, and (b) `peaks-solo` doesn't auto-scaffold consumer projects.
2. `[Fact-Forcing Gate]` hint rendered as `PreToolUse:Bash hook error` (Fact-Forcing Gate hook output was on stdout not stderr; exit non-zero with no stderr → Claude Code wraps as error).
3. Hook governance more broadly — PRD#2 is narrow fix; PRD#3 widened it to all 13 hook emission sites via `emitHint`/`emitBlock`/`emitDecision` helpers.
4. `peaks-rd` 在 platform-rag-web 缺 CR/安全/性能 — root cause confirmed: `.claude/rules/` empty → standards read returns nothing → gates silently skipped.
5. Playwright MCP 在 platform-rag-web 反复启停 — LLM reflex `browser_close` + `browser_navigate` in tight loop without reuse hint.
6. peaks-cli 缺日志 — needed for bug reports.

**Plus the follow-up observation (#7):** "peaks-cli 在自己的项目里效果比实际消费项目好很多" — root cause: PRD#1 G5 was marked NG by the original RD. Created PRD#7 (`2026-06-16-peaks-solo-auto-scaffold`) which adds `detectMissingProjectStandards` + `--init-standards` flag + once-per-session dedup marker.

**Lessons learned:**

**Lesson 1 — Realpath-guard false-positive caught ONLY by dogfood, not by 3 QA cycles.** PRD#1's `assertNotHomedirBaseline` had `isInsidePath(realProjectRoot, realHomeRoot)` which fired for ANY project under `~/` (every consumer project). The 10-test regression suite only covered `projectRoot === homedir`; never tested the "project is subdir of home" common case. Synthetic fixtures used `mkdtempSync(tmpdir())` (which on macOS is `/var/folders/...`, NOT under `os.homedir()`). 3 QA cycles all PASSED. Only the manual dogfood on platform-rag-web caught it. Fix: narrowed to `realProjectRoot === realHomeRoot` exact equality; rely on the second check (write target inside `<homedir>/.claude/`) for the real protection. **Future regression suites must include a "project under home" fixture.**

**Lesson 2 — Fact-Forcing Gate fix verified by test seam but NOT by real Claude Code hook.** PRD#2's QA passed via `tests/unit/gate/enforce-format.test.ts` (16 tests). But the hook in this actual Claude Code session STILL fires the gate as `PreToolUse:Bash hook error` (re-evidenced when I tried to edit .gitignore and got the same error). Root cause hypothesis: the test seam (`PEAKS_HOOK_STDIN`) bypasses the real hook path that Claude Code invokes. The PRD#2 fix likely lands in a code path the real hook doesn't reach. **Future hook slices must add a parser-level regression test that invokes the actual hook via Claude Code's hook invocation pattern (not just the test seam).** This is an open follow-up for PRD#2.

**Lesson 3 — peaks-cli project integrates better than consumer projects BY DESIGN, not by accident.** peaks-cli project was manually scaffolded (before peaks-cli 2.0 existed), and the dev actively maintains it. Consumer projects (`platform-rag-web`) were never bootstrapped. The fix is PRD#7 (`peaks-solo-auto-scaffold`): when a consumer project's `.claude/rules/{common,typescript}/` is empty, emit a diagnostic + offer `--init-standards`. Marker file `.peaks/_runtime/<sid>/.standards-checked` dedups to once-per-session.

**Repair cycle pattern observed:**
- PRD#1: 1 RD + 1 QA + 1 inline dogfood patch (false-positive caught by manual test, patched in same session)
- PRD#2: 1 RD + 1 QA = PASS first try
- PRD#3: 1 RD + 1 QA = PASS first try
- PRD#4: 3 RD + 3 QA = PASS cycle 3 (service-layer overlay cycle 1 + CLI workspace context cycle 2)
- PRD#5: 2 RD + 2 QA = PASS cycle 2 (Commander 12 --no-X parser convention cycle 1)
- PRD#6: 3 RD + 3 QA = PASS cycle 3 (custom version action cycle 1 + bootstrap dedup cycle 2)
- PRD#7: 1 RD + 1 QA = PASS first try

Repair cap = 3 cycles per the peaks-solo protocol. PRD#4 and PRD#6 hit cycle 3.

**Cross-platform note (user develops on Windows + macOS):**
- All 7 PRDs explicitly addressed win32 path separators, `os.homedir()` differences, and cross-platform test mocks.
- All 7 TXT handoffs include explicit "dogfood on BOTH macOS AND Windows" instructions.

**Open follow-ups (each PRD's TXT handoff has the full list):**
- PRD#2 (the open one): real Claude Code hook still uses old behavior despite QA pass — needs follow-up to actually deploy the fix to the installed hook path
- PRD#3 O2: Trae adapter regression in gate-commands.ts (formatDecisionResponse no longer called there)
- PRD#4 Q1-Q3: stderr sync emission / audit-log emission / one-time suppression marker
- PRD#5 O1-O3: Windows tool-name divergence / multi-tab scenario / MCP-level event stream integration
- PRD#6 Q1-Q3: win32 ACLs / UTC vs local TZ / field-level redaction list
- `workspace-commands.ts` is 925 lines (pre-existing over 800-line Karpathy cap; refactor slice recommended)

See `.peaks/_runtime/2026-06-16-session-aaf8c7/{prd,rd,qa,txt/handoffs}/` for full artifacts of each slice.
