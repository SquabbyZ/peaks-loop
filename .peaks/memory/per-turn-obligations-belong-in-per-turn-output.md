---
name: per-turn-obligations-belong-in-per-turn-output
description: 写进 SKILL.md 正文的每轮义务会被 compact 掉而失效；要挂在每轮必调的 tool 输出里
metadata:
  type: project
  node_type: memory
  originSessionId: 29601951-8e04-4525-8107-125180abe7b4
  modified: 2026-09-11T12:57:34.598Z
---

**2026-09-11 实证的教训。** `peaks-code/SKILL.md:162-187` 早就有完整的 zero-pause
contract，`:180` 甚至点名禁止"prompt the user to run `/compact`"。**而这个会话里它被执行
者（我）违反了** —— 我建议用户手动 `/compact`。

**根因不是规则没写，是规则写错了地方：** SKILL.md 正文在技能加载时读入一次，之后会被
compact 掉；于是规则恰好在"上下文压力大到需要它"的那一刻失效。契约也只覆盖了 22 个技能
中的 1 个。

**采取的做法：** 把每轮义务挂到**每轮必调的 tool 输出**上 —— `peaks skill presence --json`
的返回值里带 `context: { ratioPct, action, mode }` 裁决。tool 输出每轮重新产生，compact
不掉，且技能无关（新技能自动覆盖）。SKILL.md 只留一个薄块指向它，并用漂移测试压住 22 份
逐字节一致。

**推广：** 任何"每一轮都必须做"的义务（状态头、自执行 compact、read-before-edit），
载体应该是**每轮的 tool 输出**，不是只在加载时读一次的 prose。prose 适合放"怎么做"，
不适合放"别忘了做"。

相关：[[peaks-loop-consumer-project-gaps]]
