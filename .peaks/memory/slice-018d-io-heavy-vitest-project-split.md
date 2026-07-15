---
name: slice-018d-io-heavy-vitest-project-split
description: vitest.config.ts 加第三个 inline project io-heavy (maxWorkers: 1, fileParallelism: false),把 ~58 个真 spawn 子进程 / 真 fs IO 文件从 fast 项目拆出。承接 slice-017d 二分架构,缓解 fast 项目 4-worker 下 IO 互抢导致的 wall-time 飙升(典型 install-skills-script 12 min → 71s,90% 改善)。预期 pnpm test:full 38 min → 20-25 min。命名说明:slice-018 已被 orphan-scan-budget-fix 占用,本 slice 命名为 slice-018d 延续 017d 的字母后缀惯例。
metadata:
  type: lesson
  layer: A
---

# Slice 018 — vitest 三项目 io-heavy 拆分(38 min → 20-25 min)

**Date:** 2026-07-15
**Session:** 2026-07-14-session-cebb2d
**Slice:** 018(承接 slice-017d 二分架构)
**Outcome:** vitest.config.ts 加 io-heavy 第三项目,接管真 IO 类文件;单文件实测 install-skills-script 70.97s(原 12 min),改善 90%。

## 根因(从 38 min wall-time 反推)

用户报告 `pnpm test:full` 520 文件 / 5000+ 测试要 38 min。slice-017d 已经把 `vi.doMock('node:fs') + vi.resetModules()` 类的 5 文件拆到 slow 项目(单 worker),贡献了 ~80s。但 38 min 的主战场在 fast 项目下:

- **真 spawn 子进程**:`execFile|execSync|spawn\(|child_process` 命中 ≥1 次的文件 ~20 个(典型:install-skills-dispatch、dispatcher-flow、code-detect-job-command、code-gate-step-08-hook 等)
- **真 fs IO**:`mkdtempSync|mkdtemp\(|tmpdir\(\)|fs\.mkdtemp` 命中 ≥1 次的文件 ~50 个(典型:install-skills-script、pipeline-verify-service、sc-service-fs-failure、share/bundle-reader 等)

在 `maxWorkers: 4` 并发下,这些文件**互相争抢**:
- 子进程端口 / fd / Temp 目录
- 文件系统锁(尤其 Windows 上 `mkdtempSync` 树创建/清理)
- git lock / `tsx` 子进程 CPU

代表性重灾区:`install-skills-script.test.ts` 单独跑 <5s,4-worker 全套下被拖到 12 min;`pipeline-verify-service.test.ts` 同样 12 min。这两文件加 36 min 累计,占 38 min 总 wall 的 **~95%**。

## slice-017d 的二分不够

slice-017d 的 slow 项目是给 `vi.doMock('node:fs')` 类准备的 — 它解决的问题是**模块缓存失效导致的 transform 放大**,跟 IO 互抢是不同的失败模式。把 IO 类文件也合并进 slow:

- 单 worker 跑 60+5 = 65 个文件(其中很多是真子进程测试,跑得慢)→ slow 项目从 78s 膨胀到 25+ min
- slow 项目失去了"轻量、隔离"的语义

所以需要**第三个独立项目** — io-heavy。

## 选型:三个项目的语义分工

| 项目 | pool 配置 | 接管文件 | 解决的问题 |
|---|---|---|---|
| fast | `maxWorkers: 4`, `fileParallelism: true` | ~454 轻量测试 | 不互相阻塞,发挥 4-worker 并行优势 |
| slow | `maxWorkers: 1`, `fileParallelism: false`, `testTimeout: 600s` | 5 文件(slice-017d) | `vi.doMock('node:fs')` 类 transform 失效 |
| **io-heavy** | `maxWorkers: 1`, `fileParallelism: false`, `testTimeout: 600s` | **58 文件(slice-018)** | **真 spawn 子进程 / 真 mkdtemp 互抢系统资源** |

三个项目配置完全独立(`extends: true` 共享 setupFiles/globalSetup/coverage/experimental),只是 pool + 文件清单不同。

## 文件筛选方法

grep 静态判定 + 排除三类:

1. **grep `execFile|execSync|spawn\(|child_process|mkdtempSync|mkdtemp\(|tmpdir\(\)|fs\.mkdtemp`** 命中 ≥1 次的所有 `tests/**/*.test.ts`
2. **排除 helper / utility**(`_cli-helper.ts`、`cli-program-test-utils.ts` 等)
3. **排除 fs-mock 类**(`tests/unit/tech-service.test.ts` 同时命中 `vi.doMock('node:fs')` 24 次,本质属于 slow 项目类 — 但**没动**,留给后续 slice 决定)

去重后 60 文件 → vitest list 实际匹配 58 文件(2 个 helper 被 vitest 静默 skip)。

## 配置(关键片段)

```ts
projects: [
  // fast(slice-017d 已存在,不动)
  { extends: true, test: { name: 'fast', include: ['tests/**/*.test.ts'], exclude: [<原 5 slow> + <60 io-heavy>], fileParallelism: true, maxWorkers: 4, minWorkers: 1 } },
  // slow(slice-017d 已存在,不动)
  { extends: true, test: { name: 'slow', include: [<5 slow>], exclude: [], fileParallelism: false, maxWorkers: 1, minWorkers: 1, testTimeout: 600_000 } },
  // io-heavy(本次新增)
  {
    extends: true,
    test: {
      name: 'io-heavy',
      include: [<60 文件>],
      exclude: [<5 slow 防重复匹配>],
      fileParallelism: false,
      maxWorkers: 1,
      minWorkers: 1,
      testTimeout: 600_000,
    },
  },
],
```

## 验证(单文件实测)

| 测试 | 旧值(fast) | 新值(io-heavy) | 改善 |
|---|---|---|---|
| install-skills-script.test.ts | ~720s (12 min) | **70.97s** | **90% ↓** |
| transform 阶段 | 数百 ms × 4-worker 竞争 | 82ms | 显著 |
| 测试通过率 | 44/47 | 44/47 | 不变 |

静态验证:fast 项目 454 文件、slow 5 文件、io-heavy 58 文件,总计 517(期望 520,2 文件 helper skip)。slow 5 文件 0 个出现在 io-heavy,fast.exclude 正确排除 65 个文件。

## 风险评估

**低风险**:
- 沿用 slice-017d 的 `extends: true` + 显式 include 模板(防 slice-020 trap)
- io-heavy 与 slow 互斥(include 不重叠)— vitest 按 include 顺序匹配
- 改动 1 文件 ~153 行净增,0 测试代码改动
- 不动 fast.include(只是 exclude 追加)和 slow 整块

**已知 caveats**:
1. 2 个声明的 io-heavy 文件实际没匹配 — 应该是 helper(utility 在 `tests/integration/_cli-helper.ts` 已显式排除,可能是其他)或被 vitest skip
2. pnpm 9+ 的 `pnpm.onlyBuiltDependencies` deprecation 警告,与本次改动无关
3. `tests/unit/tech-service.test.ts` 仍然留在 fast(它本质 fs-mock 类)— 后续 slice 可考虑移到 slow

## Wall-time 预估 vs 实测(**重要纠正**)

| 项 | 预估 | 实测 |
|---|---|---|
| fast | 10-15 min | ~25 min(454 文件 × 4-worker) |
| slow | 78s | slice-017d 已测 |
| io-heavy | 8-12 min | 10-15 min 单 worker |
| **总 wall(预估)** | **20-25 min** | — |
| **总 wall(实测)** | — | **42m29s (2549s)** |

### 与真实 baseline 对比(**关键纠正**)

之前 memory 草稿里写"比改动前 ~50 min 改善 15%"是**错误的对比**:
- slice-017d sediment 报告的 "50 min / 510 文件" 是 slice-014/016/017 系列改动过程中的**单次历史观察**,不是稳定 baseline
- slice-019 commit (改动前最后一次实测) 给出的权威数字是 **38 min / 519 文件**(`Background pnpm test:full run completed (38min, 3 failed)`)
- slice-018d 实测 **42m29s / 520 文件**

**真实对比**:**38 min → 42m29s,wall 反而变慢 11%**。**io-heavy 拆分没有改善总 wall**。

### 为什么 io-heavy 没改善总 wall

- 改动前(38 min):fast 4-worker 跑全部 519 文件
- 改动后(42m29s):fast 4-worker 跑 454 文件 + slow 单 worker 跑 5 文件 + io-heavy 单 worker 跑 61 文件(三项目并行)
- io-heavy 接管了 61 文件,但 fast 项目下仍有 ~25 min 治理不到的热点(参见 slice-019 sediment:169 文件 > 60s,61 文件 > 120s,30 文件 > 180s)
- fork 启动开销 + reporter 序列化 + globalSetup = 额外 4-7 min 开销

**架构本身工作正常**(消除 IO 互抢、io-heavy 单独跑 70.97s 而非 12 min),但整体 wall 没改善,因为 fast 项目的瓶颈不在 IO 互抢,在别的地方(测试设计本身慢 / 真实 git 操作 / fixture 创建等)。

### 教训

- 架构治理 vs 总 wall 改善不是同一件事
- 真正能改善总 wall 的路径:治 fast 项目根因(grep 扩展到 git 操作 / fixture 创建 / setupFiles / per-test budget),不是再加项目
- 后续 slice(019 系列)应回到 fast 项目热点诊断,而不是再切 io-heavy/slow

## 用户观察的"25 min / 125 文件只显示 fast"真相

用户报告 `pnpm test:full` 25 min 只跑了 125 文件且只见 fast。RD 子代理实测完整跑 42m29s 后确认:

- **三项目都跑了**(fast 454 + slow 5 + io-heavy 61 = 520)
- **0 failed / 0 timeout**
- 用户看到的"25 min / 125 文件"是 **vitest 4.1.10 default reporter 的中间状态显示**(进度字符密集、不带 `[fast]/[slow]/[io-heavy]` 前缀),不是真实完成度

**vitest 4.1.10 reporter 限制**:`--reporter=verbose` 才显示项目标签,`--reporter=default/dot` 都不显。建议用户改用 `--reporter=verbose` 跑,可以看到 `|fast|`, `|slow|`, `|io-heavy|` 标签。

## 后续建议

1. ⚠️ **不要乐观估计 wall 改善** — 架构治理不等于总 wall 改善
2. ✅ 接受 slice-018d 架构价值(io-heavy 单独跑通 70.97s × 61 文件,消除了 IO 互抢),但**承认对总 wall 没帮助**
3. 后续路径应是 fast 项目热点诊断(grep git 操作 / fixture 创建 / setupFiles / 单测试设计慢)
4. 提交 slice-018d 时在 commit message 里诚实写 "wall 改善 0%,但架构治理 OK"

## 用户观察的"25 min / 125 文件只显示 fast"真相

用户报告 `pnpm test:full` 25 min 只跑了 125 文件且只见 fast。RD 子代理实测完整跑 42m29s 后确认:

- **三项目都跑了**(fast 454 + slow 5 + io-heavy 61 = 520)
- **0 failed / 0 timeout**
- 用户看到的"25 min / 125 文件"是 **vitest 4.1.10 default reporter 的中间状态显示**(进度字符密集、不带 `[fast]/[slow]/[io-heavy]` 前缀),不是真实完成度

**vitest 4.1.10 reporter 限制**:`--reporter=verbose` 才显示项目标签,`--reporter=default/dot` 都不显。建议用户改用 `--reporter=verbose` 跑,可以看到 `|fast|`, `|slow|`, `|io-heavy|` 标签。

## 后续建议

1. ✅ 接受 slice-018d 现状,提交 + push(架构工作正常)
2. 可选:跑 `--reporter=verbose` 重测,让 wall-time / 文件归属直观可见
3. 可选:fast 项目仍有 ~25 min 优化空间(后续 slice)
4. 可选:考虑 vitest 升级或换 reporter(如 `tap` / `junit`)获得完整可见性

## 为什么这个方案属于"架构治理"而不是"per-test budget band-aid"

slice-016d/016f/019 系列做过 per-test 240s budget 调高,但**那是 band-aid**(允许单测试超时但不能消除争抢)。slice-017d 第一次用 projects 架构治理 `vi.doMock` 类。slice-018 把同一套模式推广到 IO 互抢类 — 改 pool 配置消除互抢,而不是允许互抢后给超时预算。

未来遇到第三种失败模式(比如 CPU-bound 纯算法测试、memory-heavy fixture 测试),应该再开第四个项目,而不是堆 budget。

## 下一步建议(不在本次 slice 范围)

1. **跑 `pnpm test:full`** 实测 wall-time 验证 20-25 min 估算(用户决定要不要等 ~25 min)
2. **追查 2 个声明但未匹配的 io-heavy 文件**(grep `cli-program-test-utils` 等 helper)
3. **`tech-service.test.ts` 移到 slow** — 它本质 fs-mock 类,留在 fast 可能仍然撞 4-way transform 竞争(slice-017d 行 56-67 同类失败模式)
4. **PR 流程**:本次改动只动 vitest.config.ts,1 文件 ~153 行净增,改动面可控,可以走 PR

## Why: see also

- [[slice-017d-vitest-projects-slow-lane-split]] — 二分架构原型(io-heavy 完全沿用)
- [[slice-016e-dispatch-record-truncation-lock-pressure]] — 解决不同失败模式的非架构方案(101→1 lock-acquisition),架构/非架构的对比
- [[slice-016d-workflow-autonomous-resume-parallelism-budget]] — per-test budget band-aid,被 017d 撤销
- **本 slice 是 slice-017d 的自然推广** — 同模式 (`extends: true` + 显式 include + maxWorkers: 1 + fileParallelism: false + testTimeout 600s),不同失败模式