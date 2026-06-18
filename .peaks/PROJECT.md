# Peaks Project Context

> Auto-generated project memory. Peaks reads this at the start of each session to understand
> the project's history, tech stack, conventions, and past decisions.
> Last updated: 2026-06-19T00:00:00.000Z

## Project: peaks-cli

## Conventions

- **`.peaks/` workspace underscore-prefix convention (since 2.8.0)** — any
  top-level segment under `.peaks/` whose name starts with `_` is **ephemeral**
  (gitignored by the single `.peaks/_*/` rule). Non-underscored segments are
  git-tracked source-of-truth. Two explicit exceptions are documented in
  `.gitignore`: `.peaks/runtime/` (typo guard) and `.peaks/preferences.json`
  (per-project user state). Full rule at
  `.peaks/memory/workspace-underscore-convention.md`.

<!-- peaks-managed:session-history-start -->

## Timeline (13 sessions)

| Date | Directory | Title | What |
|------|-----------|-------|------|
| 2026-06-17 | `2026-06-17-session-1baf0a` | Untitled | 把 karpathy-guidelines #1 Think Before Coding 和 #2 Simplicity First 从"s |
| 2026-06-16 | `2026-06-16-session-aaf8c7` | Untitled | PreToolUse:Bash hook error |
| 2026-06-15 | `2026-06-15-session-b86446` | qr-inline-display 2026-06-15 | Not applicable. CLI surface only; no pages / routes / components / sta |
| 2026-06-15 | `2026-06-15-session-e697b2` | Untitled | | Commit | What | Files | Insertions/Deletions | |
| 2026-06-14 | `2026-06-14-session-4bbc95` | Untitled | - |
| 2026-06-14 | `2026-06-14-session-2bc187` | cc-connect 集成 weixin 通道 | > **单切片 ≤800 行纪律**：每个切片必须跑 `peaks slice check` 全绿（tsc + vitest + 3-way |
| 2026-06-14 | `2026-06-14-session-b9ed3f` | Untitled | peaks-solo |
| 2026-06-13 | `2026-06-13-session-86d852` | Untitled | > **rid:** 2026-06-13-slice-decompose-impl |
| 2026-06-13 | `2026-06-13-session-3a3073` | Config 治理：激进清理 ~/.peaks/config.json 只留 v | | Library | Version | Scope | |
| 2026-06-13 | `2026-06-13-session-fefde6` | RD repair of 23 pre-existing test failur | > Required Gate A4 evidence. Compiled by peaks-solo orchestrator. SKIP |
| 2026-06-13 | `2026-06-13-session-1a3bd5` | 方向讨论：peaks-cli 痛点与多 agent 演进 | > Required Gate A2 evidence. Compiled by peaks-solo orchestrator after |
| 2026-06-13 | `2026-06-13-session-e961f3` | fix: 自愈 .claude-settings-template.json 缺 | 1. On a Mac (or any POSIX shell where `/bin/sh` does not auto-detect J |
| ? | `2026-06-11-session-edbe91` | Untitled | - |

<!-- peaks-managed:session-history-end -->
