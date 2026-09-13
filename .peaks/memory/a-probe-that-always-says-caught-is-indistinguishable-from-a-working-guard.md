---
name: a-probe-that-always-says-caught-is-indistinguishable-from-a-working-guard
description: "注入式验证的探针必须先跑干净树对照组；探针本身出错会把每次注入都报成\"抓到了\""
metadata:
  type: feedback
  node_type: memory
  originSessionId: bd89a11a-b66d-443c-b8b7-e9aa813190c2
  modified: 2026-09-13T04:21:16.513Z
---

**用注入验证守卫时，探针本身出错的表现，与"守卫工作正常"**输出完全一样**。**

2026-09-13 实测（peaks-loop vendor 守卫的收口轮）：RD 的注入探针用 `./node_modules/.bin/vitest.cmd` 启动。在 Windows 上，不经 shell 直接 spawn 一个 `.cmd` 会抛 **`EINVAL`**（这是本仓库已知的 `.cmd`-shim 家族，见 [[execsync-goes-through-cmd-on-windows]]）。而探针把"非零退出"一律读作"守卫失败了"—— 于是**每一次注入都报"抓到"，包括那些实际逃逸的**。

**它的第一版探针因此全是假阳性**，而且**看起来完全正常**：每个形状都"通过"了。

**Why:** 注入式验证的整个价值在于"我看到它失败"。若探针恒报失败，这个信号就被抹平了 —— 你会得到一份**看起来证据充分、实际什么都没验**的报告。这与会话里另外两次同形失效一致（守卫声称的属性与实际能挡的东西不符、限制清单凭记忆写数字）。

**How to apply:**
1. **每次注入必须配一个干净树对照组**（无注入时探针必须**通过**）。没有对照组的注入证据不算证据。RD 最终用 `node vitest.mjs` + 对照组（干净树 `exit 3` → 判定为"未抓到"）修好了它。
2. **探针要能区分"抓到"与"探针坏了"** —— 不能共用一个退出码/异常通道。
3. **在 Windows 上不要用 `.bin/*.cmd` 启动探针工具**；直接用 `node <path-to-js>`。
4. **并发是另一个假信号源**：同一棵树上让注入与测试套件并行跑，会得到假失败（本会话 QA 撞到过：19 条"失败"全部是并发产物）。**探针与套件必须串行。**

参见 [[single-observation-is-not-a-property]] 与 [[use-the-repos-existing-ast-guard-not-a-fresh-regex-scan]]。
