---
title: MEMORY.md ghost sediment drift — finding 2026-07-27
kind: sediment
---
# MEMORY.md ghost sediment drift — finding 2026-07-27

## TL;DR

Prior auto-memory 在 system prompt 中引用 3 个 sediment 文件名,但这些文件**从未被创建或已被删除**,且 `MEMORY.md` index 也没有它们的 entry。漂移**只在 conversation context 层**,不在 project repo 真实状态。

## 3 个 ghost 文件

| 引用文件名 | disk 状态 | git history 状态 | MEMORY.md index |
|---|---|---|---|
| `peaks-stale-cli-version-2026-07-23-diagnosis.md` | ❌ 不存在 | ❌ 不存在 | ❌ 未索引 |
| `peaks-unpublish-4-0-0-and-4-0-2-stuck.md` | ❌ 不存在 | ❌ 不存在 | ❌ 未索引 |
| `peaks-4-0-0-beta-20-icecola-surface-check-2026-07-22.md` | ❌ 不存在 | ❌ 不存在 | ❌ 未索引 |

## 验证命令

```bash
find .peaks -name 'peaks-stale-cli*' -o -name 'peaks-unpublish*' -o -name 'peaks-4-0-0-beta-20*'  # → 0 matches
git log --all --diff-filter=D --name-only --pretty=format: -- '.peaks/memory/peaks-stale-cli*' '.peaks/memory/peaks-unpublish*' '.peaks/memory/peaks-4-0-0-beta-20*'  # → 0 matches
grep -n 'peaks-stale-cli-version-2026-07-23\|peaks-unpublish-4-0-0-and-4-0-2\|peaks-4-0-0-beta-20-icecola' .peaks/memory/MEMORY.md  # → 0 matches
```

## 来源推测

Prior session 中 LLM 可能在 auto-memory 中描述了 "五层根因 sediment" / "4.0.2 published sediment" / "icecola surface check sediment" 等条目,但实际文件写入动作未完成或被清理。`peaks-cli-version-shared-chicken-egg.md`(真实存在)是其中"五层根因"的核心 carrier,summarizes 其他 2 个 ghost 文件本应承载的内容。

## 影响评估

- **无功能性影响** — project repo 是 source of truth,auto-memory drift 不影响代码或 CLI 行为
- **有 LLM context 误导风险** — future session LLM 可能基于 auto-memory 尝试 `Read` 这 3 个文件,得到 "No such file or directory",造成感知错误
- **有治理 noise** — phase 收尾 sediment 中多次提及 "ghost drift 仍待清理",实际无 cleanup action

## 修复路径(已执行)

- **MEMORY.md index 不动** — 已经 0 ghost entries
- **disk 不动** — 3 个文件不存在,无 cleanup 可做
- **auto-memory refresh** — 取决于 Claude Code harness 的 auto-memory refresh 机制(LLM 不能直接编辑)
- **本 sediment** — 唯一新文件,记录 finding + 验证命令 + 影响评估

## Why this sediment exists

Phase 4 治理 session 收尾时,本 sediment 提供 explicit 证据:
1. 3 ghost 文件在 disk/git/MEMORY.md 三处都不存在
2. 漂移是 context-layer auto-memory 问题,非 project repo 问题
3. 无 actionable cleanup 项目

未来 phase 收尾不再需要重复这一 finding。

## How to apply (future iterations)

当未来 session auto-memory 中再次出现 ghost file 引用:
1. **不要创建 placeholder 文件** — placeholder 会引入新的 drift
2. **不要修改 auto-memory** — LLM 不能直接编辑 system prompt context
3. **verify disk/git/MEMORY.md 三处都不存在** — 跑上面 3 个 grep 命令确认
4. **写一条 finding sediment** — 显式记录 "auto-memory drift, repo clean" 状态
5. **不再作为 outstanding work 项** — 因为无可 cleanup action

## 后续事项

- Phase 1/2/3/4 governance 全部 closeout(rid-001/003/004/005/006/007/008/009/010/011)
- Phase 4 governance sediment `rid-001-envelope-closure-closeout.md` + `rid-003-coverage-tooling-closeout.md` 已 landed
- 本 sediment 是 Phase 4 治理收官的最后一项无-action drift finding