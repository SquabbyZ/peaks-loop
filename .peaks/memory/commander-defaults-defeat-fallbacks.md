---
name: commander-defaults-defeat-fallbacks
description: "commander 的 option 默认值会让 opts.x 永远有值，顶掉下游 `x ?? fallback`"
metadata:
  type: project
  node_type: memory
  originSessionId: 29601951-8e04-4525-8107-125180abe7b4
  modified: 2026-09-11T13:57:22.934Z
---

**commander 的第三个参数是默认值。** 一旦声明，`opts.<name>` **永远不是 `undefined`** ——
于是下游任何 `opts.x ?? <回退>` 的 `<回退>` **永远不执行**。这不是"默认值"，是**悄悄删掉一条分支**。

**2026-09-11 真实事故（`317906b6`）：**

```ts
.option('--mode <mode>', '... Default: standard. 24h mode auto-selects partial.', 'standard')
//                                                                              ^^^^^^^^^^
//  于是 opts.mode 恒为 'standard'，而 orchestrator 里：
const mode = input.mode ?? resolveAutoCompactMode(projectRoot);   // 左边永远命中
```

**结果：24h → partial 这条路径从投产起从没执行过。** 每个 24h 会话都按 standard 的
0.80/0.85 跑，却在 help 里写着 0.65/0.70。表面症状是"两个命令报的 mode 不一致"，
根因是**默认值顶掉回退**。

**修的时候要改两处**：只删声明里的默认值不够 —— handler 若写
`const modeName = opts.mode ?? 'standard'` 再 `mode: modeName`，仍然把 `'standard'` 显式传下去。
必须把**标志本身**透传（`opts.mode === undefined ? undefined : modeName`）。

**判别法：先找下游有没有 `?? 回退`。有，就绝不能在这个 option 上声明默认值。**

**同形状但无害的（8 处，别误改）：** `'--project <path>', '...', process.cwd())`。它冗余
（handler 也写 `?? process.cwd()`），但**没坏**，因为 handler 的
`resolveCanonicalProjectRoot(...)` 在下游照常把 cwd 提升到 git root。

**守卫：** `tests/unit/cli/command-option-invariants.test.ts` —— 断言 `code auto-compact` 的
`--mode` **不带默认值**。`option.defaultValue` 是真信号（程序里 125 个选项带默认值）。

相关：[[per-turn-obligations-belong-in-per-turn-output]]
