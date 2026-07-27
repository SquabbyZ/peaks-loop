---
title: rid-005 B1 coverage tooling ceiling — accepted 2026-07-27
kind: sediment
---
# rid-005 B1 coverage tooling ceiling — accepted 2026-07-27

## TL;DR

Phase 1 governance rid-005 标记为 partial improvement:B1 coverage gap (artifact-boundary.ts 5-statement + 3-branch) 在 vitest 4.1.10 锁版下结构性不可达。per user directive 2026-07-25 `peaks-vitest-locked-4-1-10.md`,**vitest 不升 5.x**。本 sediment 显式 accept 该 ceiling,避免后续 phase 反复 retry 同一问题。

## B1 gap 实测数据

per `.peaks/memory/2026-07-25-b1-vitest-coverage-tooling-closure.md`:

```
92.64% statements / 72.72% branches / 100% functions / 92.64% lines
```

100% threshold fails on:
- artifact-boundary.ts:5 statements + 3 branches uncovered
- attribution:tests/vitest.global-setup.ts lines 28-29, 35-37
- reason:global-setup runs ONCE in main process,V8 per-worker counters never see its lines
- structurally uncloseable:setup file runs once in test runner,not per worker

## user directive (binding)

per `.peaks/memory/peaks-vitest-locked-4-1-10.md`:

> user directive 2026-07-25: vitest is frozen at 4.1.10. Do not propose `vitest@^5` / `@vitest/coverage-v8@^5` / `@vitest/coverage-istanbul@^5`; the B1 coverage gate must be solved on 4.1.10 (e.g. self-hosted c8 post-test merge, narrowed istanbul scope, or accept threshold miss).

即:**接受 threshold miss 是 user 授权的 3 个解之一**。

## 已尝试的 workaround

1. **vitest 5.x upgrade** — ❌ 拒绝(per user directive)
2. **self-hosted c8 post-test merge** — ✅ adopted (commit B1 closure)
   - coverage 现 measurable,不再 fake-green 0/0
   - 92.64% / 72.72% 是真实 coverage,非 tooling error
3. **narrowed istanbul scope** — ❌ 不适用(vitest 4.1.10 + istanbul provider 在 Windows v8 instrumentation 有 broader problem)
4. **accept threshold miss** — ✅ adopted (本 sediment)

## accept 的具体内容

- **100% coverage threshold 不再被强制** — apply-gate Pre-cond 2 走 coverage-summary.json cross-check(Fix-6B commit `8d65ab08`),允许 documented gap
- **artifact-boundary.ts gap** — 显式 documented,允许 5 statements + 3 branches uncovered
- **vitest.global-setup.ts lines 28-29, 35-37** — 显式 documented,允许 uncovered(structural limit)
- **future tests 不需要 retry B1 closure** — sediment 是 source of truth,不再重新实施

## 不允许的尝试(避免假绿)

per `peaks-b1-coverage-global-setup-false-positive-2026-07-26.md`:

- ❌ `--exclude=tests/vitest.global-setup.ts` 产生 0/0 fake-green(被显式拒绝)
- ❌ 修改 coverage-summary.json 数据结构(被 G5 no-fake-green 拒绝)
- ❌ 移除 artifact-boundary.ts coverage requirement(违反 apply-gate Pre-cond 2 初衷)

## Why this sediment exists

Phase 1 governance plan (4 阶段 11 rids) 中 rid-005 状态:
- Phase 1 closeout: "rid-005 partial improvement (B1 coverage tooling ceiling)"
- Phase 2/3/4 推进过程中多次提及 "rid-005 仍 DEFERRED"
- 5 切片 (4 commit) 全部 closeout 后,rid-005 是唯一 remaining partial

本 sediment 提供 explicit closeout 信号:
1. B1 gap 真实存在但用户授权接受 ✓
2. 已尝试 3 种 workaround,选定 c8 post-test merge + accept threshold miss ✓
3. 不允许的尝试列表 explicit 记录,避免未来 LLM retry ✓
4. Phase 1 governance 现 5/5 closeout ✓

## How to apply (future iterations)

当未来 session LLM 看到 `92.64% / 72.72%` coverage 数字并尝试 "fix" 时:
1. **读本 sediment** — 确认 user 显式 accept threshold miss
2. **不 retry B1 closure** — 已被 Fix-6B (commit 8d65ab08) 部分缓解
3. **不 upgrade vitest** — user directive 锁版 4.1.10
4. **不 propose `--exclude`** — 已被 G5 no-fake-green 拒绝
5. **如果需要"更高 coverage"** — 必须有 user 显式 approve,不能 LLM 自主升级

## 后续事项

- Phase 1/2/3/4 governance 全部 closeout
- MEMORY.md ghost sediment drift 已记录(`memory-md-ghost-sediment-finding.md`)
- vitest 4.1.10 锁版是 binding constraint,不再 retry 5.x upgrade