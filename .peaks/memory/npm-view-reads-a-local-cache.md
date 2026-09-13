---
name: npm-view-reads-a-local-cache
description: npm view 读本地缓存，会给出过期的版本结论；registry 才是权威
metadata:
  type: project
  node_type: memory
  originSessionId: 29601951-8e04-4525-8107-125180abe7b4
  modified: 2026-09-11T16:34:35.299Z
---

**2026-09-11 发 4.0.39 时误报了一次严重 bug。** 发布后我用 `npm view` 核对，
`peaks-loop-internal-runtime` 报 `dist-tags.latest = 0.0.23`（bump 明明去了 0.0.24），
`npm view peaks-loop-internal-runtime@0.0.24 version` 还**返回 404**。两条独立信号都指向
"这个包没发出去，而 publish workflow 报 success" —— 一次静默的部分发布。

**这是假的。** 查 `https://registry.npmjs.org/peaks-loop-internal-runtime`：
`0.0.24` 存在且 `dist-tags.latest = 0.0.24`。重跑 `npm view --prefer-online` 也立刻改口。

**根因：`npm view` 读本地缓存，新发布的版本不会立刻可见**，而缓存陈旧时**可能连版本查询都返回 404**
（不是"未找到"，是"缓存里没有"）。

**代价：** 我据此把 `scripts/release-pack.mjs` 从头读到尾，追查 `isAlreadyPublished` /
`isRegistryStale` / `publishOne` 的每条提前返回路径，全是白工。

**2026-09-12 补充：`--prefer-online` 也不够。** 发 4.0.42 时它把 `peaks-loop-shared` 的
`dist-tags.latest` 报成上一版的 `0.0.75`，而 registry 直查是 `{"latest":"0.0.76"}` ——
**同一份数据，`npm view` 又一次给了陈旧的 dist-tag**（同一次调用里 `versions` 却是新的，
所以它连自洽性都没有）。

**做法（收紧后的结论）：**
- **只信 `https://registry.npmjs.org/<pkg>` 的 `dist-tags`。** `npm view` 无论加不加
  `--prefer-online` 都可能是陈旧的，且**不自洽**（`versions` 新、`dist-tags` 旧）。
- 更一般地：**本地工具的缓存不是事实来源。** 断"某物不存在"之前，先问一个不经过缓存的来源。
- 这条在本会话让我**误报过一次严重 bug**，值得记住它的代价：我当时据此断言"包没发出去、
  而 workflow 报 success"——一次不存在的静默部分发布。

**这是本会话第二次同类错误**（另一次是把 compact 后的 6.9% 当成"探针读错"）。
共同点：**拿一个间接观测下的结论，去断言一个我没验证过的事实。**

相关：[[peaks-loop-consumer-project-gaps]]、[[execsync-goes-through-cmd-on-windows]]
