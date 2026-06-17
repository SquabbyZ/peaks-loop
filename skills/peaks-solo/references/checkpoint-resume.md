# Step 0.75: checkpoint resume — full probe + decision tree

## Mid-session resume

When a NEW conversation opens on a session whose `lastActivity` is from the
SAME date as today (within minutes/hours), the LLM should surface the most
recent checkpoint so the user can resume mid-session without losing context.

## When this step fires (resume)

Only when ALL of the following hold:

1. Canonical `<sessionId>` is bound (resolved via `peaks session info --active`).
2. `<sessionId>` lastActivity is from today's date (`YYYY-MM-DD` matches).
3. `lastActivity` time-of-day is recent (within minutes/hours, not days).
4. `.peaks/_runtime/<sessionId>/checkpoints/` contains at least one `*.json` file.

If any of these are false, Step 0.75 is a no-op and the skill proceeds to Step 1 (mode selection).

## Resume probe

```sh
sid=$(peaks session info --active --json | jq -r '.data.sessionId // empty')
[ -z "$sid" ] && exit 0
last=$(jq -r '.lastActivity // empty' ".peaks/_runtime/$sid/session.json" 2>/dev/null)
today=$(date -u +%Y-%m-%d)
[ "${last:0:10}" != "$today" ] && exit 0
latest=$(ls -1t ".peaks/_runtime/$sid/checkpoints/"*.json 2>/dev/null | head -1)
[ -z "$latest" ] && exit 0
echo "$latest"
```

## Resume decision tree

```
If a checkpoint path exists:
  LLM prompts the user via IDE-native ask_user_question:
    Q: "Resume from checkpoint <basename> (last saved <relative-time>)?
        1: resume (recommended), 2: start fresh."
  A1 -> peaks session resume --from <path> --project <repo>
        prepend the emitted markdown block to the skill's own prompt
  A2 -> ignore the checkpoint; proceed to Step 1

Else:
  proceed to Step 1 (mode selection)
```

## Resume CLI contract

`peaks session resume --from <path> [--project <path>] [--json]`

- Reads the checkpoint JSON at `<path>`.
- Emits a markdown "resume context" block on stdout (or in the `--json` envelope) listing the captured state: session id, captured at, last activity, reason, relative age, current plan, open questions, recent decisions, recent artifact paths, todo state, active skills, git status.

Alternative discovery when the caller does not have the path handy:

`peaks session resume --session-id <sid> [--project <path>]`

This resolves the latest checkpoint for the given `<sid>` automatically.

## Resume edge cases

- **No checkpoint dir**: Step 0.75 is a no-op; proceed to Step 1.
- **Multiple checkpoints**: use the latest by mtime (`ls -1t`).
- **Checkpoint JSON malformed**: CLI throws `SyntaxError`; treat as "no resume possible" and proceed to Step 1.
- **User picks "fresh" but session is recent**: honor the choice; the on-disk checkpoint stays untouched for the next invocation.

## Resume IDE note

This step is strictly IDE-agnostic. All checkpoint discovery goes through the peaks CLI.