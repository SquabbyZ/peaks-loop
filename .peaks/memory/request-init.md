---
name: request-init
description: 契约的角色提示会让 request init 出来的状态载体永远是未填模板
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

`peaks request init --role rd --apply` 产出的是**骨架**（rd 55 行 6 个 `<placeholder>`、qa 52 行 2 个）。
而 `skills/peaks-code/references/swarm-dispatch-contract.md` §3.3/§3.4 的角色提示里
**没有一句**说要回填它 ⇒ `rd → implemented` 必然 `LINT_GATE_FAILED`（6 条全是占位符行）。

**修法二选一**：① 提示里补一句「回填 `requests/<id>.md`，把占位符换成真实内容」；
② 让 `init` 的骨架**不含**会被 lint 判死的占位符（那样 lint 就只剩「确实没填」这一种红法）。

本次处置：派一次**簿记**代理回填（内容全部来自既有 artifact，不做新判断），
**不用 `--allow-incomplete`** —— 不该由我这边把绕过先例化。
