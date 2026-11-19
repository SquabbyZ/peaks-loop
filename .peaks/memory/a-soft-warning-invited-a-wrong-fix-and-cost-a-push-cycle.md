---
name: a-soft-warning-invited-a-wrong-fix-and-cost-a-push-cycle
description: a-soft-warning-invited-a-wrong-fix-and-cost-a-push-cycle
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-11-19-session-dc4ec6/txt/handoff.md
---

锁文件里加一条 back-compat 接受记录来"消掉"警告，代价是一个完整的 push 周期，而且它
推翻的是一个刻意的退休决定。判定顺序应当反过来：先看 `peaks workflow verify-pipeline
--rid <rid> --json` 的 `complete` 和退出码，再决定要不要动任何 tracked 文件。
警告文本是通用的机制描述（"ask the LLM to add an entry"），不是对本次运行的判决。
在改 `.peaks/lint/backcompat-expired-acceptance.json` 之前，先 grep
`src/services/artifacts/**` 和 `tests/unit/services/artifacts/**`——若某个测试钉住了这份
清单、或某段注释解释了某窗口为何**不**被接受，那就是一个决定，重新加回去等于用一句
听起来合理的话推翻别人的推理。编造的理由比不加更糟。
