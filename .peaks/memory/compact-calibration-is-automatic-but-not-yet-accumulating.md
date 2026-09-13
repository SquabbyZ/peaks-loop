---
name: compact-calibration-is-automatic-but-not-yet-accumulating
description: auto-compact 标定：分母 1M 已实测证真、settle 链路无缺陷；但 harness 自动压缩从未触发过（auto=0）—— 手动 /compact 抢在自动触发前约 4K token
metadata:
  type: project
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-13T10:50:00.000Z
---

**"由 peaks-loop 决定压缩触发点"只差标定数据。数据自动产生，但今天实测下来，卡的既不是"会不会产生"也不是"要等多久"。**

**自动链条**（无需任何人工步骤）：

```
比例跨过 85%
  → `peaks code auto-compact` 派发 → 写一条 dispatch 行 + 开 lifecycle run（stage = armed）
  → 之后任意一次探测发现比例已跌回阈值之下
  → `settleOpenLifecycleRun` 结算 → 写一条 observed 行（带 afterRatio + windowTokens）
```

"之后任意一次探测"是自动的（`gate-step-08` 的 PreToolUse 钩子每轮都在跑）。**压缩是手动还是自动不影响结算** —— 结算只看"有没有一条开着的 run + 比例有没有掉下来"。

---

## 2026-09-13 实测：三条修正

### ① 分母已证真 —— 这条担心可以划掉

原先担心 peaks-loop 的 1,000,000 与 harness 实际窗口不符（plan A §6.1 要求实测，代码里零实现：`used_percentage` 在 `src/` 零引用）。**实测通过**：

| 检验 | 结果 |
|---|---|
| harness 在 1M 的多少上压过 | 全部 transcript 里唯一一次 >20K 的下跌是 961,658 → 73,871，即 1M 的 **96.3%** |
| 会不会其实按 200K 算 | **不会** —— 若是，早在 ~192K 就该压，整条 transcript 没有 |
| 两边数对得上吗 | peaks-loop 估 961,658 vs harness `preTokens` 963,306 —— **差 0.17%** |

### ② 没有缺陷 —— 原先担心的那一环不成立

原先记的是"没有人在一次*真实*压缩之后观察过它"。查下来：**两次真实压缩都早于机制落地**，所以当时不可能有 observed 行。

| transcript | preTokens | 时刻 | 相对机制 |
|---|---|---|---|
| `29601951`（51 MB） | 724,225 | ≤ 09-12 01:17 | 早 2 天 |
| `bd89a11a`（45 MB） | 963,306 | 09-12 23:40 | 早 9 小时（机制 commit `94bacb4a` = 09-13 08:42） |

### ③ auto = 0 次 —— 真正的卡点在这里

拿 harness 自己的见证（`compactMetadata.trigger`）扫全部 transcript：**`manual` ×2，`auto` ×0**。而 `preTokens = 963,306` 距文档给原生 1M 模型的默认自动触发点 **~967K 只差 3,694 token**。

**所以不是"harness 不会自己压"，是手动 `/compact` 反复抢在自动触发前面。** 只要窗口钉在模型上限，这个抢跑就会一直发生，`observed` 行永远攒不起来 —— **等再久也一样，这是配置问题不是时间问题**。详见 [[peaks-loop-raised-the-compaction-point-to-the-model-ceiling]]。

---

**怎么知道开始了**：数 `kind === 'observed'` 的行数，从 0 变成 ≥1 就是成了。**但更快的判据是不等行数**：看有没有一次 `compactMetadata.trigger === "auto"` —— 这个见证回溯可用，压缩发生过也读得到。

**唯一仍未验证的一环**：settle 在**真实压缩落地的当下**被触发的动态路径。上面只证明了静态可读（守卫接受 `armed`、行会在事后可被解释）。要动态验证，不要守着 850K token 等，走 `PreCompact`/`PostCompact` 钩子。见 [[harness-compaction-witness-lives-in-the-transcript]]。

**接缝已验证（静态）**：`auto-compact-lifecycle.ts:283` 的早退守卫是
`if (prior.stage !== 'compacting' && prior.stage !== 'armed') return null;`
—— `armed` 可结算。

**另一条仍然成立**：`.peaks/_runtime/<sid>/compact-history.jsonl` 里 163 行历史**全是废的**（有 `kind` 的 0 条、有 `windowTokens` 的 0 条，末行 09-12T15:34:58Z 早于 T4 落地），标定从零开始攒。

相关：[[harness-compaction-witness-lives-in-the-transcript]] · [[peaks-loop-raised-the-compaction-point-to-the-model-ceiling]] · [[claude-code-has-no-llm-invocable-compact]] · [[two-components-resolved-the-window-independently]] · [[writing-a-value-then-reading-it-back-locks-the-first-guess]]。
