# peaks-loop Logging

> Slice 2026-06-16-cli-logging — User feedback: "I think we should add log output to peaks-loop so when issues occur, the user can attach logs and we can fix based on actual log content."
>
> Canonical reference for the JSONL log file format, rotation policy, secret redaction, and CLI surface. Keep this file in sync with `src/services/log/*.ts` and the `peaks log *` subcommands.

## TL;DR

```bash
# Default-on: every peaks-loop invocation writes one JSONL line to:
#   ~/.peaks/logs/peaks-loop-YYYY-MM-DD.log     (macOS / Linux)
#   C:\Users\<user>\.peaks\logs\peaks-loop-YYYY-MM-DD.log    (Windows)

# Mirror logs to stderr (debug / --verbose):
peaks --verbose slice check --project .

# Or via env var (no flag needed):
PEAKS_LOG_LEVEL=debug peaks slice check --project .

# Read the last 50 lines of today's log:
peaks log tail
peaks log tail --lines 200
peaks log tail --date 2026-06-15

# List all available log files (newest first):
peaks log ls

# Doctor with the log snapshot section:
peaks doctor --log
```

## File location

The log directory is **always** user-global, never project-local:

| OS      | Path                                                |
|---------|-----------------------------------------------------|
| macOS   | `~/.peaks/logs/peaks-loop-YYYY-MM-DD.log`            |
| Linux   | `~/.peaks/logs/peaks-loop-YYYY-MM-DD.log`            |
| Windows | `C:\Users\<user>\.peaks\logs\peaks-loop-YYYY-MM-DD.log` |

The `YYYY-MM-DD` is the **UTC date** of the entry, not the local date. A user in UTC+8 at 02:00 local on 2026-06-16 will see a line written to `peaks-loop-2026-06-15.log` (the UTC date is still 2026-06-15). This is intentional (single global convention) but documented for clarity.

The directory is created lazily on first write — if `~/.peaks/` is missing, the first `peaks` invocation will `mkdir -p` it. No error if the parent is missing.

## File permissions (POSIX)

On macOS and Linux, log files are written with mode `0o600` (user-only readable). On Windows, the equivalent ACL is inherited from the parent directory; the POSIX mode bit is a no-op on `win32`. This is intentional — the log may contain redacted sensitive data (URL paths, command names, JSON envelopes) that should not be world-readable.

## JSONL schema

One JSON object per line, terminated by `\n`. Every line has the same shape:

```json
{
  "ts": "2026-06-15T10:00:00.000Z",
  "level": "info",
  "command": "slice",
  "msg": "peaks slice check --project .",
  "version": "2.2.2",
  "sessionId": "2026-06-16-session-aaf8c7",
  "data": { "outcome": "ok" }
}
```

| Field       | Type                       | Required | Notes                                                              |
|-------------|----------------------------|----------|--------------------------------------------------------------------|
| `ts`        | string (ISO8601 UTC)       | yes      | Set by the logger; never trust caller-supplied `ts`.               |
| `level`     | `'debug' \| 'info' \| 'warn' \| 'error'` | yes | Aligned with PRD NG4 (no `trace` / `fatal`).                       |
| `command`   | string                     | yes      | The peaks subcommand that produced the entry (`main` for the bootstrap). |
| `msg`       | string                     | yes      | Free-form, single-line. Redacted on write.                         |
| `version`   | string                     | no       | `CLI_VERSION` at the time of write.                                |
| `sessionId` | string                     | no       | The active peaks-code session id, if any.                          |
| `data`      | object                     | no       | Structured payload; all secret-keyed fields are redacted.          |

Lines that fail to parse (e.g. crash mid-write) are skipped by `peaks log tail` — partial lines never break the reader.

## Rotation

- **Daily rotation** is automatic. A new UTC date → a new file. There is no size-based rotation; if you need it, file a slice.
- **7-day retention** is enforced on every CLI invocation. Before the bootstrap log line is written, the retention sweep reads the log dir and `unlink`s any `peaks-loop-YYYY-MM-DD.log` whose date is more than 7 days behind today (UTC). Failures are silently swallowed (a logger that takes down the CLI is worse than a logger that drops a line).
- **Manual cleanup**: `rm -rf ~/.peaks/logs/` (the directory is fully user-owned; the uninstaller does not touch it).

## Levels and the verbose channel

The default level is `info`. Two opt-in switches raise the verbosity:

1. `--verbose` (long form only; no short alias because `-v` is bound to `--version`).
2. `PEAKS_LOG_LEVEL=debug` env var. Accepts `debug | info | warn | error`; any other value is ignored.

When the level is `debug`, every `debug` and `info` entry is mirrored to **stderr** in addition to the file. The stdout channel is NEVER touched by the logger — existing `--json` envelopes stay parseable.

## Secret redaction

Two redaction layers run on every write:

1. **Field-level**: any key in a structured `data` payload whose name matches a secret pattern is replaced with `<redacted>`. Patterns: `api_key`, `apikey`, `api_secret`, `secret`, `password`, `passwd`, `token`, `authorization`, `access_token`, `refresh_token`, `cookie`, `set_cookie`, `client_secret`. Case-insensitive; subkeys match (`github.token` is caught).
2. **Line-level**: any free-form `msg` containing `Authorization: Bearer <value>`, `api_key=<value>`, `password="<value>"`, etc. is rewritten in place. The token-shaped value (e.g. `ghp_*`, `sk-*`, long opaque base64) is replaced with `<redacted>`.

False positives are acceptable (a user can read a redacted line); false negatives are NOT (a leaked token may be pasted into a GitHub issue). When in doubt, redact.

To extend the redaction list, add the key to the `SECRET_KEY_PATTERN` regex in `src/services/log/redact.ts`. The line-level redaction table is in the same file.

## `peaks log *` subcommands

### `peaks log tail [--lines N] [--date YYYY-MM-DD] [--json]`

Prints the last `N` lines of the day's log to stdout (default `N=50`). With `--json`, prints a JSON envelope. With `--date YYYY-MM-DD`, reads the log for that UTC date instead of today (mirrors the `PEAKS_LOG_DATE_OVERRIDE` env var used by tests).

Example:
```bash
$ peaks log tail --lines 5
{
  "entries": [
    { "ts": "2026-06-15T10:00:00.000Z", "level": "info", "command": "main", "msg": "peaks-loop start", "version": "2.2.2" },
    { "ts": "2026-06-15T10:00:01.000Z", "level": "info", "command": "slice", "msg": "tsc ok" },
    { "ts": "2026-06-15T10:00:02.000Z", "level": "info", "command": "slice", "msg": "vitest ok" },
    { "ts": "2026-06-15T10:00:03.000Z", "level": "info", "command": "slice", "msg": "3-way merge ok" },
    { "ts": "2026-06-15T10:00:04.000Z", "level": "info", "command": "slice", "msg": "verify-pipeline ok" }
  ],
  "file": "/Users/x/.peaks/logs/peaks-loop-2026-06-15.log",
  "lines": 5,
  "total": 12
}
```

When no log file exists for the given date, the response is `{ "file": null, "entries": [], "total": 0 }`.

### `peaks log ls`

Lists `peaks-loop-*.log` files in `~/.peaks/logs/`, sorted by date descending. Useful when you want to inspect a log from a previous day.

## `peaks doctor --log`

Extends the doctor output with a "logs" section:

```
  logs:
    logDir:        /Users/x/.peaks/logs
    todayFile:     peaks-loop-2026-06-15.log
    sizeBytes:     4382
    retentionDays: 7
    level:         info
```

With `--json`, the section appears under the `data.logs` key. The flag is opt-in to preserve the existing doctor output (P4).

## AC mapping

| AC    | Implementation                                                       |
|-------|----------------------------------------------------------------------|
| AC1   | `writeLogEntry` writes `peaks-loop-YYYY-MM-DD.log` on first invocation.|
| AC2   | `PEAKS_LOG_DATE_OVERRIDE` env var → `WriteLogOptions.dateOverride`.   |
| AC3   | `applyRetention({ retentionDays: 7 })` on every CLI startup.         |
| AC4   | `--verbose` + `PEAKS_LOG_LEVEL=debug` → stderr mirror.                |
| AC5   | `peaks log tail --lines N` with `--json` envelope.                    |
| AC6   | `peaks doctor --log` adds the `logs` section.                        |
| AC7   | `redact.ts` runs on every `writeLogEntry` call.                      |
| AC8   | `peaks workspace init --json` runs unchanged; logger never touches stdout. |
| AC9   | All pre-existing tests pass (`pnpm test`).                           |
| AC10  | New tests cover redact, logger, retention, log-commands-service.     |
| AC11  | Manual dogfood: `peaks log tail --lines 20` after running commands.  |
| AC12  | This document.                                                       |

## Non-goals (per PRD)

- No remote log shipping (NG1).
- No pino / winston dep — `fs.appendFileSync` + `JSON.stringify` only (NG2).
- No `--json` envelope shape change (NG3).
- No `trace` / `fatal` levels (NG4).
- No per-command log filtering (NG5).
- No project-tree log dir; always `~/.peaks/logs/` (NG6).
