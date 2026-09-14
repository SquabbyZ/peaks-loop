---
name: two-peaks-probes-disagree-about-what-a-ratio-means
description: peaks skill presence 与 peaks code context-now 对同一个上下文比例给出不同的 action（65.6% 判 auto-fire，70.3% 判 soft-warn）；两个探针各自解析阈值，没有机制保证一致
metadata:
  type: project
  node_type: memory
  originSessionId: e0ac1231-9059-438e-b036-c6cae372eb87
  modified: 2026-09-14T03:30:00.000Z
---

**peaks-loop 的两个探针，对同一个"上下文用了多少"给出不同的动作 —— 而且比例更高的那个反而更轻。**

## 实测（2026-09-14，相隔约两分钟）

```
peaks skill presence   : context.ratioPct = "65.6%"   context.action = "auto-fire"   mode = "partial"
peaks code context-now : ratio            =  0.703    action         = "soft-warn"
```

**不是时间差**：65.6% 判 `auto-fire`，70.3% 判 `soft-warn` —— 阈值不单调，说明**两者不是同一套判据**。`presence` 带 `mode: "partial"` 而 `context-now` 不带，所以很可能是**按 mode 选阈值的那一层，只在一个探针里生效**。

## 为什么这要紧

**契约说 `peaks code context-now` 是唯一权威**（"Probe primitive (single source of truth)"），而**另一个探针在每轮都会说话**（`presence` 是 SKILL.md 要求每轮读的），且它的措辞更紧急。于是一个照做的 LLM 会**因为较不权威的那个而触发压缩**。

这正是同一晚反复出现的形状 —— **只是这次发生在 peaks-loop 自己身上**：
- 两个组件各自解析同一个窗口 → 红线可早触发数倍（[[two-components-resolved-the-window-independently]]）
- 写入端追加在末尾、检查端读第一条 → 状态永远停在第一轮
- 现在：两个探针各自解析阈值 → 动作不一致

## 怎么用

- **要看上下文动作，只看 `peaks code context-now` 的 `action` 字段。** `presence` 的 `context.action` 目前不可作为判据 —— 至少在没有确认两者同源之前。
- 若要修，方向与已验证过的一致：**让两者派生自同一个来源**，而不是各自解析。修之前先量清楚 `presence` 的阈值从哪来（`mode: partial` 是不是在选另一张表）。
- **报告里出现"某个探针说 X"时，先问是哪个探针、以及另一个会不会说 Y。** 本 session 里我据 `presence` 触发了 `auto-compact`，而两分钟后 `context-now` 说不需要 —— 那次触发无害（它只写 checkpoint 与 convergence plan），但**结论是运气，不是机制**。

相关：[[two-components-resolved-the-window-independently]] · [[claude-code-has-no-llm-invocable-compact]] · [[commander-defaults-defeat-fallbacks]]。
