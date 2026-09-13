---
name: peaks-loop-raised-the-compaction-point-to-the-model-ceiling
description: 原生 1M 模型的 harness 默认在 ~967K 自动压缩（自留 33K 余量）；peaks-loop 把 CLAUDE_CODE_AUTO_COMPACT_WINDOW 写成 1000000=模型窗口上限，等于把压缩点抬到天花板并花掉那份余量
metadata:
  type: project
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-13T10:50:00.000Z
---

**这个键设的是压缩点本身，不是单纯的分母 —— 所以把值写成模型窗口上限，是把 harness 调好的安全余量花掉。**

官方文档（model-config，2026-09-13 核）：

> "Models running with a native 1M window, such as Sonnet 5, the Fable models, and Opus 4.7 and later on the Anthropic API, compact before the window fills, **at about 967K tokens by default**."
>
> "set `CLAUDE_CODE_AUTO_COMPACT_WINDOW` to choose a different threshold."
>
> "Claude Code caps the window at the model's context window."

所以：原生 1M 模型出厂就在 **~967K** 压，**自己留了 ~33K 余量**（还模型窗口上限的账）。peaks-loop 写 `1000000` → 压缩点被抬到 **1,000,000**，那 33K 余量没有了。

**实测佐证**：`bd89a11a` 那次是用户手动 `/compact`，`preTokens = 963,306` —— 距文档默认自动触发点 **3,694 token**。也就是说那不是"harness 不会自己压"，而是**手动在自动触发前约 4K token 抢跑了**。这条解释了 `auto = 0`，且不需要"能力缺失"这种假设。

**对标的定的直接后果**：只要窗口钉在天花板上，手动 `/compact` 就会**反复抢在自动触发前面**，`observed` 行永远攒不起来 —— 等再久也一样。这不是时间问题，是配置问题。

**怎么用**：
- peaks-loop 的比例分母必须等于 harness 真正的压缩点，否则 `ratio 1.0 = 压缩发生` 这个等式就差了 3.3%。
- 选值时应取 harness 对该模型的**调优值**（原生 1M 为 ~967K），而不是模型窗口上限。
- 别用 `/autocompact` 去核对：文档说该键一旦被 env 覆盖，"`/autocompact` **reports the override** instead of changing the window"——它只会如实报告被覆盖，不会改。

相关：[[harness-compaction-witness-lives-in-the-transcript]] · [[compact-calibration-is-automatic-but-not-yet-accumulating]] · [[two-components-resolved-the-window-independently]]。
