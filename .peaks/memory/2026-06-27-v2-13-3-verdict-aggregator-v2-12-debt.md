---
name: v2-13-3-verdict-aggregator-v2-12-debt
description: peaks-loop v2.13.3 ship state on 2026-06-28. v2.13.2 dogfood 抓 4 bug 全修: parseSecurity/Perf 真解析 v2.12.0 markdown / prepublishOnly build step / CLI surface warnings / handoff sha256 字段对齐. 162/162 PRD-targeted tests pass, 4 dogfood 0-2-tychetes, tsc 0. Carry-forward: v2.13.0 auto-compact 在 100% context 没救活 session (deferred to v2.14.0).
metadata:
  type: project
---

**v2.13.3 ship state (Windows session, 2026-06-28):**
- RID: 2026-06-27-verdict-aggregator-v2-12-debt
- Branch: main (commit on top of v2.13.2 commit `1aac7e2`)
- Tests: **162/162 PRD-targeted pass** (v2.13.2 baseline 149 + v2.13.3 new 13). Full unit suite: **4363/4364 pass + 17 skipped** (1 pre-existing tokenizer.test.ts flake confirmed on clean HEAD `1aac7e2` after stashing v2.13.3; not introduced by v2.13.3)
- tsc --noEmit: 0 errors
- Final review: peaks-qa sub-agent verdict=pass-with-warning, 6 AC all green, 1 minor AC-2 Windows defect patched in 2.13.3 directly (shell:isWindows fix)

**v2.13.3 footprint:**
- 7 source files modified (src/services/verdict/envelopes.ts +192/-18; src/cli/commands/verdict-aggregate-command.ts +13/-31; src/services/prd/handoff-auto-regen.ts +8; src/services/artifacts/request-artifact-service.ts +18/-7; src/cli/commands/request-commands.ts +13/-1)
- 3 test files modified (+357 lines: envelopes +112, handoff +62, request-commands +183)
- 3 new scripts (prepublish-build.mjs/sh/ps1)
- package.json prepublishOnly hook + README publish note
- CHANGELOG.md +78 lines + version.ts 2.13.2→2.13.3 + this memory file

**4 dogfood-found bugs fixed:**

1. **parseSecurity/Perf 修真解析 v2.12.0 markdown** (AC-1) — JSON.parse fallback to YAML frontmatter + `## Findings` shape B bullets. Real v2.12.0 `audit/security.md` with HIGH violation now returns non-null envelope. `peaks verdict aggregate` 真实 fixture 跑出 `reasons: [{severity: HIGH, file: src/auth.ts:42, hint: hardcoded password}]` (不再是 `reasons: []`).

2. **publish pipeline 修 build step** (AC-2) — `package.json` prepublishOnly 钩子走 `node scripts/prepublish-build.mjs`. 3 个跨平台 variant (mjs/sh/ps1). dogfood: `bash scripts/prepublish-build.sh` end-to-end → `pnpm build OK` exit 0. 修了 v2.13.2 `bin/peaks.js` 指 Jun 13 stale dist 的问题.

3. **CLI surface warnings** (AC-3) — `PrerequisitesNotSatisfiedError.warnings` 字段 surfaced in `data.warnings` of PREREQUISITES_MISSING response. MUT_REPORT soft-block (`mut-report-missing-deprecated-in-v2.14.0`) 现在 user 可见 (不再是 service-layer silent 降级).

4. **handoff frontmatter 字段对齐** (AC-4) — `autoRegenPrdHandoff` 写 `sha256:` (primary) + `handoffHash:` (alias). 修了 v2.13.2 dogfood "missing section(s): sha256:" 错误.

**Known limitations (carry-forward to v2.14.0):**

1. **v2.13.0 auto-compact 没救活 100% context session** (用户反馈 2026-06-28) — v2.13.0 设计的 85% pre-compact + 95% red-line 0-intervention 协议在 ad-hoc Claude Code 跑 peak-cli session 时没生效 (this session 跑到 100% 没触发 auto-compact). 已知 v2.13.0 release notes 写过 "Ad-hoc Claude Code runner cannot be externally compacted" 限制, 但 v2.13.3 没修这个. v2.14.0 应该: (a) 给 Claude Code adapter 加更激进的 PreToolUse hook (在 tool call 之前自动跑 context-now), (b) 或改 `peaks code auto-compact` 接受 `--force-spawn-detached` flag 在 100% 时 force 触发, (c) 或直接 fallback 到 `/compact` slash command.

2. **scripts/prepublish-build.mjs Windows EINVAL** — `shell: isWindows` 是 partial fix. POSIX / git-bash .sh 路径 OK, Windows native + git-bash 内 Node 22 spawnSync 仍有 cmd.exe ENOENT. Real npm publish 路径 OK (CI Linux). v2.14.0 应换 `cross-spawn` 或 execFile.

3. **MUT_REPORT hard-fail** — 软阻断只是 surfaced, 实际 missing → throw 转换在 v2.14.0.

4. **pre-existing tokenizer.test.ts timeDecayScore flake** — 2.13.2 memory 已记, v2.14.0 应修.

**Why:** Why I should remember this: v2.13.3 是 v2.13.0 (auto-compact) / v2.13.1 (verdict reasoning) / v2.13.2 (verdict fix) / v2.13.3 (parser + pipeline) 4 切片系列的第 4 个. 整 loop 走完: 1) v2.13.1 dogfood 抓 1 bug → 2.13.2 修 + 加 4 carry-forward; 2) v2.13.2 dogfood 抓 4 bug → 2.13.3 修; 3) v2.13.3 ship 时 user 报 context 100% auto-compact 没生效 → 2.14.0 backlog. 这是 peaks-loop 第一次连续 4 个 PATCH 都被 dogfood 抓到真实问题 → 是 v2.13.0 5/5-ac-via-2.13.1→2.13.3 收敛协议的胜利, 但也说明 13-case 单测覆盖远不够 (parser 漏了真实 markdown fixture).

**How to apply:** When resuming v2.14.0, read this memory + 2.13.2 memory + 2.13.1 memory. 优先做: 1) v2.13.0 auto-compact 修 (用户 2026-06-28 反馈) 2) MUT_REPORT hard-fail 转换 3) 5 envelope schema unification (any 2 个) 4) prepublish mjs Windows fix.
