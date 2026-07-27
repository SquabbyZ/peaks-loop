---
title: rid-001 envelope closure 第 4 处 — Phase 1 tail closeout
kind: sediment
---
# rid-001 envelope closure 第 4 处 — Phase 1 tail closeout

## TL;DR

Phase 1 governance plan 的 rid-001 (envelope closure 第 4 处) 在并发 session 事故中 production code 丢失。emergency fix rid-001b (commit `00dff069`) 已落地全部 4 处 site 修复。本 tail 完成 verification + sediment 收口,**Phase 1 governance 正式 closeout-pass**。

## 4 处 envelope site 清单

| # | 位置 | 修复方式 | 引用 |
|---|---|---|---|
| 1 | src/cli/index.ts:unknown-cmd console.error | printErrorEnvelope helper | `00dff069` |
| 2 | src/cli/index.ts:bad-input console.error | printErrorEnvelope helper | `00dff069` |
| 3 | src/cli/index.ts:internal-error console.error | printErrorEnvelope helper | `00dff069` |
| 4 | src/cli/program.ts:162 createProgram() default ProgramIO | 直接 `io.stdout(JSON.stringify({...}))` canonical envelope + `process.exitCode = 1` | `00dff069` |

## Verification trail (2026-07-27 Phase 4 tail)

- **AC-1:** `grep -rn 'console\.error' src/cli/ --include='*.ts'` 返回 0 raw sites (only 1 comment match at `src/cli/cli-helpers.ts:84` 在 printErrorEnvelope 文档注释中提及历史 3 处 `console.error(JSON.stringify(...))`)。✓
- **AC-2:** `src/cli/program.ts:162` unknown-command path 直接 emit canonical envelope (`ok: false, command: 'cli', code: 'COMMAND_NOT_FOUND', ...`) 通过 `io.stdout`。✓
- **AC-3:** `tests/unit/cli/envelope-closure.test.ts` 6/6 cases pass in 4.03s。✓
- **AC-4:** in-process 测试覆盖 unknown-cmd 路径,无需 installed peaks binary。✓

## commit hash 引用

- **rid-001b:** `00dff069cda4bc833a0a22f565fdfb3eaea13b96` (SquabbyZ sole-author)
  - Subject: `fix(cli): rebuild printErrorEnvelope helper + replace 3 src/cli/index.ts console.error + fix program.ts:162 default io (rid-001b)`
  - 7 files changed (per original commit)
- **pin baseline for this tail:** `00f7002e` (rid-011 prior success slice)

## Why this tail exists

Phase 1 governance plan (4 阶段 11 rids) 的 5 个 Phase 1 rid 中:
- rid-001 PRD/RD ready 但 production code 在并发 session 丢失
- rid-002 取消 (dependency graph 太深)
- rid-003 ready 但 3 flaky test + coverage unmeasurable
- rid-004 commit `3c09df1e` PASS
- rid-005 partial improvement (B1 coverage tooling ceiling)

紧急修复 rid-001b (commit `00dff069`) 在 Phase 2 启动前已 landing,Phase 2 的 rid-006/007/008 + Phase 3 的 rid-009 都是基于 rid-001b 已修复的 envelope 状态推进的。**即 rid-001b 实质上就是 rid-001 的完整 deliverable**,只是缺少一个 explicit closure 信号。

本 tail 提供该 closure 信号:
1. 4 处 site 全部 verified ✓
2. tests/unit/cli/envelope-closure.test.ts 6/6 green ✓
3. sediment 沉淀 (本文档) ✓
4. Phase 1 governance closeout-pass 信号 (per peaks-audit verdict pattern) ✓

## How to apply (future iterations)

当 future phase 治理遇到 "production code lost in concurrent session" 类事故时,套用此 pattern:
1. **不要 re-implement** — 先 git log 找 emergency fix commit 是否已落地 deliverable
2. **verification-first tail** — write audit-goal 标记为 verification 性质 (severity=info across all 6 dimensions)
3. **closure sediment** — 单文件 ≤ 200 行,YAML frontmatter (title + kind),提供 commit hash 引用 + verification trail
4. **link audit-goal to nextSlice** — dependsOn: [completed rids], blocks: [next tail]

## 后续事项

- rid-003 tail (Phase 1 governance 第 2 个 tail) 待处理:3 flaky test 稳态化 + coverage 测算路径(vitest 4.1.10 锁版)
- Phase 2/3 governance closeout 信号已沉淀在 sediment `2026-07-27-peaks-code-phase2-governance-closeout.md` + `2026-07-27-peaks-code-phase3-governance-closeout.md`
- MEMORY.md index ghost sediment drift (3 ghost references: peaks-stale-cli-version-2026-07-23-diagnosis.md, peaks-unpublish-4-0-0-and-4-0-2-stuck.md, peaks-4-0-0-beta-20-icecola-surface-check-2026-07-22.md) 仍待清理