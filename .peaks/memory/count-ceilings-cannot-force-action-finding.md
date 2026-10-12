---
name: count-ceilings-cannot-force-action-finding
description: count-ceilings-cannot-force-action —— 计数型棘轮结构上无法让单条 finding 迫使行动
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

实测（2026-10-12）：`@typescript-eslint/no-var-requires` 在
`config/eslint/.peaks-rules.cjs` 里**不存在**（v8 改名了）；生效的是 `no-require-imports`（error），
它**一直在**那 16 处上报，包括 4 处**写了 disable 但 disable 指向另一个（不存在的）规则**的地方。
因此 16 条落进 `eslintFindings: 1758` 这个**计数上限**里，等于零。

**通用命题**：一个「finding 数量」的上限，意味着**任何单条 finding 都无法迫使行动** —— 只要总量不涨，
一条写着「你的代码会在运行时抛 `require is not defined`」的 finding 可以无限期地待在计数里。
**注意方向**：计数棘轮防的是「变差」，防不了「一直差」。

**同族**：`peaks memory extract` 报 count 5 却只写 4 个文件（S-6）—— 都是**用聚合数字掩盖个体事实**。

**推论**：对于「一条就等于一类 bug」的 finding，需要的是**具名豁免表**（有名字、有理由、可审阅），
而不是**数量上限**。豁免表会随着每一条被移除而缩小，计数上限不会。
