---
name: env-flag-truthiness-false-no-off
description: env-flag-truthiness —— 布尔型环境开关把 false/no/off 读成「开」
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

**实测**（2026-10-12，安全审计发现、我复现）：

```
PEAKS_ALLOW_STAGED_DIVERGENCE=1      -> 豁免（正确）
PEAKS_ALLOW_STAGED_DIVERGENCE=false  -> 也豁免（错！）
PEAKS_ALLOW_STAGED_DIVERGENCE=no     -> 也豁免（错！）
PEAKS_ALLOW_STAGED_DIVERGENCE=off    -> 也豁免（错！）
PEAKS_ALLOW_STAGED_DIVERGENCE=0      -> 不豁免
PEAKS_ALLOW_STAGED_DIVERGENCE=""     -> 不豁免
```

**形状**：`if (process.env.X)` —— 任何非空字符串都为真，包括 `"false"`、`"no"`、`"off"`。
写的人**以为关掉了，实际打开了**。这是**一个读起来是「关」、行为是「开」的开关**，
而且它出现在**一处本该最显眼的地方：一道门的豁免**。

**正解**：**只接受文档写明的那个值**（本仓的惯例是 `=1`，如 `PEAKS_FULL_TEST=1`），
**其余一律按「不豁免」处理** —— 失败方向指向**更严**（门照跑），而不是更松。

**判据（推广到一切 env 开关）**：写完 `if (process.env.X)` 就问一句
「**写 `X=false` 的人会得到什么？**」如果答案是「和写 `X=1` 一样」，那就是这个 bug。
对**豁免类**开关尤其致命：它的失败方向必须是「不豁免」。
