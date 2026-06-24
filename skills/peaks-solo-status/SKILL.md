---
name: peaks-solo-status
description: Show the current state of the peaks-solo orchestrator in a compact summary. Use when the user says "what's the current state", "现在到哪了", "where are we", or invokes `/peaks-solo-status` directly. Reads the existing CLI primitives (`peaks skill presence`, `peaks session list`, `peaks project dashboard`, `peaks request show`) and renders a 1-screen status table. Triggers on `/peaks-solo-status`, "现在到哪了", "what is the current state", "show me the dashboard", "where are we".
---

# Peaks-Cli Solo Status (wrapper)

Peaks-Cli Solo Status is a thin wrapper that renders a compact status table for the current peaks-solo orchestrator state. It is the answer to "I just want to know where we are" — no PRD, no RD, no QA, no full peaks-solo orchestration. Just read the existing CLI state and render a 1-screen summary.

**This is a transparent wrapper.** The user does not stay in this skill — the status table is rendered, and control hands off (back to the user, or to `peaks-solo` if the user wants to act on the status).

## Skill presence (MANDATORY first action)

```bash
peaks skill presence:set peaks-solo-status --project <repo> --mode <mode> --gate startup
peaks project memories --project <repo> --json  # load durable memory
```

## Step 1: Read the current state

Use only existing CLI primitives (no new commands). **Important contract note**: `peaks session list` does NOT support `--project` (verified by dogfood 2026-06-04); it returns all sessions globally. To scope to the current project, read `.peaks/.session.json` for the bound `sessionId`, then use `peaks session info <sid>` for the bound session's full state, and filter `peaks session list` output by `projectRoot` to find other sessions in the same project.

```bash
# 1. Active skill presence
peaks skill presence --json

# 2. The bound session id (from .peaks/.session.json — local read, no CLI)
sid=$(cat .peaks/.session.json | python3 -c "import sys,json; print(json.load(sys.stdin)['sessionId'])")

# 3. The bound session's full state
peaks session info "$sid" --json

# 4. All sessions globally (then post-filter to current project)
peaks session list --json
# Note: this returns all sessions across all projects; the wrapper filters by
# matching `projectRoot` against the bound session's `projectRoot` to show only
# the sessions for THIS project. Sessions from other projects are ignored.

# 5. Per-request role state (PRD / RD / QA / TXT for the bound project)
peaks project dashboard --project <repo> --json

# 6. Per-request detail (if a specific rid is in flight)
peaks request show <rid> --role rd --project <repo> --json
peaks request show <rid> --role qa --project <repo> --json
```

All 6 calls are read-only. Total cost: sub-second. (The original draft said "5 calls"; the corrected count is 6 because the post-filter step is now explicit.)

## Step 2: Render the status table

Compact 1-screen format:

```
=== peaks-solo status ===
Session:   2026-06-04-session-b60252
Active:    peaks-solo (mode: full-auto, gate: qa-validation)
Workspace: /Users/yuanyuan/.../peaks-cli/.peaks/2026-06-04-session-b60252

| Role | State          | Artifact                |
|------|----------------|-------------------------|
| PRD  | handed-off     | prd/requests/003.md     |
| RD   | qa-handoff     | rd/requests/003.md      |
| QA   | running        | qa/requests/003.md      |
| TXT  | (not started)  | -                       |

QA verdict: pending
Last activity: 2026-06-04T17:00:00.000Z (12 min ago)
Standards: 5/5 existing (no delta)
Health: skill-doctor 35/35 pass
```

If the session is fresh (no in-flight slice), render a different layout:

```
=== peaks-solo status ===
Session: 2026-06-04-session-b60252
Active:  peaks-solo (mode: full-auto, gate: startup)
Workspace: /Users/yuanyuan/.../peaks-cli/.peaks/2026-06-04-session-b60252

No in-flight slice. Ready for a new request.
Health: skill-doctor 35/35 pass
```

## Step 3: Ask the user what to do next

| Option | What it does |
|---|---|
| Continue from the current gate | Hand off to `peaks-solo` with the gate already at the current state. Existing artifacts are preserved. |
| Open a new slice in this session | Keep the workspace, treat the current request as a new slice (new `rid`). |
| Just summarize and exit | No further action; the user will decide later. |

## Step 4: Hand off (if user picked option 1 or 2)

Re-assert `peaks-solo` presence so the status header reads correctly for the rest of the run:

```bash
peaks skill presence:set peaks-solo --project <repo> --mode <mode> --gate <matching-gate>
```

Then yield control.

## Hard rules (do NOT skip)

- **Never write to `.peaks/_runtime/<sid>/`.** This skill is read-only on the workspace; it only reads existing CLI state.
- **Never add a new `peaks <cmd>`.** Use only the existing read-only CLI primitives: `peaks skill presence`, `peaks session list`, `peaks session info`, `peaks project dashboard`, `peaks request show`. **Note**: `peaks session list` does not support `--project`; filter its output by `projectRoot` post-hoc.
- **Never auto-progress the workflow.** The status table is informational only. The user chooses what to do via `AskUserQuestion`. Never silent about what comes next — always present the 3 options.
- **Never expose sensitive data in the table.** Do NOT include full PRD bodies, full tech-doc bodies, or any test code in the table. Just state names, paths, and counts.

## Anti-patterns (do NOT do)

- Do NOT run `peaks workspace init` on the real session. The wrapper is read-only.
- Do NOT run `peaks request transition` (would change state). The wrapper is informational only.
- Do NOT write the status to a file (e.g. `.peaks/_runtime/<sid>/status.md`). The user can see it in the chat; persisting it adds noise to the workspace.
- Do NOT block on slow CLI calls. The 5 read-only calls are sub-second each. If any takes >5s, fail fast and report the slow command.

## Cross-references

- The "drives a CLI on the user's behalf" pattern (mirror of `peaks-sop`) is the closest existing precedent.
- `peaks-solo-resume` (P2.1) and `peaks-solo-test` (P2.2) are the sibling wrappers. `peaks-solo-resume` focuses on workflow-state introspection + resume decision; `peaks-solo-status` is the broader 5-CLI snapshot. The two are complementary, not redundant.
- The "read 5 CLI primitives, render 1 table" pattern is intentionally minimal — the wrapper does NOT add a new status-introspection CLI command (would violate the dev-preference.md "default-no on new CLI" rule).
