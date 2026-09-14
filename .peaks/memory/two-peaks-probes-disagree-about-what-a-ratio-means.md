---
name: two-peaks-probes-disagree-about-what-a-ratio-means
description: peaks skill presence 与 peaks code context-now 在同一比例下给出不同 action；权威是 presence（它报系统真正据以行动的那一档），context-now 的阶梯是 mode 盲的——与本条早期版本相反
metadata:
  type: project
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-14T14:40:00.000Z
---

**两个探针对**同一个比例**给出不同动作。权威是 `peaks skill presence`，不是 `peaks code context-now`。**

> ⚠️ **本条目早期版本说反了。** 当时只从"契约说 context-now 是唯一权威"推出结论，没有去看**系统真正据以行动的是哪一档**。2026-09-14 的实测推翻了它。

## 实测（同一个比例、同一分钟）

```
peaks skill presence   : ratio 0.861324  action red-line         mode=partial
peaks code context-now : ratio 0.861324  action pre-compact      verdict auto-compact-now
```

**不是时刻差** —— 两个先前的观察（65.6 vs 70.3、84.6 vs 84.6）都能从源码零自由参数复现出来：**它们是两张不同的档位表，不是两次不同的读数。**（同一时刻 harness 见证的偏离 0.0013 也小于容差 0.0064，即读数一致。）

## 为什么权威是 presence

- **它报的是系统真正据以行动的那一档**：`Bash|Task` 的 PreToolUse 钩子用的是同一个 `evaluateCompactTrigger(ratio, mode)`，而历史行证明 `mode:"partial"`、`redLine:true` @0.861324。
- **它是被选作每轮通道的那个** —— SKILL.md 正文会被压掉，所以每轮义务挂在每轮必调的 tool 输出里（见 [[per-turn-obligations-belong-in-per-turn-output]]）。
- **`context-now` 的阶梯是硬编码且对 mode 盲的**（`code-runtime-commands.ts:361-380` 的 0.85/0.95），按构造就不可能报出 partial 的档位。

**但反向的重量必须一起记**：**`context-now` 对"契约文本说了什么"是权威的**（发布的契约写 0.85/0.95）。**这个分裂本身就是缺陷** —— 不要把它当成两个 bug 分开修。

## 请求点的三个并存答案（2026-09-14）

| 来源 | 档位 |
|---|---|
| `AUTO_COMPACT_THRESHOLDS`（`auto-compact-modes.ts:24-31`） | standard 0.80/**0.85**/0.95；partial 0.65/**0.70**/**0.85** |
| 发布的契约散文 | 0.85 / 0.95 |
| `context-now` 的阶梯 | 硬编码 0.85 / 0.95，**对 mode 盲** |

**生效的是第一个**：`resolveAutoCompactProfile` 把 presence 的 `24h` 映射为 `partial`，而历史行全部是 `"mode":"partial"`。

## 怎么用

- **要判"peaks-loop 会做什么"，看 `peaks skill presence` 的 `context.action`**；要判"契约怎么写的"，看 `context-now`。
- **两者不一致时，先问"哪一个是系统据以行动的"** —— 而不是"哪一个是权威文档指定的"。本条的早期错误正是只问了后者。
- **harness 的真实执行点在本机是 0.967，不是 0.95**：`min(window, modelWindow) − 20_000 − 13_000`（1M 窗口下 = 967,000），与本仓两处独立数字交叉核对过。

相关：[[two-components-resolved-the-window-independently]] · [[claude-code-has-no-llm-invocable-compact]] · [[per-turn-obligations-belong-in-per-turn-output]]。
