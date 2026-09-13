---
name: piping-a-test-run-reports-the-pipes-exit-code
description: "`vitest … | tail` 报出的退出码属于 tail，不属于 vitest；据此宣称\"全绿\"会漏掉未处理错误"
metadata:
  type: feedback
  node_type: memory
  originSessionId: bd89a11a-b66d-443c-b8b7-e9aa813190c2
  modified: 2026-09-13T05:37:35.690Z
---

**把测试命令管进 `| tail`（或任何管道/分页器）之后，你读到的 `$?` 是那个**管道的**退出码，不是测试运行器的。**

2026-09-13 实测（peaks-loop）：跑了全量集成套件

```
node ./node_modules/vitest/vitest.mjs run --config vitest.config.integration.ts --maxWorkers=2 tests/integration | tail -40
```

输出尾部是 `88 passed | 2 skipped` / `0 failed`，退出码 `0`。**我据此宣布"套件全绿"。**

而真实的 vitest 退出码是 **1** —— 因为有一条**未处理错误**（异步 detached `spawn('claude')` → `ENOENT`，发生在任何测试的 promise 链**之外**）。逐文件复核：

```
tests/integration/runtime/spawn-detached.test.ts       → 退出码 1   （测试全过，进程仍失败）
tests/integration/memory-fs-roundtrip.test.ts          → 退出码 0
```

**Why:** 未处理错误**不产生测试级失败**，所以"测试数 0 failed"与"进程退出 0"是**两个不同的断言**，而管道把第二个替换成了无关进程的结果。结果是一句**听起来有据、实际没验过**的结论 —— 正是这场会话一直在清除的"看起来绿、实际什么都没验"的形状，而这次是我自己制造的。CI 随后以**没有测试级 annotation 的 exit 1** 红在那里，形状完全一致。

**How to apply:**
1. **取退出码时不要管道**；必须管道时读 `${PIPESTATUS[0]}`（bash）或显式分两步。**并在报告里说明你用的是哪种。**
2. **"测试全过"不等于"运行成功"。** 报绿之前，**同时**确认测试计数与**进程退出码**。
3. 见到**没有失败测试、但退出码非零**时，先找**未处理错误**（异步/分离的 spawn、未捕获的 Promise、`afterAll` 里抛的），而不是重跑。
4. 与本仓库 CI 的可观测性有关：`--reporter=github-actions` 会把**测试失败**变成 annotation（无需 admin 权限即可读），但**未处理错误不产生 annotation** —— 所以 CI 上"无 annotation + exit 1"就是这个形状。

参见 [[a-probe-that-always-says-caught-is-indistinguishable-from-a-working-guard]]（同族：你读到的信号不是你以为的信号）与 [[single-observation-is-not-a-property]]。
