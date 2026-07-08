---
name: peaks-code-to-peaks-code-rename-session-directive
description: 2026-07-05 user 在 peaks-code → peaks-code rename brainstorm 末尾追加的硬约束,适用于所有 peaks-loop 长任务
metadata:
  type: feedback
  createdAt: 2026-07-05
  source: brainstorm session for `docs/superpowers/specs/2026-07-05-peaks-code-to-peaks-code-rename-design.md`
---
<!-- peaks-feedback-promoted: layer=A -->

# peaks-code → peaks-code rename 时的 user 硬约束(2026-07-05)

> **Why:** user 在 4.x sediment release 出版后提出把 peaks-code 更名为 peaks-code。在 brainstorm 末尾追加了三条硬约束,这三条对**所有** peaks-loop 长任务都适用,不是单次。

## 三条硬约束

1. **一次到位**:不分批、不灰度、不留半步状态。
2. **不计成本**:不为减少工作量妥协任何决策(不为省事留 alias、不为省事仅改 description、不为省事只改主技能不动 sub-skill)。
3. **不计时间**:可以拆多个 sub-task 派多个 sub-agent 并行,每个 sub-agent 完成前不进下一步。
4. **禁止假绿**:任何 sub-agent 自报"完成"必须附证据(dogfood 命令实际输出、vitest 实际 pass 数、rg 实际输出)。LLM 不允许"应该是绿了" / "理论上通过" / "skip 了无关的 case"——只允许"跑了 X,绿了 N/N,下面是原始输出"。
5. **禁止偷懒**:不允许为了"完成数量"跳过任何位置,除非 spec 明示不动。
6. **存量 session.json 迁移也是 LLM 做**:user 原话"5.5 也你来吧"。**LLM 不要把任何 .peaks/_runtime/** 的迁移推给 user 手动 sed**,而要写一个 LLM 跑的 primitive(本次 = `peaks session migrate-skill-name`)。

**How to apply:**
- 接到任何 peaks-loop 长任务(尤其是 ≥ 2 步、有 ≥ 2 处改动的),在 spec 起手阶段就把这 6 条作为硬约束写进 §0 / Hard Constraints 段。
- 写任何 sub-agent dispatch prompt 时,在末尾追加"evidence required:实际命令输出 + 实际 pass 数",而不是"完成后通知"。
- **不向 user 索要 CLI 字符串 / JSON / 表项填法**——user 角色 = 业务/产品审阅者,详见 [[peaks-loop-24h-ai-programmer-positioning]]。

**Related designs / memory:**
- `docs/superpowers/specs/2026-07-05-peaks-code-to-peaks-code-rename-design.md` §0(本条的权威出处)
- [[peaks-loop-24h-ai-programmer-positioning]]
