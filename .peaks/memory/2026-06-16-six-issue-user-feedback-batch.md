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

**Lesson 2 (CORRECTED 2026-06-16T13:55Z) — original assumption was wrong.** The first version of this lesson said the Fact-Forcing Gate fix was verified by the test seam but not by the real Claude Code hook. The CORRECTED understanding is: the `[Fact-Forcing Gate]` text the user reported is Claude Code's built-in LLM behavior constraint, NOT emitted by any peaks-cli hook. The text "Quote the user's current instruction verbatim" does NOT exist in any peaks-cli source file (grep returns 0 matches). The `emitBlock` improvement from PRD#2 still has independent value for the `peaks gate enforce` Bash path. The user's actual reported issue is a Claude Code UI bug (a hint rendered as an error); an issue template is at `.peaks/_runtime/2026-06-16-session-aaf8c7/txt/issue-templates/claude-code-fact-forcing-gate-ui.md`. **Takeaway for future hook slices: before assuming a hook output comes from a hook, grep the source for the specific text. The text might be from the host (Claude Code), not from any installed hook.** The regression test added in PRD#8 (`tests/unit/hook-binary-build-regression.test.ts`) still has independent value: it catches the "src edited but dist not rebuilt" failure mode regardless of which chrome the host UI uses.

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
- **PRD#2 (CORRECTED 2026-06-16)**: original diagnosis was incorrect. The `[Fact-Forcing Gate]` text the user reported is Claude Code's built-in LLM behavior constraint, NOT emitted by any peaks-cli hook. The text "Quote the user's current instruction verbatim" does NOT exist in any peaks-cli source. The `emitBlock` improvement from PRD#2 still has independent value for the `peaks gate enforce` Bash path. The user's actual reported issue is a Claude Code UI bug; an issue template is at `.peaks/_runtime/2026-06-16-session-aaf8c7/txt/issue-templates/claude-code-fact-forcing-gate-ui.md`.
- PRD#3 O2: Trae adapter regression in gate-commands.ts (formatDecisionResponse no longer called there)
- PRD#4 Q1-Q3: stderr sync emission / audit-log emission / one-time suppression marker
- PRD#5 O1-O3: Windows tool-name divergence / multi-tab scenario / MCP-level event stream integration
- PRD#6 Q1-Q3: win32 ACLs / UTC vs local TZ / field-level redaction list
- `workspace-commands.ts` was 925 lines; now split via PRD#9 into 7 files, all ≤ 800.

**Corrected Lesson 2 (2026-06-16T13:55Z):** The original Lesson 2 said "Fact-Forcing Gate fix verified by test seam but NOT by real Claude Code hook (still fires in this session)". The CORRECTED understanding is: the `[Fact-Forcing Gate]` text is Claude Code's internal behavior, NOT a peaks-cli hook. peaks-cli cannot fix it. The test seam itself was fine; the issue was a wrong root cause assumption in the PRD. The real takeaway: **before assuming a hook output comes from a hook, grep the source for the specific text** — the text might be from the host (Claude Code), not from any installed hook.

See `.peaks/_runtime/2026-06-16-session-aaf8c7/{prd,rd,qa,txt/handoffs}/` for full artifacts of each slice.
