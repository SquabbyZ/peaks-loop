---
name: library-delegation-swaps-failure-modes
description: 委托给第三方库会换掉失败模式，不只是换掉 bug —— 必须为库的边界输入补测试
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff.md
---

为修自实现 matcher 的两条缺陷（扩展 glob 语法漏报 + 灾难性回溯），改用 `picomatch@4.0.4`（与 codegraph 上游同引擎同版本）。副作用：`picomatch('')` **抛错**（`Expected pattern to be a non-empty string`）。于是一条垃圾配置（`"exclude": [""]`）让**整个对账**抛错，消费者把这个 throw 降级成 `[WARN] codegraph exclude integrity not evaluated` 并把退出码留在 **0** —— 一个**新的静默假通过**，恰好出现在"消除静默假通过"的这个机制里。修复方式是新增 `isUnmatchableRule(pattern) => pattern.trim().length === 0` 守卫，在 `compileRules` 里过滤掉不可匹配规则、在 `matchesCodegraphGlob` 里直接返回 `false`（语义精确：空模式匹配不到任何东西，跳过它是 no-op）。注意 `picomatch('   ')` 不抛错，所以守卫必须用 `trim()`。

**Why:** 换实现换掉的是**整个失败模式集合**，不只是换掉你正在修的那个 bug。手写 matcher 的失败模式是"漏报 + 慢"，库的失败模式是"边界输入直接 throw"—— 两者都会退化成假通过，但触发条件完全不同，原有的测试一条都覆盖不到。

**How to apply:** 委托替换后，**专门为"库的边界输入"补一组测试**：空串、纯空白、超长、异常字符（`[` `(` `{` 未闭合）、平台路径分隔符。并在接缝处加一条"这个函数**永不抛出**"的构造性保证（catch 或前置守卫），因为调用方很可能已经用 `catch → warn` 把 throw 降级成了静默放行。
