---
name: partial-delivery-makes-delivery-verdict-arguable
description: partial-delivery-makes-delivery-verdict-arguable
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff-4-0-45.md
---

同一个缺陷形状连出现 7 次，每次只换一层判据：`status === 'computed'`（磁盘上有文件，但内容被截断）→ `status === 'found'`（≥1 字节就算送到）→ `totalBytes === 0`（把 missing 与 empty 混为一谈）。根因不是某一个判据写错，而是**一个源允许被"部分内联"**：总量预算把它从中间截断。

**Why:** 只要「部分送达」这个状态存在，任何以**字节数 > 0 / 状态码 / 存在性**为代理的判据都能找到立足点，于是每一轮修复都成立、审核却总能在邻近代码找到同一个形状。「状态仍然存在」的前提下，修判据只是把洞挪个位置。

**How to apply:** 当同一类缺陷连续多轮在邻近代码重现时，**停止修判据，去找产生它的那个状态并消灭它**。本例的解法是 per-source **全有或全无**（整份送达，或整份 omitted，不存在中间态），并把判定收敛到**唯一一处**，由每个源**声明**自己的送达规则。
