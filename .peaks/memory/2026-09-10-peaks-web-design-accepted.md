---
name: 2026-09-10-peaks-web-design-accepted
description: peaks web（Playwright 有界浏览器能力）设计经 grilling 10 问 + peaks-audit 6 维审计后 goal 已接受，4 个子切片待实施
metadata:
  type: design
  affects: peaks web CLI, browser isolation, UNTRUSTED envelope
  related: 2026-09-10-dispatch-and-orchestrator-context
---

# `peaks web` 设计已接受（2026-09-10）· 待实施

**Date:** 2026-09-10
**Session:** 2026-09-07-session-245530
**状态：设计定稿 + goal 已接受，S1-S4 未开工**

## 要解决的实测问题

| # | 问题 |
|---|---|
| P1 | Playwright MCP 返回整棵 a11y 树（10–50 KB/快照） |
| P2 | MCP 截图**落在项目根目录**（用户实测） |
| P3 | 需手动装 MCP |
| P4 | **多个 session 共用一个浏览器、互相干扰**（用户实测） |
| P5 | 同页面反复推理，无复用 |

## 10 项已拍板决策（grilling）

v1 = **完整**（8 命令 + daemon）；工件路径**固定** `<proj>/.peaks/_runtime/<sid>/web/`；CI 开关**两者都做**；与 MCP **并存**（`peaks playwright` 保留为降级）；持久登录**必须用户显式提出**；非信任内容 **v1 就做 UNTRUSTED 信封**；daemon 生命周期**复用 `peaks sub-agent shutdown register` + 父进程 kill**（不新造 idle-exit）；隔离 = **每 session 一个浏览器进程 + 每 dispatch 一个 browser context**；编排器与子代理**都可调用**。

## 子切片

| | 内容 | 验收 |
|---|---|---|
| S1 | 核心命令（open/text/snap/click/shot/metrics）+ 存储不变量 + 有界输出 + UNTRUSTED 信封 | 根目录零新增 / 字节 ≤ MCP 1/5 / 含信封 |
| S2 | 每 session 浏览器 + 每 dispatch context + daemon 生命周期 | 并发 session 互不干扰 / 无残留进程 |
| S3 | 懒下载 + `PEAKS_WEB_DISABLED` + 降级链 + install/status | 禁用时不下载 |
| S4 | 持久登录（仅显式 `peaks web login --profile`）+ 修订 cookie 规则 | — |

## 关键事实（已核查，避免重复调研）

- **`npx` 作为 CLI 内部机制合规**（`external-skill-invocation.md:50`：package managers "only as the underlying mechanism when a `peaks` CLI command spawns them"）；禁止的是**打包**。
- `peaks playwright` 现状：**只 `spawn npx playwright-mcp@latest`**，不起浏览器；有 session 记录 + profile 目录；**无 idle-exit**。
- 浏览器抽象：`browser-wrapper-service.ts` 把 5 个 intent 映射到 `mcp__playwright__*`；CLI 侧是 stub。
- **无 UNTRUSTED 信封实现**；`browser-workflow.md:106-116` 明令"Never persist Cookies"——S4 要修订它。
- 生命周期先例：`peaks sub-agent shutdown register` + `killRegisteredServices` 存在；**无 idle-exit 先例**。

## 工件位置

- 设计定稿：`.peaks/_runtime/2026-09-07-session-245530/sc/design-web-playwright.md`（含审计后补的两处边缘）
- 已接受 goal：`.peaks/_runtime/2026-09-07-session-245530/audit-goal/2026-09-10-peaks-web.json`

## 未发版

4.0.36 之后有 2 个提交未发版（记忆沉淀 + 三件修复）。
