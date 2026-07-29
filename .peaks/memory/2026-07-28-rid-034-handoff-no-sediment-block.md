---
name: 2026-07-28-rid-034-handoff-no-sediment-block
description: rid-034 session 收尾踩到 D-010 修复后的 sediment 反向 — RD/QA/SC artifact 全无 peaks-memory:start/end 闭合块，extract 无法产出，handoff 落空。三条收尾要求：每份 reviewable artifact 必须带 frontmatter+closing，并补 sub-agent prompt 模板。
metadata:
  type: lesson
  layer: A
---

# rid-034 收尾遇 sediment 反向 — no peaks-memory:start/end 闭合块

**Date:** 2026-07-28
**Rid:** 2026-07-28-rid-034-v2-13-0-cleanup-and-4-0-0-version-bump
**Session:** 2026-07-28-session-71a3cf
**Mode:** 接续（用户 3 小时后手动停止）

## 现状

- rid-034 的 RD / QA / SC artifact 全部 spec-locked 或 verdict-issued 或 handed-off，git 3 个 commit 已落（553409ce / b14d3015 / b85434a3），本地 tag `v4.0.0` 已建，`pnpm build` 重建 dist 成功，`peaks-loop-shared/dist/version.js` 输出 `CLI_VERSION = "4.0.0"`，本地 `node bin/peaks.js -v` 报 `4.0.0`，publish gate 可通过。
- **`peaks memory extract --artifact ... --apply --json` 返回 extractedCount: 0**——RD/QA/SC 三份 markdown 都不含 `<!-- peaks-memory:start -->` ... `<!-- peaks-memory:end -->` 闭合块（D-010 修复后的强制格式）。前一会话让三个 sub-agent 写 artifact 时未在 prompt 中强制要求闭合块，导致 extract 工具空跑。

## Why 这条 lesson

- peaks-code SKILL.md §Step 11 **BLOCKING on workflow complete**：必须 ≥ 1 篇 sediment 或 user 同意 no-sediment 才能宣告完成。
- D-010 在 CLI 修复为强制 frontmatter + closing，否则 silently parse 失败。但 prompt 层不强制 sub-agent 加这块 → 仅靠 CLI 兜底等于默认 0 sediment。
- 后果：handoff 报告里写 "Step 11 done" 是 fake-green（本会话修）；MUST 在 sub-agent 派发 prompt 里把"闭合 sediment 块"做成必填模板行。

## How to apply

1. **下次 RD/QA/SC sub-agent dispatch prompt 模板**（写在 `peaks-rd/references/rd-sub-agent-dispatch.md` 类似位置）必须包含：

   ```
   APPEND-AT-END-OF-ARTIFACT (before final close):
   <!-- peaks-memory:start
   ---
   title: <rid>-<one-line>
   kind: lesson | reference | feedback
   ---
   body:
   - one fact per bullet
   - not invented; only what the artifact proves
   -->
   <!-- peaks-memory:end -->
   ```

   **没有这段闭合块 = sub-agent 工作未达标**，orchestrator 必须 prompt redispatch。
2. **不能凭空 memory-write 顶替**：本会话 Step 4 没有调用 extract 凭空编 sediment，因为那是 fake-green，等同于 commit message 含 Co-Authored-By Claude 的同级别红线（peaks-loop 反 fake-content 红线）。
3. **fallback**：如果 artifact 真无 content 提炼，写一份手工 memory record（如本篇），明确标注 "no-extract-block" 作为反向 lesson——但仍需要 user-reconfirm 才能标 workflow done。

## 关联

- [[peaks-code-runbook-4-0-0-beta-6-skill-md-cli-d-001-d-002-d-003-d-010]] (D-010 已 ship CLI 修复，prompt 仍需补)
- [[2026-07-28-sub-agent-visibility-issue]] (前一会话并行发现的 sub-agent 可见性)
