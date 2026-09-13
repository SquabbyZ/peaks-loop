---
name: claude-code-has-no-llm-invocable-compact
description: 模型和钩子都无法触发压缩；CLAUDE_CONTEXT_USAGE_PERCENT 不存在；唯一杠杆是 harness 自己的阈值配置
metadata:
  type: reference
  node_type: memory
  originSessionId: bd89a11a-b66d-443c-b8b7-e9aa813190c2
  modified: 2026-09-12T15:46:22.553Z
---

**Claude Code 没有任何让模型或钩子触发压缩的机制。** 2026-09-12 经 claude-code-guide 对官方文档核实：

- `/compact` **不可**被模型调用。Skill 工具只暴露 `/init` 与 `/security-review`；文档原文："Other built-in commands such as `/compact` are not."
- 钩子只能**观察**（`PreCompact` / `PostCompact`）或**否决**（`PreCompact` exit 2）。**零"发起"能力。** 钩子输出只在 `UserPromptSubmit` / `SessionStart` 等少数事件上作为**上下文**注入，没有反向通道。
- **`CLAUDE_CONTEXT_USAGE_PERCENT` 不存在。** 文档中无此变量；受支持的用量通道是**状态栏 stdin 的 `context_window.used_percentage`**。
- **没有 `--compact` flag。** 外部进程无法触及运行中会话的内存 —— spawn 一个 `claude` 压的是**另一个进程**。
- **唯一真正的杠杆**：`CLAUDE_CODE_AUTO_COMPACT_WINDOW` / `autoCompactWindow`（env 优先级最高）。**peaks-loop 压不动上下文，但能配置 harness 自己压。**
- Agent SDK 可由**宿主**把 `/compact` 当 prompt 发 —— 但那是宿主应用，不是模型。

**为什么重要：** 这类失效是**静默**的 —— 模型把 `/compact` 当普通文本发出，什么也不发生，**不报错**，而模型常会**叙述自己成功了**。peaks-loop 的 auto-compact 设计（`.peaks/memory/2026-06-27-auto-compact-design.md`）正是建立在"LLM 自己发 `/compact`"这个虚构之上；其 `ide-native` 路径的实际动作只有"写日志 + 写 intent 文件 + 写 hook 文件"，**无执行器**。`compactCommand` 零生产读者；`writeMainSessionCompactIntent` 零读者；红线闸门因此**构造性死锁**（实测：95.6% 时封死派发，无人能降）。

**How to apply:** 任何"让 AI 自己压缩上下文"的设计，先确认执行器**存在且受支持**，再写契约。可用的三件套是：(1) 用量走状态栏 `used_percentage`；(2) 阈值配置交给 harness；(3) 用 `SessionStart` + `matcher:"compact"` 在压缩**之后**回注状态。参见 [[per-turn-obligations-belong-in-per-turn-output]]（同样关于"契约写了一个做不到的动作"）与 [[single-observation-is-not-a-property]]。
