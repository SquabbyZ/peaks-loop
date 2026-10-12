---
name: mut-report-rd-qa-handoff
description: MUT_REPORT 是 rd:qa-handoff 的硬前置，但在本构建里产不出，且跳过时静默
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

证据链：`src/services/artifacts/artifact-prerequisites.ts:201`（`MUT_REPORT` 要字面
`"passed": true`）→ `src/cli/commands/mut-commands.ts:51/104/147`（三个子命令都要 `--input-sig`）
→ `src/skills/peaks-mut/SKILL.md:132`（说要 `peaks tact read`）→ **该命令不存在**
（`node bin/peaks.js tact --help` 落根帮助；`peaks --help` 的命令表无 `tact`/`strat`/`rd`）。

**实测的反直觉那半**：缺这份文件时 `rd → qa-handoff` 返回 **`ok: true`、`warnings: []`、exit 0** ——
表里写着硬前置，跳过时却一声不响。对照实验证明闸门机器本身活着（挪走 `qa/test-cases/<rid>.md`
⇒ `PREREQUISITES_MISSING`、exit 1）。

**推论**：读转换输出的人会以为 9 条前置全过。这是「静默缺口」发生在闸门自己身上的实例。
**不许**用伪造 `"passed": true` 绕——那正是本仓一直在消灭的 pass-shaped output。
