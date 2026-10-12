---
name: markdown-is-the-wrong-carrier
description: markdown-is-the-wrong-carrier —— 用自由文本存受守卫的状态标记，五轮都能被拼写变体绕过
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

**五轮实测的逃逸拼写**（每轮都是**当轮守卫看不到**的那种）：
字符序列层面的多样性不是 bug，是**自由文本的固有属性**。

守卫只能按**某个模式**认出「标记」。**任何人类会读成相位声明、但不匹配该模式的拼写，对守卫都不可见**
—— 所以这一族**在原理上不可穷尽**，加规则只是把守卫写得更长（本次已到 **495/500 行**的上限）。

**信号**：五轮里**没有一轮是最后一次**（每轮审计都找到新的拼写变体）。

**修法**：把相位搬到有语法的载体 —— 例如 `.peaks/race/lane-phase.json`，
`{ "phase": "name-only" }`，用 schema 校验（`enum` 两值、`required`、`additionalProperties: false`、
缺失即拒）。**「恰好一个合法值」于是成为解析器保证，而不是靠守卫的拼写规则逼近。**
`SKILL.md` 的散文表**从它生成**（或不写相位、只说以该文件为准）⇒ 没有第二份可漂移的文本，
守卫可缩回几十行。

**推广**：任何「受守卫的枚举状态」都不该以自由文本为权威载体 —— 包括散落在 SKILL.md / README /
注释里的开关。**文本可以描述状态，不该是状态的存储。**
