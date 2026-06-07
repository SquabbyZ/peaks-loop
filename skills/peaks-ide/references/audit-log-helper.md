---
name: peaks-ide-audit-log-helper
description: Thin Node helper that writes a single JSONL line to `.peaks/audit/peaks-ide-<UTC-date>.log`. Reachable from the peaks-ide SKILL.md Step 5 escape hatch. NOT a `peaks <cmd>` CLI primitive (slice #2 closeout + dev-preference red line).
---

# peaks-ide audit log helper

The peaks-ide skill's Step 5 (`audit log`) delegates the JSONL write to
`scripts/peaks-ide-audit-log.mjs`. The helper is a thin Node script, not a
new `peaks <cmd>`, and is the single source of truth for the audit log
shape (machine + human readable, one JSON object per line).

## Why a thin helper, not a CLI primitive

Per `.peaks/memory/peaks-ide-skill-ac-10-audit-log-writer-is-a-thin-helper-not-a-separate-cli-primitive.md`
(slice #2 closeout), the audit log writer is reachable from the skill's
Step 5 escape hatch but is NOT a new top-level `peaks <cmd>`. The
`peaks project dashboard` command reads the log via the `audit` scan; the
helper writes the log. The dev-preference red line "Default-no on new CLI
commands" still applies — if the audit-trail becomes critical in a future
slice, the helper can be promoted to a CLI primitive at that point.

## CLI surface

```
node scripts/peaks-ide-audit-log.mjs --project <repo> --event <name> --adapter <id> [--ok true|false] [--detail <json>] [--dry-run]
```

| Flag | Required | Description |
|---|---|---|
| `--project <path>` | yes | Target project root (parent of `.peaks/`) |
| `--event <name>` | yes | Event identifier (`install`, `statusline`, `hook-handle`, ...) |
| `--adapter <id>` | yes | Adapter id (`claude-code`, `trae`, ...) |
| `--ok <bool>` | no, default `true` | Outcome flag — `false` to record a failure |
| `--detail <json>` | no | Free-form JSON object attached to the entry |
| `--dry-run` | no | Print the would-be line; do not write |

## Log line shape

```json
{"timestamp":"2026-06-07T16:00:00.000Z","event":"install","adapter":"trae","ok":true}
```

The log file path is `<projectRoot>/.peaks/audit/peaks-ide-<UTC-date>.log`
and is gitignored per the repo root `.gitignore` (`.peaks/audit/`).

## Contract pinned by tests

`tests/unit/skills/peaks-ide/audit-log-helper.test.ts` pins 4 sub-cases
(per AC-5): helper is at the documented path, write emits one JSONL line
with `timestamp + event + adapter + ok`, the log path is in `.gitignore`,
and `--dry-run` returns the would-be line without writing.
