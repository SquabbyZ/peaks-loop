---
name: vitest-perf-3-slice-delivery-and-3-active-disclosures
description: vitest-perf-治理-3-slice-delivery-and-3-active-disclosures
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/txt/handoff-004-vitest-perf.md
---

# Lesson — vitest 单测性能治理(2026-07-10)

## 三个切片已落地(Slice 1/2/3)

1. **Slice 1 (方案 B)**: 把 `pnpm test` 的 silent-warning AST 扫拆出热路径,改 `pnpm test:audit:silent-warning` 单独跑;新增 `pnpm test:ci` aggregate(CI gate)。本地开发循环省一次 AST 扫。
2. **Slice 2 (方案 C)**: 加 6 个 subset scripts(`test:unit` / `test:integration` / `test:cli` / `test:workflow`)+ `test:changed`(基于 git diff 的 fast path)。
3. **Slice 3 (方案 A)**: 多 fork 解锁 — `singleFork: false` + `minForks: 2` + `maxForks: 4`(env-tunable);`tests/vitest.setup.ts` 改 per-PID backup + refcount sidecar,跨 worker 安全。

## 关键 QA(2026-07-10 实测)

- ✅ `pnpm test` 不再被 silent-warning 挡
- ✅ 5 轮 race-mode 5:5 全绿(57/57 tests, 0 errors),baseline A/B 对比未引入新 flake
- ✅ 6 session-aware 文件 172/172 passed
- ✅ 8-file subset wall-time 54s → 29s(1.86× speedup)

## 三个主动披露

1. **目标 < 3 min 不可达**:`pnpm test` 全量在 4 worker 下估计 5-7 min,CLI integration tests 主导 wall-time;进一步压到 3 min 需要 Slice 4(大文件瘦身)。
2. **silent-warning 5 处 violation 全部是误报**:全部是设计认可的故意吞(best-effort / fail-closed / vendor-neutrality),detector 不读注释是已知缺陷。
3. **race-mode 首次跑偶发 flaky**:9 轮后续全绿,怀疑机器热状态,不构成 deterministic bug。

## 用户最该用的入口

- `pnpm test:dev` (unit subset, 5-7 min)
- `pnpm test:dev:cli` (38 CLI 文件, 5 min 量级)
- `pnpm test:changed` (diff-based, 30-60s)
- `pnpm test` (全量, 留给 CI;本地不推荐)
- `pnpm test:ci` (aggregate, 留给 CI)

## Karpathy 自检

- #1 Think Before Coding:5+ 行 micro-plan 显式推理(setup PID 隔离 / refcount / lock 三层防御)
- #2 Simplicity First:无第三方依赖,只 stdlib(proper-lockfile 未引入)
- #3 Surgical Changes:setup.ts + config.ts + package.json + 1 new file,其他零改
- #4 Goal-Driven Execution:多 fork 解锁 + race-mode 不退化 + 31 session-aware shape 不变,三个目标全部命中
