---
name: design-route-identity-is-page-identity
description: 设计门禁判定"是不是我要的页面"只能读页面自身的 title/heading（含声明的 routeMarkers），共享导航栏与 sample text 永远不能作为证据；未声明的路由在客户端跳转后只能是 inert
kind: project
createdAt: 2026-11-25
sessionId: 2026-11-23-session-320f58
---

# 路由身份 = 页面自身身份，不是共享外壳

S6 切片在 ModelMatrix 试点上测出来的两条硬事实，决定了 `peaks design check` 的 route-identity 阶段该怎么用：

1. **共享外壳在每条路由上都在**。站点的全局 header 有一个 `Sign in` 按钮，sidebar 有一个 `channels` 链接。把 button label / anatomy sample text 纳入判定后：`/about` 被误判成登录页（false block），而真正跳到登录页的 `/channels` 只是因为同一个 header 按钮"恰好"命中——两个方向都错。**只有页面自己的 title 和 heading 能决定身份**，声明的 marker 与负向标签都必须只在这两个表面上匹配。
2. **未声明的路由在客户端跳转后不可判定**。designlang 13.4.1 不暴露客户端导航后的 URL（`meta.url` 是请求 URL），SPA 的 title 是常量，登录页的 `<h1>` 位于 `<form>` 内不被采集。因此：没有 `paved-road.json` 的 `routeMarkers` 声明时，stage 只能 inert——这是诚实边界，不是缺陷。要给门禁真正加一道身份检查，**必须为每条路由声明一个出现在其自身 title 或可采集 heading 里的 marker**（例如 `/about: "About"`）。

配套的可测事实（同一试点）：登录页整帧非模态色占比约 6.7%，和内容页没有可区分差距，所以"paint 指标能否定出登录墙"的答案是**不能**；`/channels` 与组件 404 的截图各约 7.6s，identity extract 约 3s。

## How to apply

- 新增任何"身份/路由"判定时，先问：这个信号在同一站点的每条路由上都出现吗？是 → 它只能做 chrome，不能做证据。
- 需要判定某条路由时，先在 `design/paved-road.json` 的 `routeMarkers` 里声明一个该页自身可见的字符串，再依赖这个 stage。
- 看到 route stage "inert" 时，不要当作 pass，也不要当作 fail：补声明，或接受这条路由没有被识别。

关联：[[peaks-design-governance-spec]]、[[route-markers-declared-not-inferred]]
