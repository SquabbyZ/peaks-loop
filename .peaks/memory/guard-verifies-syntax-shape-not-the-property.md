---
name: guard-verifies-syntax-shape-not-the-property
description: guard-verifies-syntax-shape-not-the-property
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff-4-0-45.md
---

反回归守卫 Guard C 初版按**行首 `function\s+name`** 切分源码，不匹配该形状的顶层代码**完全不扫描**；代码块只在「整行恰好是 `}`」时结束，模板字面量里位于列 0 的 `}` 会提前闭合它，其后的全部内容漏扫。实测 **8 种等价写法全部放行**：`const` 箭头函数、`function*`、`export default function`、类方法、拆变量、`==`、`item['status']`、字符串拼接。端到端验证：在顶层箭头函数里放 2 个代理字面量，守卫仍报 `3 passed EXIT=0`；而等价的普通 `function` 写法放同样内容会 `1 failed`。

**Why:** 一个能放行 8/8 绕过的守卫**比没有守卫更糟** —— 它把「没人在看」伪装成「有东西在看」，是虚假保证。更尖锐的是：这个守卫**本身就是它要防的那个形状的第 7 个实例**（验的是代码的外形而非其性质）。

**How to apply:** 反回归守卫不要按**语法形状**切分源码文本。用真解析器（本仓库已有 `typescript` 依赖）读**函数体内的 token** —— 「某个字面量在不在函数体里」与它外面包着什么语法无关。同时**必须显式写出它的边界**（哪些改写仍不挡），把边界做成一条**通过的**测试，而不是让读者默认它全覆盖。
