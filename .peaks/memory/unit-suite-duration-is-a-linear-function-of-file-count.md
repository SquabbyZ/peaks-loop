---
name: unit-suite-duration-is-a-linear-function-of-file-count
description: 单测墙钟随测试文件数近似线性（@2 workers 1.357 s/文件，@4 workers 0.776 s/文件），文件数近 +9.1 个/天；护栏形状 = 只能降的 ceiling + 并发键 + 由 --tighten 抬升的人口下限
metadata:
  type: project
  node_type: memory
  modified: 2026-10-25T13:55:00.000Z
---

# 单测时长是测试文件数的线性函数，不是「将来可能超长」的风险（2026-10-25 实测）

## 事实

仓库 14 条 `.husky/` 门禁里**没有任何一条**测量或约束单测时长与测试文件数。2026-10-25 实测
（win32 / 16 核 / vitest 4.1.10）：

| 指标 | 值 |
|---|---|
| 全量墙钟 @2 workers | **854.74 s**（629 文件 / 6831 用例） |
| 全量墙钟 @4 workers | **489–534 s**（两次观测，505.3 s 一次） |
| import 税 | **163.62 s = 19.1 %**（`pool:'forks'` + 默认 `isolate:true` ⇒ 每文件一次 fork 启动，0.2597 s/文件） |
| 有效并行度 @2w | **1.65×**（`vitest.workers.ts` 的 `DEFAULT_MAX_WORKERS = 2` 是固定值，不随 CPU 伸缩） |
| 每文件墙钟成本 | **1.357 s**（@2w）/ **0.776 s**（@4w） |
| 测试文件数增长 | 2026-08-05 = 54 → 09-20 = 311 → 10-25 = **630**（近期 **+9.1 个/天**） |

**结论：墙钟随文件数近似线性**，所以撞 CI `test` 作业 `timeout-minutes: 60` 的规模是可外推的
（本地口径约 2650 个测试文件）。增长原本完全静默，第一个信号是作业超时——一个不带原因的信号。

## 三条被测出来的结论

1. **`isolate: false` 与本仓库的测试风格结构性不兼容**。成对测量（同子集、同机器、同 reporter）：
   墙钟 128 s → **753 s（+488 %）**，失败断言 15 → 65，失败文件 4 → **14**（新增集中在 lint(6)/web(2)/
   sop(1)/job(1)）。三类泄漏：`vi.mock()` 是 per-process、模块注册表共享、`process.env`/PATH 变更泄漏。
   同配置两次观测给出 298 s 与 753 s——**结果本身不确定**。
   ⇒ 163 s 的 import 税是「每文件独立 fork」这条路线的**兼容性代价**，省不掉。

2. **4 workers 没有引入负载形状 flaky**。全量 6831 条用例在 2 与 4 workers 下**只有一条**翻转，
   而它与环境变量取值有关、与并发无关（见下条）。

3. **`vitest-worker-cap.test.ts` 的断言按构造禁止了并发逃生舱**。它断言「本进程 import policy 时环境里
   没有 `PEAKS_VITEST_MAX_WORKERS`」，而 `vitest.workers.ts` **正是读这个变量**决定 worker 数——
   只要设了它，断言必然失败（`expected 4 to be 2`）。这解释了 CI 从来不设它：**不是没人想到，是设了就会红**。
   ⇒ 「文档化的逃生舱被自己的护栏堵死」这一类缺陷，只有把护栏**真的在那个环境下跑一遍**才会暴露。
   ⇒ 修法不是改默认值，是把断言改成与 **import 时刻的环境值**比对。

## 护栏形状（第三种方向）

`.peaks/lint/test-duration-ceiling.json` 是 `.peaks/lint/` 里的**第三个**产物，方向与前两个都不同：

| | `gate-baseline.json`（ceilings） | `coverage-floor.json`（linesPct） | `test-duration-ceiling.json`（wallSeconds） |
|---|---|---|---|
| 能往哪走 | 只能降 | 只能升 | **只能降** |
| 人口下限由谁抬升 | — | `--raise` 写 `files` | **`--tighten` 写 `population.files`** |

三个容易被忽略的点：

- **并发键**：`ceiling.maxWorkers` 是上限成立时的并发度。新鲜测量若在不同并发度 ⇒ **拒绝**而不是比较
  （墙钟只在同一并发度下可比；4 workers 的数去比 2 workers 的上限，上限就悄悄失效了）。
  `--report` 读的是录制报告、报告不携带并发度，所以这条只作用于新鲜测量。
- **人口下限必须随收紧抬升**，否则它会随套件增长**自己贬值**：套件从 629 涨到 1200 后，一份只覆盖
  700 个文件的子集报告依然能读成绿。兄弟门禁 `.husky/coverage-ratchet.mjs --raise` 就是这么做的。
- **收紧必须在执行该上限的那台机器上做**。本地 win32 实测 505 s 会把 2700 s 的种子收到 806 s，
  而 ubuntu runner 更慢，CI 首跑即撞红——响亮的失败，但值得写明。

## 复核命令

```powershell
npx vitest run --config vitest.config.ts --reporter=dot          # 2 workers 基线
$env:PEAKS_VITEST_MAX_WORKERS='4'; npx vitest run --config vitest.config.ts --reporter=dot
npx vitest run --config vitest.config.ts tests/unit/services --no-isolate --reporter=dot
node .husky/test-duration-ratchet.mjs --report <一份 vitest JSON 报告>
git ls-tree -r --name-only <sha> -- tests/unit | Select-String '\.test\.ts$' | Measure-Object
```

相关：[[peaks-code-hook-hooks-are-the-enforcement-surface]]
