---
name: stale-check-results
description: stale-check-results —— 已报出的检查会被后续改动悄悄作废，而无人要求重跑
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

三个实例，同一形态：**先报出一个结果，之后又改动了它描述的东西，而没有任何东西提醒你重跑。**

1. **审计**：安全审计报 1 条 HIGH；修复轮把它修掉了；**没人重跑审计** ⇒ `audit/security-<rid>.md`
   至今把那条 HIGH 记作 open。由 `prepare-final-review` 的四维审查者**交叉比对时间戳**抓出
   （它注意到「那条 HIGH 声称不存在的检查，恰在同一 diff 里被列为新增导出」）。
2. **BDD 校验**：上一轮报 `{"ok":true,"scanned":14}`；那描述的是**修复前**的文件；折行是修复轮带来的；
   **检查没重跑**。由 QA 抓出（它按自己角色的强制检查判定 `return-to-rd`）。
3. **作者自己**：`cmd | tail; echo $?` 报的是 `tail` 的状态（本会话犯了**三次**）；
   `Object.keys(new Map())` 是 `[]`、`JSON.stringify(new Map())` 是 `{}`（把 Map 当普通对象读）。

**推论（写进待办）**：**报出任何检查结果之前，在最终那棵树上重跑它。** 若一次编辑晚于某个检查的
运行，那个检查的结果就只是历史。这一条对本仓尤其要命，因为大量证据是「一次跑出来的 json 文件」，
而且它们与代码分属不同的提交节奏。
