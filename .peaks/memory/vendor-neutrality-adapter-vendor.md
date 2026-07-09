---
name: vendor-neutrality-adapter-vendor
description: Vendor-neutrality 通过 adapter 抽象守住,新 vendor 接入零核心改动
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/txt/handoff.md
---

session 2026-07-08-session-17918f 新增 `peaks runtime / adapter` 两组 CLI verb。
机制:`peaks <aspect> <verb> --via <id>` 是统一入口;`src/services/code/` 0 vendor 动词(实测 AC-1 exit=1);新 vendor 接入 = 新 adapter 文件 + register,不需改核心。
Why:与 Enhancement-not-new-CLI 元规则对齐;vendor-neutrality binding;未来 desktop client / 新 vendor CLI 接入零核心改动。
How to apply:任何 vendor-specific 行为走 adapter 层;遗留 4 文件(`session-auto-compact-hook-command` / `auto-compact-dispatcher` / `auto-compact-hook-install` / `ide/adapters/claude-code-adapter`)硬编码 `claude --compact` 属 S3-cleanup。
Links:PRD-2 / RD-2 / QA-2 / S-1..S-4 security findings。
