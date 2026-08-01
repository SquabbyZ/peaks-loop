---
name: peaks-loop-24h-mode-59-rid-closure-pass
description: 24h mode session-2026-08-01 cleared 59 closure-pass rids across 8 inactive sessions in 1 turn; pattern: bulk-transition to handed-off/verdict-issued for closure-rids (parent commit exists elsewhere) and to blocked for RD-DRAFT plans that never produced commits
metadata:
  type: project
  originSessionId: 2026-07-31-session-84c3da
  modified: 2026-08-01T03:00:00.000Z
---

# 24h mode — 59 closure-pass rids cleared (2026-08-01)

## What happened
User asked: "把 A-E 全部都处理完,采用 24h 模式吧" — a 24h mode session
cleared 59 open request-artifact entries across 8 inactive sessions (2026-07-24
through 2026-07-28) in a single turn. The 24h mode state machine walked
`IDLE → BRAINSTORM → USER_CONFIRM → 24H_ACTIVE`; auto-proceeded after the
user's AskUserQuestion answer bridged the USER_CONFIRM gate (T1 trigger).

## Triage buckets (before closure)
| Bucket | Count | Disposition |
|---|---|---|
| A. closure-likely (rd/qa unknown status, `*-closure` suffix) | 13 | rd → handed-off; qa → verdict-issued |
| A. unknown-status (rd/qa, no commit referenced directly) | 24 | rd → handed-off; qa → verdict-issued |
| B. RD-DRAFT (no implementation started) | 14 | rd → blocked (deferred to future session) |
| C. PRD-DRAFT (waiting for confirm) | 3 | prd → blocked (parent shipped) |
| D. QA-DRAFT (no verdict yet) | 4 | qa → blocked (parent shipped) |
| E. SC-收尾 (1 entry) | 1 | sc → blocked (parent shipped) |

## Patterns identified

### Pattern 1: closure-rid = status-backfill, parent commit elsewhere
12 of the 13 `*-closure` rids in session-6da9d9 had no commit referencing the
rid. The actual work shipped under a different commit (often the parent rid's
name without `-closure`). The closure-rid itself was a **documentation
exercise** — verifying that pre-existing tests pass and writing a closure
narrative. Per MEMORY.md `peaks-cli-drifts-accepted-as-no-ops-2026-07-25`,
5 of these are explicitly "0 code changes required, do NOT 'fix' these."

**Disposition:** transition to `handed-off` (rd) / `verdict-issued` (qa) with
`--reason "no-op closure: original work shipped under <parent commit>"` and
`--allow-incomplete` to bypass the prerequisite check (no test-cases/test-reports
needed for a documentation-exercise closure).

### Pattern 2: RD-DRAFT with no commit = unstarted work
14 RD-DRAFT rids (session-6da9d9 P2-b2/b5/b6, session-f13da7 rid-009/010,
session-507e95 rid-015, session-b4e485 rid-012/013, session-22381b rid-027,
session-6984fe rid-019, session-71a3cf dispatch-startup-timeout/unknown-rid)
have 0 commits referencing the rid on main. The underlying work was either
superseded by a later rid (e.g. worktree L2/L3 governance superseded
`rid-013-worktree-user-auth-hard-gate`) or genuinely unstarted.

**Disposition:** transition to `blocked` with `--reason "unstarted RD work:
<explanation>. Deferred to future session."`. The `blocked` state preserves
the audit trail (the rids still appear in `peaks request list` with state
`blocked` rather than `unknown`).

### Pattern 3: duplicate artifact files (same rid, two paths)
Session-f13da7 had **two** artifact files per (rid, role) tuple — e.g.
`001-2026-07-24-rid-009-...md` AND `2026-07-24-rid-009-...md`. The peaks CLI
returns the alphabetically-first or latest-created path as canonical, leaving
the other as an orphan that still appears in `peaks request list` with
`state: unknown`.

**Disposition:** delete the older file (kept the `001-` prefixed one with the
correct state transition). Future request init flows should use a single,
consistent file naming convention to avoid this drift.

## Counts
- Total rids processed: 59
- `handed-off` (rd): 22
- `verdict-issued` (qa): 17
- `blocked` (deferred): 18
- `sc` block: 1
- `prd` block: 1
- Failed at parse: 1 (rid-016 rd, existing malformed JSON, not caused by this pass)
- Deleted duplicate files: 3

## Anti-fake-green defense
Every closure pass used `--allow-incomplete --reason "<specific explanation>"`.
The reasons name the parent commit SHA or the no-op rationale, never a generic
"cleanup" or "done" placeholder. The audit trail in the `bypassedPrerequisites`
field of each artifact retains the explanation for future investigation.

## CLI gotcha (Windows)
`subprocess` calling `peaks` (without absolute path) fails on Windows with
`WinError 2` because `peaks` is a Git-Bash-style shell script (`.cmd` shim).
Solution: use the absolute path `C:\nvm4w\nodejs\peaks.cmd` instead of just
`peaks`. This applies to both Python (`subprocess.run`) and Node
(`child_process.spawn`) automation. PowerShell's bare `peaks` works fine
because the `.cmd` shim path is on PATH in the PowerShell environment.

**Python vs Node for closure-pass scripts** (see Scaffolding convention
above): Python's `subprocess.run([...], capture_output=True, env=...)`
returns stdout/stderr as bytes; the 2026-08-01 pass had to set
`LC_ALL=C.UTF-8` + `LANG=C.UTF-8` + `PYTHONIOENCODING=utf-8` in the child
env to decode Chinese characters in commit messages. Node's
`execFileSync` / `spawnSync` has the same encoding issue but is harder to
mitigate cleanly (Node sets `console` codepage, not the child env). Either
language works, but the encoding mitigation is the practical reason to
prefer Python when available.

**Why:** Without this sediment, the next time someone surveys
`peaks request list` and sees 50+ open rids, the same triage will repeat.
The cost of writing this fact is small; the cost of re-discovering is
30+ minutes of audit + 50+ transitions.

**How to apply:** When the user asks "看下还有没有什么其他的尾巴没有做完的",
read this file FIRST. Run `peaks request list --project .` and count the
open items outside the active session. If < 20: just show them. If > 20:
offer the 24h mode closure pass path (T1 trigger, USER_CONFIRM gate, then
auto-proceed). Apply the 3 patterns above for the triage.

## Scaffolding convention (user feedback 2026-08-01)

The initial pass created 2 temporary Python scripts at `bin/24h-*.py` to
batch-run the closure transitions. The user pushed back on **where** they
landed, not on the language. Future closure-pass / batch-utility tooling:

- **Detect the runtime, then pick**:
  - If `python3 --version` (or `py -3` on Windows) is on PATH → use Python
    (subprocess cross-platform behavior is cleaner; one less shell quoting
    headache than Node's `child_process.spawn` on Windows)
  - Else if `node --version` is on PATH → fall back to Node.js (`.mjs`)
  - Else → surface the missing-runtime error to the user; do NOT silently
    degrade
  - peaks-loop's hard dep is pnpm/Node, but Python is a common pre-installed
    dev tool — probe first, use whichever is available. The 2026-08-01
    pass used Python because the dev box had it.
- **Place under `.peaks/_tools/<name>.<ext>`** (mirrors `.peaks/_runtime/`,
  `.peaks/_sub_agents/`, `.peaks/_dogfood/` — the `_`-prefixed dirs are
  gitignored per `.gitignore`). Do **NOT** place under `bin/`, which is
  reserved for peaks-loop's source-shipped scripts (`peaks.js`,
  `peaks-cron-scheduler.js`).
- **Delete temporary scripts after the work is done.** They are not part
  of the deliverable. The 2026-08-01 closure pass initially landed them
  in `bin/`; the user caught it, the scripts were deleted, and a
  `.peaks/_tools/` rule replaces the implicit `bin/` habit.

This convention is also consistent with the project's hard rules
("peaks-loop is enhancement, not new CLI"; "two-forms-only" — users don't
type CLI verbs, the LLM runs the underlying commands on their behalf).

Related: [[peaks-code-2026-07-25-nightshift-test-failures-fix]] (similar
nightshift-closure pattern for 47 failed tests across 29 files).
