---
name: desktop-application-ide-adapter-z-code-cli
description: desktop-application 类 IDE adapter 字段降级决策(z-code 非 CLI)
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/txt/handoff-003-add-zcode-adapter.md
---

session 2026-07-08-session-17918f zcode-adapter 关键设计:z-code 是 VS Code-style 桌面应用,无 binary CLI。
机制:`compact.compactCommand` 留 undefined(z-code 无 `--compact` 命令);`hookEvent`/`toolMatcher`/`envVar` 必填字段用 UNVERIFIED 占位字符串(`PreToolUse`/`Bash`/`ZCODE_PROJECT_DIR`,Anthropic-compatible 协议猜测);adapter 启动时 `console.warn` 提示 user 走 GUI;`standardsProfile` 可借用现有 vendor 路径(z-code 借 `.claude/`)。
教训:不能凭空编 vendor 命令(如 `zcode --compact`),否则 100% ENOENT 失败 + 违反 vendor-neutrality。
治理:D-009b 提议 `IdeAdapter` interface 把 `hookEvent`/`toolMatcher`/`envVar` 改成 optional,或加 `unverified: boolean` flag,避免每个新 adapter 都得用占位字符串 + doc-comment 解释。
