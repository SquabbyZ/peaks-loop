---
name: mode-consolidation-2026-09-09
description: mode 模型收敛（swarm 移除、24h 升为并列 mode）+ 修好 mode 从未被读回的 bug + compact auto 死命令 + 上下文窗口覆盖
metadata:
  type: project
  node_type: memory
  originSessionId: 90742f29-4074-4c14-acd7-2984851a606f
  modified: 2026-09-09T12:34:57.401Z
---

# mode 模型收敛 + 三个真 bug（2026-09-09）

**Date:** 2026-09-09（session 2026-09-07-session-245530）· commit `1f113485`

## 用户报的三个问题 → 三个真根因

### 1. auto-compact 老是让用户手动执行 → **契约指向一个不存在的命令**

`peaks compact auto --execute` 在 `skills/` + `src/` 出现 **49 次**（包括 CLI 自己返回的 `next` 字段），实际执行 → `COMMAND_NOT_FOUND`。真命令是 **`peaks code auto-compact`**（无 `--execute`）。

**LLM 按契约执行 → 撞死命令 → 只能回头问用户。** 契约写得再强硬也没用。

### 2. 上下文"统一默认为 20w" → **没有覆盖入口 + 补救太晚**

`modelContextWindowTokens()` 只在模型名含 `1m` 或匹配 `claude-opus-4/sonnet-4` 时给 1M，**其余一律 200K**；第三方模型只靠 env 的 `[1M]` 后缀。补救逻辑只在"已用 token > 200K"时触发——那时 ratio 已经错了 5 倍。

修：`PEAKS_CONTEXT_WINDOW_TOKENS`（env）+ `context.windowTokens`（config）覆盖，优先级 env > config > 启发式 > 默认；`context-now` 新增 `capacitySource` 字段。

### 3. mode 很乱 → **mode 压根没被读回来**（最严重）

`getSkillPresence()` **一直在丢掉 `mode` 字段** → 所有读 `presence.mode` 的守卫（mode-enforcement、assisted/strict 边界、post-compact-detector）**全是死代码**。用户设的 mode 从来没生效过。

## 新 mode 模型（用户拍板）

```
SkillPresenceMode = full-auto | assisted | strict | 24h     ← 四选一，并列
蜂群(swarm) = 所有 mode 的默认执行策略（不再是模式）
24h 状态机 = 24h mode 的内部状态（保留 6 状态）
24h = 唯一可自动开启的 mode（T1-T5）；其余 mode 仍必须用户选
新增 peaks code mode status = 一条命令读全量叠加状态
```

## Lesson 1 — 契约文本与 CLI 实现必须有一致性校验

**现象**：SKILL.md 49 处写 `peaks compact auto --execute`，命令不存在；CLI 自己还在返回这个字符串。**没有任何机制校验二者一致。**

**How to apply**：文档里出现的每个 CLI 命令，都应有测试断言"这个命令真的存在"（本次补了 `grep` 守卫）。纯 prose 契约会腐烂。

## Lesson 2 — 读取层静默丢字段 = 整个上层变死代码

**现象**：`getSkillPresence()` 丢 `mode` → 所有 mode 守卫永远提前 return，且**没有任何报错**。

**How to apply**：投影函数（把磁盘数据转成内存对象）必须与类型定义同步；改动类型时先 grep 该字段的所有消费点，确认投影层真的带上了它。静默丢弃比报错危险得多。

## Lesson 3 — 测试 spawn 构建产物时，**必须先 build 再测**

**现象**：`statusline-cli-integration.test.ts` spawn `dist/cli/index.js`。RD 和我跑全量时 `dist/` 都是旧的 → 回归被掩盖；`npm run build` 之后才暴露 4 个失败。

**How to apply**：凡测试 spawn 构建产物（`dist/**`），验收顺序必须是 **build → scoped → full**；派单契约里要写明这条。否则"全量绿"是假绿。

## 反模式（不要做）

- 不要在文档里写未验证存在的 CLI 命令。
- 不要在投影/读取层静默丢弃类型里声明的字段。
- 不要在没有 `npm run build` 的情况下相信 spawn-dist 类测试的结果。

相关：[[ecc-de-pluginization-2026-09-09]] · [[ci-green-restoration-2026-09-08]]
