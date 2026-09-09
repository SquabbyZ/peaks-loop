---
name: 2026-09-10-memory-system-overhaul
description: 记忆系统四断排查与修复 — 写入割裂/索引漂移/调取静态/健康检查空转；根因是共享解析器只认顶层 type 导致 metadata.type 文件被静默丢弃
metadata:
  type: lesson
  affects: .peaks/memory, MemoryPreflightService, l3-memory-health
  related: 2026-09-07-mode-consolidation
---

# 记忆系统 overhaul（2026-09-09/10）

**Date:** 2026-09-10
**Session:** 2026-09-07-session-245530
**Commits:** `50ccb54b`（A+B+D）、`612447fd`（C）

## 一句话

peaks-loop 记忆系统的**结构是对的**（index.json 分层 + CLI + preflight 注入），但四个环节全断：写入割裂、索引漂移、调取静态、健康检查空转。根因是**共享 frontmatter 解析器只认顶层 `type:`**，导致按契约写 `metadata.type` 的文件被**静默丢弃**。

## 四个断点与修复

| # | 断点 | 证据 | 修复 |
|---|---|---|---|
| ① | **写入割裂**：peaks-code 工作流里说"沉淀记忆"，只写进 Claude Code 的记忆目录 | 本会话 4 条记忆全在 `~/.claude/projects/.../memory/` | `peaks memory ingest`（只读源，绝不写 `~/.claude/`）+ SKILL.md 明确单一权威 |
| ② | **索引漂移**：303 个顶层 .md 里 78 个不在索引 | 12 个完全符合契约却漏 | `peaks memory reindex` + **修共享解析器** |
| ③ | **调取静态**：`fetchBlock(_taskTitle)` 参数**完全没用**，永远注入同一批 feedback+layerA | warm 131 条从不进 preflight | 按任务排序 + hot/warm 分层 + 三重预算 |
| ④ | **健康检查空转**：doctor 只查"index.json 是合法 JSON" | 报 ok 但 46% 文件不可见 | 新增 coverage / orphans / unclassified 三项 |

## Lesson 1 — 静默丢弃比报错危险

**现象**：解析器只认顶层 `type:`，但契约是 `metadata.type`。30 个文件按正确契约写，却被**无声跳过**，没人知道。

**How to apply**：任何"按契约过滤"的解析器，遇到不认识的值必须**产出清单**（本次 reindex 输出 `unclassified` 列表），不能静默 continue。

## Lesson 2 — 修根因要修共享层，不是调用点

**现象**：RD 最初可以只改 reindex，但 `readMemoryIndex` 的 mtime 守卫会在下次写记忆时把索引改回去 → 漂移复现。

**How to apply**：判断一个 bug 的修复点，要问"谁会再犯同样的错"；共享解析器/守卫层才是根治点。

## Lesson 3 — 参数不用，等于功能不存在

**现象**：`fetchBlock(_taskTitle)` 的下划线前缀就是"未使用"的信号，但没人处理 → 检索永远静态。

**How to apply**：grep 带下划线前缀的未使用参数，它们常是"设计做了、实现没接"的残留。

## Lesson 4 — 检索要分层 + 按需，不要整体注入

**参考**：TencentDB Agent Memory（L0→L1→L2→L3 + 条数/字符/超时三重预算）、Karpathy "LLM Wiki"（索引先读、lint 孤儿页、ingest 触碰多页）。

**How to apply**：记忆注入默认只给**紧凑索引行 + 路径**，正文按需 `Read`；预算是三重的（条数/字节/时间），不是单一 token 上限。

## 反模式（不要做）

- 不要在 peaks-code 工作流里把"沉淀记忆"只写进 IDE 侧记忆目录。
- 不要让解析器静默跳过不符合契约的文件。
- 不要把记忆正文整体注入派发提示词。
- 不要只用"JSON 合法"当记忆健康标准。

## 待办

`MEMORY.md` 重生成只跑了 dry-run（它是 git-tracked 的 52 KB 手工文档，保留/废弃需用户拍板）。
