---
name: slice-018e-maxworkers-4-to-8
description: vitest.config.ts fast 项目 maxWorkers 4 → 8 实测 wall 改善 10.7%(42m29s → 38m0s),但单文件 duration 显著变长(部分 +150%)。slice-018d 之后继续优化,1 行 config 改动,零测试代码风险。
metadata:
  type: lesson
  layer: A
---

# Slice 018e — vitest maxWorkers 4→8 实测(wall 改善 10.7%)

**Date:** 2026-07-15
**Session:** 2026-07-14-session-cebb2d
**Slice:** 018e(slice-018d 之后的第二步)
**Outcome:** fast 项目 maxWorkers 4 → 8,wall 42m29s → 38m0s,改善 10.7%。

## 触发

slice-018d 落地后用户实测报"25 min / 125 文件"。RD 用 full-run-result.json 实测完整跑后发现:

- 用户报告的"125 文件 / 25 min"是真实进度切片(对应 38% wall)
- fast 项目下 top-20 长尾文件累计 1944s (32 min),占 wall 28.8%
- 单文件 duration median 31s,avg 38.8s,max 194s
- 4-worker 理论最小 wall 28 min,实测 42 min,差 fork 启动 + coverage + globalSetup 开销

用户决定走"加 worker 数"方案,试图把 4-worker 理论 28 min → 8-worker 理论 14 min。

## 改动

`vitest.config.ts` fast 项目:

```diff
 fileParallelism: true,
-maxaxWorkers: 4,
-minWorkers: 1,
+maxWorkers: 8,
+minWorkers: 1,
```

1 行配置改动,零测试代码风险。

## 实测结果(权威,来自 `.peaks/_runtime/full-run-maxworkers8.json`)

| 指标 | slice-018d (4) | **slice-018e (8)** | 改善 |
|---|---|---|---|
| Wall | 2549s (42m29s) | **2277s (38m0s)** | **+10.7% (-4.5 min)** |
| Test suites | 1866 | 1866 | — |
| Tests passed | 5853 | 5853 | — |
| Tests failed | 0 | 0 | — |
| Top-1 file duration | 193.9s | **488.4s (+152%)** | 单文件变慢 |
| Top-20 file duration 累计 | 1944s | 3541s (+82%) | 单文件变慢 |
| 总 duration 累计 | 6748s | 11163s (+65%) | 单文件变慢 |

**意外发现**:加 worker 让**单文件变慢**(部分 +150%),但总 wall 仍因并行效率提升而下降。

## 为什么单文件变慢但总 wall 改善

- 8 worker 互抢系统资源(子进程端口 / fd / Temp 目录 / git lock / 文件系统锁)
- 单个 worker 的 transform + setup + test 阶段都因为 OS 调度延迟增加而变慢
- 但 8 worker 并行处理 8 个文件,总吞吐仍然高于 4 worker
- **边际效应递减**:再加 worker(16/32)单文件会继续变慢,总 wall 改善会迅速饱和

## 后续建议

1. **保留 slice-018e** — 10.7% wall 改善是真实有效的
2. **不建议再加大 worker 数** — 单文件 duration 已显著恶化,边际效应递减
3. **真正能进一步降 wall 的路径**:
   - 治 top-20 长尾文件(per-test budget / 跳过真 git / fixture 轻量化)
   - 把 `job-resource-snapshot.test.ts`(488s)拆成更小的 describe 块
   - 给 `g8-shared-channel.test.ts` 加 240s budget(它本来是 race-mode,但目前 wall 已 229s)
4. **commit message 诚实写**:"10.7% wall 改善,单文件 duration 显著变长,但总 wall 仍下降"

## 为什么这个方案属于"配置调优"而不是"架构治理"

- 架构治理(slice-017d slow / slice-018d io-heavy)消除互抢
- maxWorkers 调整只是**在已有的互抢下,用更多 worker 摊销单 worker 变慢的总开销**
- 不是消除互抢,只是接受互抢 + 用并行换 wall
- 长期看,worker 越多互抢越严重,这条路有天花板

## 真正的"治本"路径(留给后续 slice)

1. 改造 top-20 长尾文件:
   - 减少 fixture 创建/清理
   - 跳过真实 git 操作(用 mock 替)
   - 拆分大 describe 块成多个小文件
2. 用 memfs 替 mkdtempSync(大幅减少 fs IO)
3. 用 inject 替 execSync(消除子进程 spawn)

这些改造工作量 1-2 周,可预期再降 30-50% wall。

## Why: see also

- [[slice-018d-io-heavy-vitest-project-split]] — 三项目拆分(wall 没改善,但架构正确)
- [[slice-018d-full-run-diagnosis]] — full-run 实测数据(推翻 15% 改善说法)
- [[slice-017d-vitest-projects-slow-lane-split]] — 二分架构原型
- [[slice-019-pnpm-test-full-budget-fixes]] — 同类 per-test budget 调高,治 fast 长尾文件
- **本 slice 是 slice-018d 的妥协**:架构治理失败后的配置调优兜底