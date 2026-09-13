---
name: upgrading-the-package-does-not-refresh-generated-settings
description: npm i -g 换不掉项目里已生成的 .claude/settings.local.json；陈旧钩子会跨版本留存
metadata:
  type: project
  node_type: memory
  originSessionId: 29601951-8e04-4525-8107-125180abe7b4
  modified: 2026-09-11T17:10:45.398Z
---

**2026-09-12 由用户的实际故障定位到。** 用户在 `platform-web` 里装到 4.0.42 后**仍被卡住**；
最后是**删掉项目 `.claude/` 下的 json、重开 session**解决的 —— 随后 `peaks workspace init`
重新生成了它们，一切正常（状态头出现、不再复述四条、回合正常推进）。

**根因：`npm i -g peaks-loop@<新版本>` 只换包，不会刷新项目里已经生成的
`.claude/settings.json` / `.claude/settings.local.json`。** 那些文件是**很久以前某次 init 生成的**，
里面的钩子命令、matcher、`env` 全是旧版本的形态 —— **换包换不掉它们**，于是旧形态会**跨版本一直留着**。

**这与 auto-compact hook 那条是同一个病**（`48b1c675`）：改了常量，但**已有安装永远拿不到**，
因为安装器当时只比对 matcher、不比对命令（`3f17fadf` 才改成命令比对 + 就地重写）。
**同一个失效模式，换了个地方出现。**

**peaks 自带自愈，但是手动的**：`peaks upgrade --apply-init`（slice 2026-06-13）会跑
`initWorkspace`，让 drift-driven self-heal 落到消费项目的 `.claude/settings.local.json`。
**它的 help 里写着，但没人知道要跑** —— 用户是碰巧用"删掉重生成"达到同样效果的。

**可推广的判断：凡是"生成一次、之后只按需刷新"的产物，升级包都到不了它。**
要么在版本不匹配时**主动告警**，要么让自愈**默认触发**。否则每一次修复都只能到达全新安装。

相关：[[ecc-fact-force-gate-is-first-touch-not-read]]、[[check-ci-on-every-push-and-run-wide-tsc]]
