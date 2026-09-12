---
name: ecc-hooks-json-peaks-loop
description: ECC 启动告警是上游插件的 hooks.json 键位漂移，不是 peaks-loop 的闸门
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-12-session-86f23b/txt/handoff.md
---

**现象**：Claude Code 启动打印
`ecc: hooks.json: unknown keys "$schema", "description" in hooks.PreToolUse[0], "id" in
hooks.PreToolUse[0] ... and 42 more ignored`。

**根因（2026-09-12 实证）**：来源是第三方 ECC 插件
`~/.claude/plugins/cache/ecc/ecc/<version>/hooks/hooks.json`。Claude Code 的插件
hook schema 在 matcher 组上只接受 `{matcher, hooks}`、顶层只接受 `hooks`（+ 可选
顶层 `description`）；ECC 在 23 个 matcher 组上各挂了 `description` + `id`，顶层还有
`$schema` → 47 个被忽略的键，与告警数字逐项吻合（5 显式列出 + 42 more）。

**Why 容易误判**：用户会把它和 peaks-loop 4.0.40–4.0.42 的修复混为一谈（那三版改的是
peaks 自己的 `write-gate.js` 误报 + 20 个 SKILL.md 的闸门措辞）。两者都涉及"ECC 闸门"，
但文件、仓库、机制完全不同。

**How to apply**：
- 判定所有权看路径：`~/.claude/plugins/**` 是 IDE/插件领地；peaks-loop 的 ECC 缓存
  `~/.peaks/cache/ecc-*/` **只有 `agents/`，没有 `hooks/`** —— 所以 peaks-loop 不可能
  产生这个文件（另有项目级规则：peaks 产物永不写 `~/.claude/`）。
- 升级无用：实测 v2.2.0 / v2.2.1 / main 三个 ref 键位完全相同。且 ECC 自身
  `scripts/ci/validate-hooks.js` 只验形状、从不验键白名单，`schemas/hooks.schema.json`
  的 `matcherEntry` 没开 `additionalProperties: false` → 它的 CI 结构上发现不了，**不报就不会被修**。
- 消音是"消除"不是"治愈"：`claude plugin update` 覆盖后会复发，需重打。
- 关键判据：**顶层 `description` 合法**（官方文档明写 "an optional top-level
  `description` field"）；**matcher 组级 `description` 非法**。写检测逻辑时别把这两者
  搞反，否则会把唯一正确的上游修法误报成病症。
