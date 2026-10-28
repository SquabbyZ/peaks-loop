# Peaks Project Context

> Auto-generated project memory. Peaks reads this at the start of each session to understand
> the project's history, tech stack, conventions, and past decisions.
> Last updated: 2026-10-28T14:05:39.837Z

## Project: peaks-loop

## Conventions

- **`.peaks/` workspace underscore-prefix convention (since 2.8.0)** — any
  top-level segment under `.peaks/` whose name starts with `_` is **ephemeral**
  (gitignored by the single `.peaks/_*/` rule). Non-underscored segments are
  git-tracked source-of-truth. Two explicit exceptions are documented in
  `.gitignore`: `.peaks/runtime/` (typo guard) and `.peaks/preferences.json`
  (per-project user state). Full rule at
  `.peaks/memory/workspace-underscore-convention.md`.
- **Top-level `.peaks/<YYYY-MM-DD-*>/` is forbidden (effective 2.8.3)** —
  session-id artifacts MUST live under `.peaks/_runtime/<sid>/`
  (gitignored). Never as siblings of `.peaks/_runtime/`. **Path
  distinction** (post-`2026-06-29-change-id-root-removal`): the
  change-id is metadata-only — reviewable artifacts (RD/QA/PRD) live at
  `.peaks/_runtime/<sid>/<role>/requests/<rid>-<change-id>.md` and the
  change-id appears only as a filename slug. There is no longer a
  binding file at `.peaks/_runtime/current-change`. **Four layers of
  enforcement**: (1) root `.gitignore` rule
  `.peaks/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/` blocks untracked
  writes; (2) vitest guard at
  `tests/unit/workspace/top-level-change-id-guard.test.ts` (8 cases —
  `git check-ignore` on the rule, the live working tree + index, the
  `initWorkspace` refusal, and the two ban documents) fails CI on
  regression; (3) source-code redirect in
  `src/services/workspace/workspace-service.ts` — `initWorkspace` uses
  `lstatSync` to refuse legacy sibling dirs
  (`LegacyChangeIdSiblingError`); (4) `AGENTS.md` "Hard ban" section
  tells future AI sessions never to create the pattern. Originating
  incident: a 2.8.0-era `peaks workspace init --change-id ...` flow left
  a 4-file orphan at
  `.peaks/2026-06-22-cc-connect-orphan-cleanup/`, root-caused + fixed in
  slice `2026-06-22-top-level-change-id-cleanup` (commits `7373f81`,
  `d557ed8`, `f18a518`, `bc0423d`, plus audit followup). The change-id
  axis was fully removed in slice `2026-06-29-change-id-root-removal`.
  See `.peaks/memory/archived/2026-06-22-top-level-change-id-cleanup.md`
  for the full audit trail + the 13 audit findings remediation.

<!-- peaks-managed:session-history-start -->

## Timeline (27 sessions, showing last 15)

| Date | Directory | Title | What |
|------|-----------|-------|------|
| 2026-10-28 | `2026-10-28-session-2ffed0` | Untitled | peaks-prd |
| 2026-10-26 | `2026-10-26-session-fb8cc6` | Untitled | > **日期**：2026-10-28 |
| 2026-10-25 | `2026-10-25-session-267981a1` | Untitled | **「单测时长会超长」不是将来可能发生的风险，而是已经发生、且可预测的线性增长。** |
| 2026-10-23 | `2026-10-23-session-5e40e0` | Untitled | (body) instead of `CLAUDE.md` (pointer) |
| 2026-10-23 | `2026-10-23-session-2bd220` | Untitled | - |
| 2026-10-23 | `2026-10-23-session-d8c6a8` | Untitled | - |
| 2026-10-22 | `2026-10-22-session-b0e6e2` | Untitled | N/A — no perf surface. The slice adds a GATE, not a hot path: nothing  |
| 2026-10-20 | `2026-10-20-session-f7f45b` | 刷新codegraph索引并总览项目功能 | N/A — no perf surface. Pure verbatim module extraction, no behavior ch |
| 2026-10-20 | `2026-10-20-session-c620de` | 修 macOS CI 探针超时 | | 检查 | 命令 | 结果 | |
| 2026-10-20 | `2026-10-20-session-a545d0` | 生产依赖升版与适配 | peaks-code |
| 2026-10-19 | `2026-10-19-session-94b084` | Step 0.8 gate remedy exemption | peaks-code |
| 2026-10-18 | `2026-10-18-session-dedff6` | 硬化 backCompatUntil 过期窗口 | Started 2026-10-19 after the user asked for 24h mode and full backlog  |
| 2026-10-18 | `2026-10-18-session-0e1a6c` | 项目功能整体评测 | > 评测对象：`D:\projects\peaks-loop` @ `0b30c497`（v4.1.6） |
| 2026-10-15 | `2026-10-15-session-172124` | Untitled | Role: peaks-perf-audit (independent). HEAD `dd697a08`, change staged + |
| 2026-10-14 | `2026-10-15-session-060d3b` | Untitled | - |

<!-- peaks-managed:session-history-end -->
