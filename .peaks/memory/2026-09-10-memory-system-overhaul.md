---
name: 2026-09-10-memory-system-overhaul
description: 记忆系统四断排查与修复 — 写入割裂/索引漂移/调取静态/健康检查空转；根因是共享解析器只认顶层 type 导致 metadata.type 文件被静默丢弃；并建 rotate 清除机制
metadata:
  type: lesson
  affects: .peaks/memory, MemoryPreflightService, l3-memory-health, peaks memory rotate
  related: 2026-07-24-sediment-pruning-policy
---

# 记忆系统 overhaul（2026-09-09/10）

**Date:** 2026-09-10
**Session:** 2026-09-07-session-245530
**Released:** 4.0.35

## 一句话

peaks-loop 记忆系统的**结构是对的**（index.json 分层 + CLI + preflight 注入），但四个环节全断：写入割裂、索引漂移、调取静态、健康检查空转。根因是**共享 frontmatter 解析器只认顶层 `type:`**，导致按契约写 `metadata.type` 的文件被**静默丢弃**。本轮补齐四环，并实现了 2026-07-24 政策早已规定却从未实现的轮转机制。

## 四个断点与修复

| # | 断点 | 证据 | 修复 |
|---|---|---|---|
| ① | **写入割裂**：工作流里说"沉淀记忆"只写进 IDE 侧记忆目录 | 本会话 4 条记忆全在 `~/.claude/projects/.../memory/` | `peaks memory ingest`（源只读，绝不写 `~/.claude/`）+ SKILL.md 明确单一权威 |
| ② | **索引漂移**：303 个顶层 .md 里 78 个不在索引 | 12 个完全符合契约却漏 | `peaks memory reindex` + **修共享解析器** |
| ③ | **调取静态**：`fetchBlock(_taskTitle)` 参数**完全没用** | warm 131 条从不进 preflight | 按任务排序 + hot/warm 分层 + 三重预算（条数/字节/时间） |
| ④ | **健康检查空转**：只查"index.json 是合法 JSON" | 报 ok 但 46% 文件不可见 | 新增 coverage / orphans / unclassified |

## 补强（第二轮）

- **kind 词表 8 → 21**：语料实际用了 13 个未登记的 kind（`bug`/`investigation`/`technical-pattern`/`project-rule`/`design`/`handoff`/`session-handoff`/`project-todo`/`publish-closure`/`project-closure`/`slice-closure`/`slice-pilot-findings`/`sediment`）。单一常量驱动解析/索引/CLI/doctor。
- **name 解析回退**：`name → title → 文件名`；重名冲突上报不覆盖。
- **`peaks memory rotate`**：A/B 层永不入选（测试断言）、C 层满 **6 个月**未钉 → 归档、D 层 → 报告待删（不删）、每候选先过 `src/`+`skills/` 引用 grep。默认 dry-run。
- **应用 reindex**：索引 231 → 276，`MEMORY.md` 从手工 116 条改为自动生成 276 条（kind 分组 + do-not-edit 横幅）。

## Lesson 1 — 静默丢弃比报错危险

**现象**：解析器只认顶层 `type:`，契约却是 `metadata.type`。30 个按正确契约写的文件被**无声跳过**，无人知晓。

**How to apply**：任何"按契约过滤"的解析器，遇到不认识的值必须**产出清单**（本次 reindex 输出 `unclassified`），不能静默 continue。

## Lesson 2 — 修根因要修共享层，不是调用点

**现象**：只改 reindex 不够——`readMemoryIndex` 的 mtime 守卫会在下次写记忆时把索引改回去，漂移复现。

**How to apply**：判断修复点要问"谁会再犯同样的错"；共享解析器/守卫层才是根治点。

## Lesson 3 — 参数不用，等于功能不存在

**现象**：`fetchBlock(_taskTitle)` 的下划线前缀就是"未使用"信号，但没人处理 → 检索永远静态。

**How to apply**：grep 带下划线前缀的未使用参数，它们常是"设计做了、实现没接"的残留。

## Lesson 4 — 检索要分层 + 按需，不要整体注入

**参考**：TencentDB Agent Memory（L0→L1→L2→L3 + 条数/字符/超时三重预算）、Karpathy "LLM Wiki"（索引先读、lint 孤儿页、ingest 触碰多页）。

**How to apply**：注入默认只给**紧凑索引行 + 路径**，正文按需 `Read`；预算三重（条数/字节/时间），不是单一 token 上限。

## Lesson 5 — 政策写了不等于机制存在

**现象**：`2026-07-24-sediment-pruning-policy.md` 定义了 4 层处置规则，但原文自认 "`peaks memory rotation` ... does not yet exist"。同期条目从 199 涨到 318（+60%，7 周）。

**How to apply**：治理政策必须配一个**可执行入口**，否则只是文档；盘点时优先找"有 policy 无 CLI"的缺口。

## Lesson 6 — 删文件前必须做引用检测

**现象**：42 个"无 kind"文件里 **23 个正被 skills/ / src/ / 其它记忆引用**（含刚改过的治理政策、Tier-A 定位文档）。

**How to apply**：任何删除候选先 `grep -rl` 全仓（含 `.peaks/memory/` 内部的 `[[wiki-link]]`）。本次检测脚本还踩了 CRLF 坑（Python 在 Windows 写 `\r\n`，导致逐个匹配全失败，只有末行命中）——**检测脚本本身也要自检**。

## 反模式（不要做）

- 不要在 peaks-code 工作流里把"沉淀记忆"只写进 IDE 侧记忆目录。
- 不要让解析器静默跳过不符合契约的文件。
- 不要把记忆正文整体注入派发提示词。
- 不要只用"JSON 合法"当记忆健康标准。
- 不要在没有引用检测的情况下删除记忆文件。
