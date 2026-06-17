# peaks playwright — multi-terminal Playwright MCP (slice 2.5.0 sub-fix C)

## Why this exists

When two or more terminals / IDE sessions each spawn a `playwright` MCP server, they fight over:

1. The default port (8931) — only one server can bind it.
2. The browser's user-data dir — two servers writing to the same dir corrupt each other's profiles.
3. The process state — no record of "is anyone else running this?".

`peaks playwright start | ls | stop` is the multi-terminal resolution. Each terminal/IDE session runs `peaks playwright start` once and gets a unique port + a unique user-data dir.

## CLI surface

```sh
peaks playwright start \
  [--port <n>]                      # default 8931; walks 8931→8949 if busy
  [--browser chromium|firefox|webkit]  # default chromium
  [--user-data-dir <path>]          # default: <projectRoot>/.peaks/_runtime/playwright-userdata/<terminal-id>
  [--reuse]                         # if a session already exists for this terminal, return its port instead of erroring
  [--project <path>]                # default: cwd
  [--json]

peaks playwright ls    [--project <path>] [--json]
peaks playwright stop  [--terminal <id>] [--project <path>] [--json]
```

## Port-walk behavior

`peaks playwright start` tries ports in the order `8931, 8932, 8933, ..., 8949`. The first port that is **not** bound by anything (probe uses `net.createServer().listen()`; an `EADDRINUSE` is a busy port) is used. If 8931..8949 are all busy, the command exits with `PORT_EXHAUSTED`.

The CLI does NOT bundle the playwright-mcp binary. It shells out to `npx playwright-mcp@latest --port=<n> --browser=<b> --user-data-dir=<path>`. peaks-cli is the lifecycle orchestrator, not the install medium.

## Session file layout

Each successful `start` writes:

```
<projectRoot>/.peaks/_runtime/playwright-sessions/<terminal-id>.json
```

The schema:

```json
{
  "terminalId": "tty-aabbccddeeff0011",
  "port": 8931,
  "browser": "chromium",
  "userDataDir": "/abs/path/to/playwright-userdata/<terminal-id>",
  "startedAt": "2026-06-17T15:00:00.000Z",
  "pid": 12345
}
```

The directory is gitignored (covered by the existing `.peaks/_runtime/` rule in `.gitignore`, with an explicit comment line for future readers).

## Terminal ID derivation (R4)

The terminal id is derived from the process environment, in this order:

1. `process.env.TERM_SESSION_ID` (macOS Terminal, iTerm2)
2. `process.env.WT_SESSION` (Windows Terminal) — prefixed with `wt-`
3. Hash of `process.ppid + process.env.SSH_TTY || 'no-tty'` — prefixed with `tty-` (16 hex chars)

Edge cases:

- SSH sessions without `SSH_TTY` → falls back to a hash. Two SSH sessions on the same ppid without `SSH_TTY` would share an id, but in practice each interactive SSH session sets `SSH_TTY` once a pty is allocated.
- IDEs that don't set `TERM_SESSION_ID` (e.g. some VSCode integrated terminals) → falls back to the hash.
- Untrusted characters in `TERM_SESSION_ID` (`/`, `\`, space, etc.) are replaced with `_` and truncated to 64 chars.

## Conflict detection (G21 / AC18)

If `peaks playwright start` finds an existing session file for the current terminal, it exits with a clear error:

```
CONFLICT: another playwright MCP is already running on port 8931 (terminal tty-aabbcc...). Reuse it (--reuse) or pick a new port (--port <n>).
```

Two ways out:

- `peaks playwright start --reuse` — return the existing session's port (idempotent).
- `peaks playwright start --port 8940` — pick a different port and try again.

## Workflow

Typical two-terminal setup:

```sh
# Terminal A
$ peaks playwright start
playwright MCP started on port 8931 (browser=chromium, terminal=tty-aabb...)

# Terminal B
$ peaks playwright start
playwright MCP started on port 8932 (browser=chromium, terminal=tty-ccdd...)   # walks past 8931

# Inspect
$ peaks playwright ls
port=8931   browser=chromium  terminal=tty-aabb...  pid=12345  started=2026-06-17T15:00:00.000Z
port=8932   browser=chromium  terminal=tty-ccdd...  pid=12346  started=2026-06-17T15:00:01.000Z

# Tear down
$ peaks playwright stop
stopped playwright session on port 8931 (terminal=tty-aabb...)
```

## When this command is unavailable

`peaks playwright start` requires `npx` to be on PATH and reachable network to fetch `playwright-mcp@latest` on first run. If the user's environment has no network or no `npx`, the command fails at spawn time. Document this in onboarding.

## Precedent

- slice 2.3.0 (workspace consolidate + session checkpoint/resume) — same `_runtime/` directory pattern.
- slice 2.4.0 (cross-IDE byte-stability) — same "do not touch the IDE adapter files" rule; this command is CLI-only.
