---
name: 2026-08-01-peaks-statusline-accent-color
kind: reference
---

# Peaks 状态栏主题色

`#5A65D8`（slate-purple，bold 24-bit ANSI：`\x1b[1;38;2;90;101;216m`）是 Peaks-Loop 的官方主题色。

适用范围：
- 状态栏 brand 文本（`Peaks`）
- 状态栏活动点 / idle 圆点
- 状态栏紧凑生命周期各阶段
- 状态栏进度条填充
- Claude Code 状态行首字符的 `▎` 色带（通过保持 `Peaks-Loop` 开头自然获得）

不适用场景：
- 语义报警：failed 仍用 red（`\x1b[31m`），warning/attention 仍用 amber（`\x1b[33m`）
- 纯文本消费者（无 TTY / 无 UTF-8）：ASCII tier 始终无 ANSI 颜色

为什么选 `#5A65D8`：
- 与 Claude Code 自带 `▎` 色带在明亮终端中表现一致
- 与 Claude-Loop 5 个原始 accent 不冲突
- 与 brand `Peaks` 字形视觉对比度足够

引用：
- 渲染器实现：`src/services/skills/skill-statusline-renderer.ts`
- 设计稿：`docs/superpowers/specs/2026-08-01-statusline-outstyle-polish-design.md`
