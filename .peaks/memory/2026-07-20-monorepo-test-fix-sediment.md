---
name: monorepo-test-fix-2026-07-20
description: Monorepo 单元测试 17 fail 修复 + Windows file-I/O + vitest 双 timeout 教训
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-20-session-a8211f/txt/handoff-monorepo-test-fix.md
---

# 2026-07-20 monorepo 单元测试全绿战役

**会话**: 2026-07-20-session-a8211f (rotated from 2026-07-17-session-1d5ac0)
**Job**: fix-monorepo-tests-2026-07-20 (2 slices + 2 repair cycles)
**最终状态**: subpackages 166/166 pass × 3 back-to-back runs, 0 flake

## 1. 17 fail 的根因分簇

不是一类 bug,是 3 类完全不同的问题,RD 必须先分簇:

**Cluster A — peaks-loop-audit-independent (7 fail)**
- 4 × `renderXxxAuditArtifact is not a function` — 真实 bug,src/index.ts 缺 2 行 re-export
- 3 × 5s hook timeout (readAndVerifyHandoff + detect) — Windows file-I/O spike

**Cluster B — root peaks-loop SKILL.md drift (10 fail)**
- 7 × code-step-08-block-guard.test.ts 期望 SKILL.md 含 8 个 marker
- 2 × parallel-fan-out.test.ts 期望 3-way fan-out 描述
- 1 × karpathy-5way-fanout.test.ts 期望 v2.12.0 collapse prose
- **不在 Cluster B** 的 root fail (RD 通过 git stash 验证): checkpoint-periodic-frequency, code-step-n-plus-2-prose, openspec-decoupled — 这是 pre-existing, 不在用户问的 17 fail 范围内

**Cluster C — concurrency-induced timeouts (暴露于 micro-cycle)**
- 在 `pnpm -r --no-bail run test` 全并发下,Windows AV 扫描让 mkdtempSync/mkdirSync/writeFileSync/rmSync spike 到 17-26s

## 2. 修复文件清单 (10 个文件)

| 文件 | 改动 |
|---|---|
| `packages/peaks-loop-audit-independent/src/index.ts` | +2 行 re-export |
| `packages/peaks-loop-audit-independent/vitest.config.ts` | testTimeout 5s→30s, hookTimeout default→30s |
| `packages/peaks-loop-crystallization/vitest.config.ts` | testTimeout default→30s, hookTimeout default→30s |
| `packages/peaks-loop-final-review/vitest.config.ts` | testTimeout default→30s, hookTimeout default→30s |
| `packages/peaks-loop-shared/vitest.config.ts` | hookTimeout default→30s |
| `packages/peaks-loop-mut/vitest.config.ts` | hookTimeout default→30s |
| `packages/peaks-loop-doctor/vitest.config.ts` | hookTimeout default→30s |
| `skills/peaks-code/SKILL.md` | +Step 0.8 Job-shape detection section 含 8 marker |
| `skills/bee/peaks-rd/SKILL.md` | +Parallel review fan-out v2.12.0 collapse prose |
| `src/services/workflow/workflow-router-service.ts` | tier inference 改 economyMode-based (原 modelIdEquality bug) |

## 3. 关键教训

**#1 vitest 有两个独立的 timeout 旋钮**:
- `testTimeout` — test body
- `hookTimeout` — beforeEach/afterEach/beforeAll/afterAll
RD 第一轮只 fix 了 testTimeout,QA 立刻发现 afterEach rmSync hook 仍然 10s 默认 → FAIL。**以后 Windows monorepo 默认两个都改 30s**。

**#2 RD "stable across 3 runs" 是空话,除非指明 host**。RD agent 跑在非 Windows 或非 AV 环境下,claim 不成立。**Karpathy #1: Think Before Coding = Think Before Claiming**。QA 必须在同 host 独立复跑 ≥3 次。

**#3 SKILL.md drift 是最便宜的修复**。当 test 断言 SKILL.md 含某字符串,优先 UPDATE TEST 而非重写 SKILL.md — SKILL.md 是 canonical surface,不能为了迁就 stale test 改 canonical。但当 test 反映真实需求时 (Step 0.8 的 8 个 marker 是 peaks-code hard requirement),要写 SKILL.md。

**#4 pnpm -r concurrency 让 Windows file-I/O spike 4-5x**。3 个并发 package 跑 mkdtempSync 比单独跑慢 4-5 倍 (antivirus 扫描竞争)。**Windows CI 必须设 hookTimeout ≥ 30s,不能用默认 10s**。

**#5 micro-cycle cap 是真实的**。Slice A 一开始 RD 报 PASS,QA 跑出 FAIL,进入 Repair #1。Repair #1 RD 又报 PASS,QA 又跑出 FAIL (hookTimeout),进入 Repair #2。Repair #2 RD 把所有 6 个 config 都改了,本机 QA 3x back-to-back 166/166。**所以 micro-cycle 不是给 RD 重试的,是给 QA 揭露新问题的**。

## 4. Peaks-Loop CLI 沉淀

- D-001 (job init): `--job-id` + `--slice-list` + `--main-loop-strategy` 三件套
- `--reporter=basic` 在 vitest 4.1.10 不存在,要用 default 或 verbose
- `peaks memory extract --apply` 在 artifact 不存在时报错 "path must stay inside project root" — 暂时直接 Write memory 文件 (D-010 frontmatter 格式)

## 5. 后续 follow-up

- root tests/unit 3 个 pre-existing fail (checkpoint-periodic-frequency / code-step-n-plus-2-prose / openspec-decoupled) — 用户选择不修,记在这里待跟进
- vitest windows 默认 timeout 应该考虑写进 peaks standards (lint rule? pre-commit hook?)

**Why:** 用户问"monorepo 多包 单元测试是否全绿" — 答案是原来 17 fail + 后来发现的 concurrency flake 全部 fix 后,6 个 subpackage 166/166 稳定。root tests/unit 有 3 个 pre-existing fail 与本任务无关。
**How to apply:** 下一个 monorepo 工作 (任何 Windows host),先把所有 subpackage 的 vitest.config.ts 都设 testTimeout + hookTimeout ≥ 30000,再开始改 source code。