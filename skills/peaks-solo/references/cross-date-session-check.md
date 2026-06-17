# Step 0.5: cross-date session check — full probe + decision tree

## Cross-date detection

Before invoking `peaks workspace init`, the LLM should detect whether the
user's previous session is from a different date. If so, present a decision
to the user via the IDE-native question tool (text fallback when no
structured tool is available).

## Cross-date probe

```sh
find .peaks/_runtime -mindepth 1 -maxdepth 1 -type d \
  -printf '%f\n' \
| while read sid; do
    last=$(jq -r '.lastActivity // empty' ".peaks/_runtime/$sid/session.json" 2>/dev/null)
    printf '%s\t%s\n' "$sid" "$last"
  done
```

Compare each `last` against today's `YYYY-MM-DD` (use `new Date().toISOString().slice(0,10)`). The canonical "current" `<sessionId>` is the one bound in `.peaks/_runtime/session.json`, resolved via `peaks session info --active`.

## Cross-date decision tree

```
For each <sessionId> in .peaks/_runtime/:
  read .peaks/_runtime/<sessionId>/session.json.lastActivity
  classify:
    invalid sid            -> skip (already covered by peaks workspace clean)
    lastActivity absent    -> skip
    lastActivity == today  -> same-date (current binding)
    lastActivity != today  -> cross-date candidate

If cross-date candidates exist AND canonical sid != today:
  LLM prompts the user via IDE-native ask_user_question:
    Q: "Cross-date session(s) detected: <sid-A>, <sid-B>. Start a new
        conversation (archives the old sessions) or continue the
        previous one?"
    A1: new conversation (recommended)
    A2: continue

  If A1 -> peaks workspace consolidate --apply --keep <currentSid>
          then peaks workspace init
  If A2 -> peaks workspace init (binding stays)
```

## Consolidate CLI contract

`peaks workspace consolidate --apply --keep <currentSid> [--older-than <days>] [--project <path>]`

- Default `--older-than 1` (cross-date).
- Moves `.peaks/_runtime/<sid>/` -> `.peaks/_archive/retrospective-<YYYY-MM-DD>/<sid>/`.
- Writes `manifest.json` per moved session.
- Atomic per-session: a failure mid-move leaves the source untouched.
- `--keep <sid>` excludes the current binding from the move set.

## Consolidate edge cases

- **Multiple cross-date sessions**: `--keep` only filters ONE current sid. To keep N sessions, pass `--keep` repeatedly.
- **Empty `_runtime/`**: Step 0.5 is a no-op; proceed to Step 0.
- **All sessions same-date**: Step 0.5 is a no-op; proceed to Step 0.
- **`.peaks/` not initialized yet**: Step 0.5 fails silently; proceed to Step 0 init.
- **IDE without structured question tool**: ask via plain text in the next assistant turn; honor whichever choice the user types.

## Consolidate IDE note

This step is strictly IDE-agnostic. All IDE-specific discovery lives in the `peaks-ide` skill (separate file). The skill body uses no IDE-specific paths, only generic terminology.