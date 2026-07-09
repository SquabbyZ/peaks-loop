---
name: z-code-peaks-loop-9-ide-adapter-vendor-neutrality-adapter
description: z-code 是 peaks-loop 第 9 个 IDE adapter,vendor-neutrality 通过 adapter 抽象守住
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/txt/handoff-003-add-zcode-adapter.md
---

session 2026-07-08-session-17918f 新增 zcode-adapter(`src/services/ide/adapters/zcode-adapter.ts`,98 行),peaks-loop 首次支持 z-code 桌面应用。
机制:沿用 claude-code-adapter.ts 模板,compact/hook/toolMatcher 字段降级(z-code 非 CLI binary),standardsProfile 借用 `.claude/rules` + `CLAUDE.md`(z-code 桌面应用自身设计);新增 env var `PEAKS_ZCODE_SKILLS_DIR`。
验证:9/9 verify-pipeline gate PASS,vitest 跨 13 IDE files / 192 tests / 0 failed。
未来接入新 IDE 严格走 PRD → RD → slice → SC → QA → sediment;adapter 文件允许自家 vendor 名,不允许 cross-vendor 假设。
