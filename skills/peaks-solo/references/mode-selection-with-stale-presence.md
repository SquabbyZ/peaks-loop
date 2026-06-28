# Mode selection with stale presence (v2.15.0 slice 002)

> Companion to `mode-selection.md`. Read together — this file only
> covers the v2.15.0 stale-presence branch that prevents a previous
> session's mode from silently carrying over into a new session.

## Why this reference exists

Defect A (from PRD-002, 2026-06-28 session 88b27d):

1. session A runs in `full-auto` → `peaks skill presence:set peaks-solo --mode full-auto --gate startup` stamps
   `.peaks/_runtime/active-skill.json` with `outerSessionId=outer-A`.
2. session A closes (Claude window quit).
3. session B opens (a new Claude window, `outerSessionId=outer-B`).
4. `peaks skill presence:get --project <path>` still returns `mode=full-auto` because the file is on disk.
5. peaks-solo Step 1 reads the presence, sees `mode=full-auto`, **skips** AskUserQuestion.
6. The user never picked `full-auto` for THIS session — the mode was sticky from the previous one.

The fix: presence is only authoritative when its `outerSessionId` matches the current outer session. Otherwise Step 1 must re-ask.

## Detection protocol

Before deciding to skip Step 1's AskUserQuestion, the LLM driver (or any peaks-solo caller) MUST run:

```bash
peaks skill presence:check-stale --project <path> --json
```

The CLI returns a JSON envelope of shape:

```json
{
  "ok": true,
  "command": "skill.presence:check-stale",
  "data": {
    "stale": true,
    "reason": "outer-session-mismatch",
    "presence": { "skill": "peaks-solo", "mode": "full-auto", "outerSessionId": "outer-A", ... },
    "currentOuterSessionId": "outer-B",
    "recordedOuterSessionId": "outer-A"
  },
  "warnings": [],
  "nextActions": []
}
```

Reason codes:

| `reason` | Meaning | Step 1 action |
|---|---|---|
| `null` | presence exists and its `outerSessionId` matches the current outer session. | May reuse the recorded `mode` (or AskUserQuestion — the user's choice to skip is preserved either way). |
| `outer-session-mismatch` | presence exists but its `outerSessionId` does NOT match the current one. | AskUserQuestion — the previous session's mode is NOT authoritative for this session. |
| `no-presence` | no presence file on disk. | AskUserQuestion — fresh start, no prior choice recorded. |

## Optional companion flag: `presence --check-stale`

For callers that already use `peaks skill presence` to read the active skill, slice 002 adds `--check-stale`:

```bash
peaks skill presence --check-stale --project <path> --json
```

Returns the same `stale` / `reason` / `currentOuterSessionId` / `recordedOuterSessionId` fields attached to the standard presence envelope. Default `false` (back-compat).

## Pause integration via `peaks solo should-pause`

`peaks solo should-pause --step step-1-mode-select --mode <mode>` now consults `presence:check-stale` automatically. When stale:

```json
{
  "ok": true,
  "command": "solo.should-pause",
  "data": {
    "shouldPause": true,
    "reason": "stale-presence — re-ask Step 1 (recorded outer session id does not match current)",
    "gateKind": "mode-selection-itself",
    "logLine": "..."
  }
}
```

The hard-pause on `step-1-mode-select` is preserved for ALL modes (defect #1 fix from slice 2026-06-28-solo-mode-bypass-fix). Stale-presence is an additional reason — even when the user names a profile explicitly, peaks-solo can still surface the staleness for visibility.

## Auto-clear on session rotation

`peaks workspace init` now calls `clearStalePresenceOnRotation` whenever an `outer-session-mismatch` rotation fires. This means in the COMMON path (user reopens Claude → peaks-solo auto-runs `peaks workspace init` → rotation clears the stale presence → Step 1 reads no-presence → re-ask). The check-stale CLI is the safety net for the rare case where rotation was suppressed (`--no-rotate-on-outer-mismatch`).

The auto-clear respects two guards so it never destroys a user-explicit mode:

1. **Reconnect guard** — if the recorded outer id matches the CURRENT outer id, do NOT clear (the user just reconnected from the same Claude session after rotation).
2. **Live-different-outer guard** — if the recorded outer id belongs to a different LIVE outer session (e.g. another Claude window is also driving this project), do NOT clear (would destroy that user's explicit mode).

## Worked example (the 88b27d defect)

Session A: `peaks skill presence:set peaks-solo --mode full-auto` (outer A).
Session A closes. Session B starts (outer B).

```bash
# 1. Run init (the common entry into peaks-solo).
peaks workspace init --project . --json
# → auto-rotates session binding AND auto-clears stale presence
#   nextActions: ["Auto-cleared stale skill presence ..."]
#   data.rotation: { previousSessionId: "session-A", reason: "outer-session-mismatch" }

# 2. peaks-solo Step 1 (was: skip AskUserQuestion because presence.mode=full-auto).
# Now: presence is gone → no-presence → AskUserQuestion fires.

peaks skill presence:check-stale --project . --json
# → { stale: true, reason: "no-presence", presence: null }

peaks solo should-pause --step step-1-mode-select --mode full-auto --json
# → { shouldPause: true, reason: "step=step-1-mode-select is a mode/context-selection step → always pause" }

# 3. User picks a profile (or repeats "full-auto"). Then:
peaks skill presence:set peaks-solo --mode full-auto --gate startup
# → re-stamps with outer=B. Future sessions that read this presence
#   see outerSessionId=outer-B matching THEIR outer=B → not stale.
```

## ACL — what NOT to do

- **NEVER** skip Step 1 just because `.peaks/_runtime/active-skill.json` shows a `mode` field. Run `presence:check-stale` first.
- **NEVER** call `peaks skill presence:clear` from peaks-solo to "fix" a stale mode. The auto-clear path is `peaks workspace init`'s job; manual clears destroy user-explicit mode choices that may belong to another live outer session.
- **NEVER** set the presence `mode` field from inside a sub-agent (peaks-rd, peaks-qa, etc.). Sub-agents may read presence to honour the user's chosen mode but the write authority for Step 1 belongs to the peaks-solo driver.
