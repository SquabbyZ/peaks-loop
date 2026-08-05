# Peaks Project Context

> Auto-generated project memory. Peaks reads this at the start of each session to understand
> the project's history, tech stack, conventions, and past decisions.
> Last updated: 2026-08-05T08:18:53.697Z

## Project: peaks-loop

## Conventions

- **`.peaks/` workspace underscore-prefix convention (since 2.8.0)** — any
  top-level segment under `.peaks/` whose name starts with `_` is **ephemeral**
  (gitignored by the single `.peaks/_*/` rule). Non-underscored segments are
  git-tracked source-of-truth. Two explicit exceptions are documented in
  `.gitignore`: `.peaks/runtime/` (typo guard) and `.peaks/preferences.json`
  (per-project user state). Full rule at
  `.peaks/memory/workspace-underscore-convention.md`.
- **Top-level `.peaks/_runtime/<YYYY-MM-DD-*>/` is forbidden (effective 2.8.3)** —
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
  `tests/unit/workspace/top-level-change-id-guard.test.ts` (8 cases
  including CLI help-text + sibling-dir-shape assertions) fails CI on
  regression; (3) source-code redirect in
  `src/services/workspace/workspace-service.ts` — `initWorkspace` uses
  `lstatSync` to refuse legacy sibling dirs
  (`LegacyChangeIdSiblingError`); (4) `CLAUDE.md` "Hard ban" section
  tells future AI sessions never to create the pattern. Originating
  incident: a 2.8.0-era `peaks workspace init --change-id ...` flow left
  a 4-file orphan at
  `.peaks/2026-06-22-cc-connect-orphan-cleanup/`, root-caused + fixed in
  slice `2026-06-22-top-level-change-id-cleanup` (commits `7373f81`,
  `d557ed8`, `f18a518`, `bc0423d`, plus audit followup). The change-id
  axis was fully removed in slice `2026-06-29-change-id-root-removal`.
  See `.peaks/memory/2026-06-22-top-level-change-id-cleanup.md` for the
  full audit trail + the 13 audit findings remediation.

<!-- peaks-managed:session-history-start -->

## Timeline (20 sessions, showing last 15)

| Date | Directory | Title | What |
|------|-----------|-------|------|
| 2026-08-04 | `2026-08-04-session-3fe1be` | Untitled | request: 2026-08-04-statusline-session-id-fix |
| 2026-08-04 | `2026-08-04-session-70ff1e` | Untitled | peaks-code |
| 2026-08-04 | `2026-08-04-session-139b31` | Untitled | statusline 当前实现（4.0.9）有 2 个独立的 user-reported 问题： |
| 2026-08-03 | `2026-08-03-session-1b6cf3` | Untitled | 对 RD 产出的两份 deliverable 做 **4 维验收**: |
| 2026-08-03 | `2026-08-03-session-bee258` | Untitled | ROLE: hotfix sub-agent for peaks-loop 4.0.8 — fix production ESM repro |
| 2026-08-01 | `2026-08-01-session-410315` | Untitled | Primary statusline reads and lifecycle transition writes. |
| 2026-07-31 | `2026-07-31-session-84c3da` | Untitled | requestId: 2026-07-31-rid-mac-transcript-estimate-trigger |
| 2026-07-30 | `2026-07-30-session-602e5c` | 测试体系从零重建 (epic) | peaks-code |
| 2026-07-28 | `2026-07-29-session-a84955` | Untitled | schemaVersion: 2 |
| 2026-07-28 | `2026-07-28-session-71a3cf` | Untitled | G1. 产出 **1 份用户视角的功能地图**，覆盖 5 大域 + 13 skill + 5 super-command + 14 后置 s |
| 2026-07-27 | `2026-07-28-session-22381b` | Untitled | rid: 2026-07-28-rid-020b-24h-mode-integration-verify |
| 2026-07-27 | `2026-07-28-session-6984fe` | rid-018-019 4.0.0 GA pre-publish BLOCKER | PASS: body non-empty for 4.0.0 (2560 bytes) |
| 2026-07-27 | `2026-07-27-session-507e95` | 完成 monorepo 发布代办 | requestId: rid-016 |
| 2026-07-27 | `2026-07-27-session-b4e485` | Untitled | - |
| 2026-07-26 | `2026-07-26-session-0e9141` | Phase 2 编排层治理 | schemaVersion: 1 |

<!-- peaks-managed:session-history-end -->
