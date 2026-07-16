---
name: 2026-07-16-claude-code-subagent-display-recycle-observation
description: Claude Code harness shows sub-agent list in main view but does NOT auto-recycle completed ones within a session. Recycling happens only on session reset/new turn. This is harness-level behavior, not a peaks-loop regression. No code fix needed; user observation sedimented for future awareness.
metadata:
  type: feedback
  date: 2026-07-16
  sessionId: 2026-07-16-session-651c20
  source: user observation (squabbyZ)
  targetRelease: 4.0.0-beta.11
  scope: harness-level / non-actionable
---

# Claude Code sub-agent display recycle — observation (NOT a fix)

**Date:** 2026-07-16
**Session:** 2026-07-16-session-651c20
**Source:** user observation
**Type:** harness-level behavior (not a peaks-loop bug)

## What the user observed

After dispatching 5 sub-agents (RD / QA / implementer for Slice 2; RD / QA / implementer for Slice 3; plus a re-dispatched RD), all of them completed (their artifacts landed, their tasks fired `<task-notification>` completion events). However, the Claude Code main view continued to show the sub-agent list (the 5 "rows" indicating completed sub-agents were still visible).

The user noted: **"sub-agent 都运行完了, 但是没有立即回收掉"** (sub-agents all finished running, but weren't immediately recycled).

The user then observed: **"现在已经回收了, 刚才是运行完没有回收"** (now they've been recycled; just now they weren't after completion).

## Root cause (confirmed)

Claude Code harness displays sub-agent state for the duration of a conversation/turn. Recycling happens on:
- Session reset (new conversation)
- New turn boundary (when the user sends the next message)

NOT on:
- Sub-agent task-notification completion event
- Internal LLM logic

This is a **harness-level UI lifecycle decision**, NOT a peaks-loop bug. The dispatch records at `.peaks/_sub_agents/<sid>/dispatch-*.json` and `active-dispatches.json` do get their `outcome: "completed"` set, but the harness view doesn't observe that state for display lifecycle.

## Why this isn't actionable

- **Out of peaks-loop scope:** the sub-agent display is rendered by Claude Code itself, not by peaks-loop. peaks-loop only writes the dispatch record (which it does correctly).
- **No `peaks` CLI fix possible:** there's no peaks-loop command that can force Claude Code to refresh its sub-agent view.
- **Behavior is acceptable:** the user can see completion state via the artifact paths + the `<task-notification>` events; the visual "stuck row" is a UI presentation choice, not a functional problem.

## Why this sediment exists

If a future session/user notices the same pattern, this sediment saves them 30-60 minutes of:
1. Searching for a `peaks sub-agent cleanup` or `peaks sub-agent dispose` command (doesn't exist).
2. Reading `peaks sub-agent` CLI help looking for a recycle primitive (none).
3. Manually editing `active-dispatches.json` to remove completed entries (would be wiped by harness on next turn anyway).
4. Filing a "bug" against peaks-loop for a non-bug.

## How to apply

- **If you see completed sub-agents still listed:** don't try to fix it. The next user turn / session reset will recycle them. This is normal.
- **If you want a real "dispose" command for peaks-loop:** that would require a new CLI primitive + harness integration. Out of scope for any current slice.
- **The `.peaks/_sub_agents/<sid>/` directory** (with `dispatch-*.json` + `batch-*.counter.json` + `active-dispatches.json`) is intentional state. Don't `rm -rf` it; the harness may read from it on next turn.

## Related observations

- **D-014** (`2026-07-16-slice-3-rd-subagent-hang-sediment.md`): the dispatch record `status: queued` persists throughout execution; the real signal is `stat -c '%Y' <artifact-path>` vs `dispatch.createdAt`. Different angle but related — both about sub-agent lifecycle observability.

## Hard rule (new)

- **D-017 (NEW):** Claude Code harness does NOT auto-recycle completed sub-agent rows in the main view within a session. Recycling happens on session/turn boundary only. **Do not waste cycles trying to fix this from peaks-loop.** Document the observation; move on.

How to apply: any future session noticing "stuck sub-agent rows" — read this sediment first, then proceed with the actual work. The recycling will happen naturally at the next user turn.