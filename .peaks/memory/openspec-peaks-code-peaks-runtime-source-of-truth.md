---
name: openspec-peaks-code-peaks-runtime-source-of-truth
description: OpenSpec 解耦,peaks-code 收敛到 .peaks/_runtime source-of-truth
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/txt/handoff.md
---

peaks-code 与 OpenSpec 解耦(session 2026-07-08-session-17918f,2026-07-08)。
实施:删 SKILL.md Step 0.5 + references/openspec-workflow.md + 7 markdown trims,新增 openspec-decoupled.test.ts。
Why:peaks-code 11 步流程 source-of-truth 完全收敛到 `.peaks/_runtime/<sid>/<role>/`,LLM 只读这一处,降低 ceremony;OpenSpec 历史 spec 保留作为 storage。
How to apply:后续 peaks-code 表面不再调 openspec CLI,不再写 openspec/ 产物;OpenSpec 仅作历史 spec 存储。
Links:PRD-1 / RD-1 / QA-2。
