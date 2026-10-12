---
name: src-only-guards-miss-husky-src-husky
description: src-only-guards-miss-husky —— 只覆盖 src 的守卫看不见 .husky 里的新代码
metadata:
  type: project
  sourceArtifact: .peaks/_runtime/2026-10-12-session-74bd69/txt/handoff.md
---

实测（2026-10-12）：把 `session.json` 的 `sessionId` 写成 `../../../outside`，新提交闸会
**枚举并判定项目根之外的一个 rid**（旧行为 exit 0「artifact contract satisfied」；
修后 exit 1「DID NOT RUN …… unusable session id」，**从不枚举它**）。

**要点不是这个 bug，而是它为什么对仓库自己的守卫隐形**：那条路径安全扫描的作用域是 `src/**`，
而新代码住在 `.husky/**`。**修它所需的 helper 早就在仓库里**（`getSessionDir` /
`isUnsafePathInput` / `guardRuntimeSegment`）—— 所以这不是「缺能力」，是**缺覆盖**。

**推广**：本仓的守卫普遍按目录圈定作用域（`src/**`、`packages/*/src/**`、`scripts/`…）。
**每新增一个承载可执行代码的目录，就多一个守卫盲区**，而且**没有任何东西会提醒你去扩作用域**。
（同族：ESM `require` 扫描的 `.husky/` 归属问题；`tests/**` 的尺寸上限只在测量宇宙里、不在强制作用域里。）
