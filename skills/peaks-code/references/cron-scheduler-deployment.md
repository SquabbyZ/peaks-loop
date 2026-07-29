# peaks-cron-scheduler deployment guide

> **Slice 2026-07-29-worktree-l2-extended Part 20.** Companion to
> the scheduler implementation in
> `src/cli/commands/cron-scheduler-commands.ts`. This file
> ships the install recipe operators actually run.

## What the scheduler does

`peaks cron-scheduler` is a long-running background process
that wakes up once per minute and runs any task in
`.peaks/cron/schedule.json` whose `intervalMs` has elapsed
since the last run. Built-in tasks include `lease-gc-daily`
(24h interval; sweeps orphan worktree leases). See
`peaks cron init` to bootstrap the schedule.

## Quick start (manual)

```sh
# 1. Initialize the schedule (idempotent)
peaks cron init --project .

# 2. Start the scheduler as a detached background process
peaks cron-scheduler start --project .

# 3. Confirm it is alive
peaks cron-scheduler status --project .

# 4. Trigger a one-shot run if you need it
peaks cron-scheduler run-once --project .

# 5. Stop the scheduler (SIGTERM)
peaks cron-scheduler stop --project .
```

The pid is written to `.peaks/cron/scheduler.pid` so
`stop` and `status` can find the process without operator
guesswork. If the pid file is stale, `stop` removes it
unconditionally (the `isPidAlive` check filters dead entries).

## Windows service install (NSSM)

The scheduler is a normal CLI process. NSSM (the Non-Sucking
Service Manager) is the recommended wrapper for running it
as a real Windows service that auto-restarts on crash.

```sh
# 1. Download NSSM (https://nssm.cc/) and put nssm.exe on PATH.

# 2. Install the service. NSSM is happy with node + script
#    args, so the same call works on Windows + POSIX.
nssm install peaks-cron-scheduler "C:\\Program Files\\nodejs\\node.exe" \
  "C:\\Users\\<you>\\.claude\\skills\\peaks-loop\\bin\\peaks.js" \
  "cron-scheduler" "start" "--project" "C:\\path\\to\\peaks-project"

# 3. Set the working directory (NSSM inherits the install
#    caller's cwd by default; that may not be the project).
nssm set peaks-cron-scheduler AppDirectory "C:\\path\\to\\peaks-project"

# 4. Set environment variables (if needed for proxies / mirrors).
nssm set peaks-cron-scheduler AppEnvironmentExtra "PEAKS_HOME=C:\\Users\\<you>\\.peaks"

# 5. Configure auto-restart on crash.
nssm set peaks-cron-scheduler AppExit Default Restart
nssm set peaks-cron-scheduler AppRestartDelay 5000

# 6. Start the service.
nssm start peaks-cron-scheduler

# 7. Verify.
nssm status peaks-cron-scheduler
peaks cron-scheduler status --project .
```

The same NSSM recipe works on POSIX (use `nssm` from your
distro's package manager) — NSSM runs the same commands on
both Windows and Linux. The pid-file pattern is the same.

## Logs

`peaks-cron-scheduler.js` writes to its own stdout/stderr;
NSSM captures them to the Windows Event Log when the
service is running. For a debug session, run the scheduler
in the foreground:

```sh
node bin/peaks.js cron-scheduler start --project .  # will not detach; use a tmux/foreground
```

(This is not the production path — the production path is
`peaks cron-scheduler start` which uses detached spawn and
returns immediately. The detached flag means the parent can
exit cleanly without the child.)

## Troubleshooting

- **"scheduler.pid stale"** — `stop` removes the pid file
  unconditionally. Restart with `start`.
- **"no lease lease lease-id"** — the schedule was created
  with `peaks cron init` but the user's `.peaks/cron/` is
  read-only. Check filesystem permissions.
- **"docker not found"** — the scheduler runs shell commands
  via `execSync`. If a task is `docker rm --force ...` and
  docker is missing, the task fails (the scheduler does not
  crash — it logs and continues to the next tick).

## When NOT to use this scheduler

- **Production with strict timing** — peaks-cron is a
  best-effort CLI scheduler, not a real cron daemon. For
  mission-critical periodic work, use the OS cron / systemd
  timer / Windows Task Scheduler to invoke
  `peaks cron-scheduler run-once --project .` on a precise
  interval. The OS scheduler is reliable; the in-process
  scheduler is portable.
- **Multi-tenant** — peaks-cron runs all tasks in the
  schedule.json in a single process. If two users have
  conflicting lease-gc schedules, the in-process scheduler
  will collide. The OS scheduler + per-tenant
  `peaks cron-scheduler run-once` is the right shape.

## Source pointer

The CLI surface lives in
`src/cli/commands/cron-scheduler-commands.ts`. The pure
`runSchedulerLoop` function is the async loop; `start` /
`stop` / `status` are thin shells around pid-file
management.
