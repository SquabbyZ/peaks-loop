---
name: harness-compaction-witness-lives-in-the-transcript
description: harness 把每次压缩的判决书写进 transcript（compactMetadata.trigger=manual|auto + preTokens/postTokens）；peaks-loop 不读它；而 transcript 格式官方声明会随版本变，正式通路是 PreCompact/PostCompact 钩子
metadata:
  type: project
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-13T10:50:00.000Z
---

**"那次压缩是自动还是手动、压掉了多少 token" 这个事实，harness 自己已经写在磁盘上了 —— 但 peaks-loop 不看它。**

每次压缩，transcript 里会出现一条 `type: "system"`, `subtype: "compact_boundary"` 的记录，带：

```json
{ "trigger": "manual" | "auto",
  "preTokens": 963306, "postTokens": 28127,
  "cumulativeDroppedTokens": 935179, "durationMs": 59310 }
```

`preTokens` 是 **harness 自己数的** token 数。实测与 peaks-loop 的 `transcript-estimate` 只差 **0.17%**（961,658 vs 963,306）—— 这也顺带证明 peaks-loop 的比例尺度和 harness 是同一个。

**为什么这重要**：peaks-loop 的 `observed` 行只能由"先 dispatch 开 run、再有压缩把比例打下去"产生，所以它**必须先有一次真实压缩**才发现得了东西。而 `compactMetadata` 是一个**回溯可用**的见证 —— 压缩已经发生过也照样读得到，不用守在 850K token 上等。用它扫全部 transcript 得到 `manual ×2 / auto ×0`，这个结论**不需要任何等待**。

**但别直接解析 transcript。** 官方文档明写：

> "The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release."

正式通路是两个**已文档化**的钩子事件：`PreCompact`（matcher `manual` | `auto`，输入多带 `trigger`）和 `PostCompact`。peaks-loop 已有自己的钩子安装机制（`peaks hooks install`），所以接进去是有门的；拿 transcript 当契约则没有。

**怎么用**：要验"真实压缩会不会结算出 observed 行"，看 `trigger` 字段，不要看行数攒没攒起来。要**做**这件事，走 `PreCompact`/`PostCompact` 钩子。

相关：[[compact-calibration-is-automatic-but-not-yet-accumulating]] · [[peaks-loop-raised-the-compaction-point-to-the-model-ceiling]] · [[claude-code-has-no-llm-invocable-compact]]。
