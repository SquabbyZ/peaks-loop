# Peaks-Loop Memory Index

> One-line pointer per memory file. Loaded into context every session. Full content lives in each `.md` file.

## 4.x sediment-pool

- [4x-sediment-pool-reserves-desktop-client-entry-points](4x-sediment-pool-reserves-desktop-client-entry-points.md) — 4.x pool + CLI + adapter 对未来桌面客户端天然预留的 4 个契约面（2026-07-04 user note）。
- [peaks-loop-is-enhancement-not-new-cli](peaks-loop-is-enhancement-not-new-cli.md) — peaks-loop = 现有 AI CLI 之上的增强层,不造新 AI CLI（2026-07-04 user note）。
- [human-nl-choice-only-tenet](human-nl-choice-only-tenet.md) — 项目元规则: 人参与决策 = 选择 / 自然语言描述,user 不敲 CLI 也不手写 JSON（2026-07-04 user note,优先级最高）。
- [peaks-loop-local-skillhub](peaks-loop-local-skillhub.md) — peaks-loop 本地 SkillHub store = 版本化的完整 skill 包;为未来线上公共 SkillHub 留 on-ramp;商业延展（2026-07-04 user note chain）。

## 4.x sediment-pool — 项目元规则

- 优先级栈: two-forms-only > human-nl-choice-only > enhancement-not-new-cli > 24h 定位 > 反伪选择。任何 spec/code 违反即重写。
- 已上升为项目级硬规则的条目,见 `CLAUDE.md`:
  - Human-NL-Choice-Only (2026-07-04)
  - Two-Forms-Only + 桌面是 UI 加速 (2026-07-04)
  - Enhancement, not new AI CLI (2026-07-04)
- 数据层一等公民: local SkillHub (`state.db` `bee_release` table) 与 pool (JSON) 并列,前者是版本化历史库,后者是 live dispatch 源。任何设计都不得混淆这两者。
