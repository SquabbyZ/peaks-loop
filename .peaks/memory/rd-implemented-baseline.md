---
name: rd-implemented-baseline
description: rd → implemented 的文件尺寸闸与 baseline 棘轮互相矛盾
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

实测（2026-10-12，`src/services/artifacts/request-artifact-state-helpers.ts:107` 的
`FILE_SIZE_VIOLATION`）：

- 闸门点名 5 个文件（461 / 459 / 750 / 540 / 672 行，cap 300）；
- 这 5 个**在 HEAD 上就全部超限**，且其中 **4 个在本次改动下变小了**（−1 / −1 / −4 / −1），
  只有 1 个 +2（一行注释）；
- 而 `.peaks/lint/gate-baseline.json` 的 `ceilings.fileSizeOverCap = 78` —— **超限文件是被棘轮接受的量**。

⇒ 两条闸门对同一事实给出相反裁决：**baseline 说「78 个超限是可接受的状态」，
转换闸说「你碰了其中一个，就得拆掉它」。** 后果是任何「修大文件里的 bug」的 slice
**过不了 `implemented`**，除非先做一次与本次 bug 无关的大重构。

**本次处置**：`--allow-incomplete --reason`（理由写进 artifact）。**与先前拒绝它的场合不同**：
那次存在范围内的正解（把状态载体填好），这次的正解被 PRD 的 Non-goals 明确排除。

**同批发现（S-14）**：顺序**不被强制** —— `implemented` 与 `qa-handoff` 被拒时，
`handed-off` **照样通过**。所以一个 slice 可以跳过中间态直接交付。
