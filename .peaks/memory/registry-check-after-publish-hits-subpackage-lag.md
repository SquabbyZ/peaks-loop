---
name: registry-check-after-publish-hits-subpackage-lag
description: registry-check-after-publish-hits-subpackage-lag
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff-4-0-45.md
---

`peaks-loop@X` 的 dependencies 对四个子包版本做**精确 pin**。发布后立刻查 registry，`shared` / `shared-channel` 可能仍显示旧版本（表现为 MISSING）；而 pin 指向的新版本尚不存在时，`npm i -g` 会直接失败。等待数十秒后重查即恢复正常 —— 4.0.44 与 4.0.45 两次发布都观察到同样现象。

**Why:** 若把 MISSING 直接判定为「漏发」，就会白折腾一次重发（甚至改动已发布的版本号），而真实原因只是 CDN / registry 的子包传播延迟。这是一个会稳定复现、且每次都有诱惑力让人误判的假信号。

**How to apply:** 查到 MISSING 先**等待并重查**，不要立刻当作失败。核对版本始终以 registry 为准而非本地 npm 缓存（见 `npm-view-reads-a-local-cache`）；确认真失败前至少重查一次。
