---
name: 2026-08-11-peaks-code-skill-persistence-pause
description: 记录 peaks-code 被 superpowers 自动抢占/清除问题的根因与明日续做入口
metadata:
  type: project
---

2026-08-11 已暂停 `rid-skill-persistence-001`。用户约束：当前 bee（peaks-code）只有在用户明确提出替换/取消，或用户主动使用另一个非 bee Peaks 技能时才允许被替换或清除；superpowers 自动命中、普通 bug 反馈、compact、外层会话轮换均不得改变当前 bee。

已确认根因：`superpowers:using-superpowers` 的“bug → systematic-debugging”优先级与 Peaks 的 reference-only 边界冲突；`src/services/hooks/pre-tool-superpowers-bridge.sh` 未覆盖 systematic-debugging / test-driven-development / verification-before-completion / using-superpowers；`src/services/skills/hooks-settings-service.ts` 的 `SUPERPOWERS_DENIED_SKILLS` 目前只有 using-git-worktrees；`clearStalePresenceOnRotation` 在 outer-session mismatch 时可能清理当前 presence。明日继续：由 RD 子代理实施最小修复与回归测试，再交 QA 验证。当前 RD artifact 状态：spec-locked；暂停 checkpoint 位于 `.peaks/_runtime/2026-08-11-session-5c3563/checkpoints/2026-08-11T15-01-30-521Z.json`。

**Why:** 用户要求明天继续，必须保留可恢复的根因、约束、请求和 checkpoint。
**How to apply:** 恢复时先读取该 memory 与 checkpoint，再继续 `rid-skill-persistence-001`；不要把自动命中的 superpowers 技能视为用户切换意图。
