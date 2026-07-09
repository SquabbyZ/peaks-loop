---
name: peaks-loop-install-model-getstrongestmodelid-fallback
description: peaks-loop install 不再写死默认 model,改运行时探测(getStrongestModelId 三层 fallback)
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/txt/handoff-003-add-zcode-adapter.md
---

session 2026-07-08-session-17918f Slice A 删除 `model: 'sonnet'` + `providers.minimax.model` install 默认值 + `STRONGEST_MODEL_ID` 常量,新增 `getStrongestModelId(config)` 函数。
机制:三层 fallback = config.model → `PEAKS_STRONGEST_MODEL_DEFAULT` env var → back-compat `'claude-opus-4-7'`(legacy 兼容)。
Why:1.x 时代 install 写默认值是给 user 兜底,2.x user 跑在不同 AI CLI(z-code / Claude Code / Cursor / Trae),install 不知道 user 在哪,默认值必然猜错。z-code 用户实测看到的"推荐 sonnet"是 UX bug,本次修复。
How to apply:未来 install 只写必要 config,model 字段留空,user 首次 `peaks config set model <id>` 时自己填。Slice C(可选)新增 `peaks ide model --current` 运行时探测,替换 back-compat fallback。
