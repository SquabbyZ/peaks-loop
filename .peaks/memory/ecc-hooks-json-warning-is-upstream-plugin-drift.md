---
name: ecc-hooks-json-warning-is-upstream-plugin-drift
description: ECC 启动告警（hooks.json unknown keys）是上游插件键位漂移，非 peaks-loop；已本地消音，会被 plugin update 覆盖
metadata:
  type: project
  node_type: memory
  originSessionId: cba36372-fa93-4b11-86c2-d29b1d3edba9
  modified: 2026-09-12T00:16:54.586Z
---

Claude Code 启动打印的 `ecc: hooks.json: unknown keys "$schema", "description" in hooks.PreToolUse[0], "id" ... and 42 more ignored`，**根因在第三方 ECC 插件自己的文件**，不是 peaks-loop。

**来源**：`~/.claude/plugins/cache/ecc/ecc/<version>/hooks/hooks.json`。Claude Code 插件 hook schema 在 matcher 组上只收 `{matcher, hooks}`、顶层只收 `hooks`(+ 可选顶层 `description`)；ECC 在 23 个 matcher 组上各挂了 `description` + `id`，顶层还有 `$schema` → **47 个**被忽略的键，与告警的"5 显式 + 42 more"逐项吻合。

**2026-09-12 已消音**(用户选择了本地消音，未报上游)：cache + marketplace 两份 hooks.json 剥掉 47 键，元数据移入 `hooks-registry.json`，原件备份 `hooks.json.orig-<ts>`。逐字节校验：23 条 hook 命令与改前完全一致，行为零变化。

⚠️ **会被覆盖**：`claude plugin update` 或换 ECC 版本后告警复发，需重打。用户说"等 ECC 更新就行" —— 但实测上游 v2.2.0 / v2.2.1 / main 三个 ref 键位**完全相同**，且 ECC 自己的 `scripts/ci/validate-hooks.js` 只验形状、从不验键白名单，`schemas/hooks.schema.json` 的 `matcherEntry` 没开 `additionalProperties: false` → **它的 CI 结构上发现不了，不报就不会被修**。所以"等更新"大概率等不到。

**两个判据容易记反（本次差点写成 bug）**：顶层 `description` **合法**（官方文档原句 "an optional top-level `description` field"）；matcher 组级 `description` **非法**。

**Why**：用户会把它和 peaks-loop 4.0.40–4.0.42 的修复混为一谈 —— 那三版改的是 peaks 自己的 `write-gate.js` 误报 + 20 个 SKILL.md 的闸门措辞。两者都涉及"ECC 闸门"，但文件、仓库、机制无关。判定所有权看路径：peaks-loop 的 ECC 缓存 `~/.peaks/cache/ecc-*/` **只有 `agents/`，没有 `hooks/`**。

**How to apply**：告警复发时直接照本条重打，判据与备份流程都已验证。相关：[[upgrading-the-package-does-not-refresh-generated-settings]] · [[ecc-fact-force-gate-is-first-touch-not-read]]
