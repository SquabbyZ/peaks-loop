---
name: memory-extract-filename-comes-from-title-use-english-kebab
description: memory-extract-filename-comes-from-title-use-english-kebab
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff-4-0-45.md
---

`peaks memory extract` 用 frontmatter 的 `title:` 生成文件名。中文 `title`（如「按 AC 全过收工会让…」）会被削成 `ac-ac-ac.md`、`bug.md`、`gate.md` 这类碎片。

**Why:** slug 生成器只保留 ASCII，中文字符被整体丢弃后只剩下零星拉丁片段或空串，落盘名字完全不可检索。更麻烦的是这些文件落在 **git 跟踪** 的 `.peaks/memory/` 目录里，坏名字会直接进入仓库、需要手动改名才可用。

**How to apply:** `title:` 一律写**英文 kebab-case**，正文用中文不受影响。若已经产生了碎片名，需要三件事一起做：改文件名 + 同步文件内的 `name:` 字段 + 跑 `peaks memory reindex --apply`。写完 artifact 后**先自检**：start/end 标记数量相等、每块都有 `title` + `kind`、`peaks memory extract ... --dry-run --json` 返回 `extractedCount ≥ 1` 且 slug 可读。
