---
name: enumerate-by-artifact-not-by-filename
description: enumerate-by-artifact-not-by-filename —— 用命名约定枚举自己的输入，两个方向都会错
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

实测（2026-10-12，`.husky/pipeline/contract-verdict.mjs`）：

| session | 前缀规则 | 产物规则 |
|---|---|---|
| 2026-10-11 | 8（4 个是 `-dispatch-prompt` / `-verification` 转储） | **4** |
| 2026-10-10 | **0**（33 个 request 叫 `001-<slug>.md` / `2026-10-10-*`） | **18** |
| 2026-10-09 | 14 | 14 |

**两种错法的后果不对称，而假阳性那条更危险**：一个**满足不了的门**会训练人用 `--no-verify`
绕过 —— 那等于把门整个关掉，比没有门更糟（有门的名声、无门的实效）。
**假阴性**则相反：它**静默放行**，你永远不知道自己被放过了。

**判据**：任何「按文件名/目录名判断这是不是我该管的东西」的检查，都要同时问两个方向 ——
**它会不会把不是的算成是（⇒ 无法满足）· 会不会把是的算漏（⇒ 静默通过）**。
正解是**按产物本身**（用产出它的那个服务/解析器），不是按约定。
