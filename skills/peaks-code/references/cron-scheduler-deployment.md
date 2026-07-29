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

---

# Appendix A — NSSM (Non-Sucking Service Manager) detailed install

> **Slice 2026-07-29-rid-prose-only-sweep Part 39.** This
> appendix is the operator-focused, step-by-step NSSM install
> recipe for `peaks-cron-scheduler` on Windows. NSSM wraps any
> long-running process as a real Windows service that starts at
> boot, restarts on crash, and writes to the Windows Event Log.

## Why NSSM (not Windows Task Scheduler)

Windows Task Scheduler can run `peaks-cron-scheduler start`
on a schedule, but it does not manage the long-running process:
if `node` crashes, Task Scheduler will not restart it until
the next trigger. NSSM (and node-windows, a Node-native
alternative) treat the process as a service with auto-restart.

## Install NSSM

Download NSSM from <https://nssm.cc/> (the official site
hosts the binary). NSSM is a single `nssm.exe` (~50 KB); put
it on PATH (e.g. `C:\Windows\System32` or a custom dir).

For a 64-bit Windows host, NSSM ships 32-bit and 64-bit
binaries in the same zip — use `win64\nssm.exe`. The 32-bit
binary works for 32-bit services; the 64-bit binary is the
default for modern systems.

```sh
# Verify NSSM is on PATH and reports its version
nssm version
# NSSM 2.24, 64-bit
```

If `nssm` is not on PATH, the install will fail with
`'nssm' is not recognized`. The peaks-cron-scheduler NSSM
install does not put NSSM on PATH for the operator; it
expects NSSM to be installed first.

## Install the service

```sh
# 1. Install the service. NSSM is happy with `node` + script
#    args, so the same call works on Windows + POSIX.
nssm install peaks-cron-scheduler "C:\Program Files\nodejs\node.exe" \
  "C:\Users\<you>\.claude\skills\peaks-loop\bin\peaks.js" \
  "cron-scheduler" "start" "--project" "C:\path\to\peaks-project"

# 2. Set the working directory (NSSM inherits the install
#    caller's cwd by default; that may not be the project).
nssm set peaks-cron-scheduler AppDirectory "C:\path\to\peaks-project"

# 3. Set environment variables (if needed for proxies / mirrors).
nssm set peaks-cron-scheduler AppEnvironmentExtra "PEAKS_HOME=C:\Users\<you>\.peaks"

# 4. Configure auto-restart on crash.
nssm set peaks-cron-scheduler AppExit Default Restart
nssm set peaks-cron-scheduler AppRestartDelay 5000

# 5. Set log file paths (NSSM redirects stdout/stderr).
nssm set peaks-cron-scheduler AppStdoutCreationDisposition 4   # OPEN_ALWAYS
nssm set peaks-cron-scheduler AppStderrCreationDisposition 4
nssm set peaks-cron-scheduler AppStdout "C:\path\to\logs\peaks-cron-scheduler.out.log"
nssm set peaks-cron-scheduler AppStderr "C:\path\to\logs\peaks-cron-scheduler.err.log"
nssm set peaks-cron-scheduler AppRotateFiles 1                   # rotate on size
nssm set peaks-cron-scheduler AppRotateBytes 10485760              # 10 MB per file

# 6. Start the service.
nssm start peaks-cron-scheduler
```

The same NSSM recipe works on POSIX (use `nssm` from your
distro's package manager) — NSSM runs the same commands on
both Windows and Linux. The pid-file pattern is the same.

## Verify

```sh
# 1. NSSM-level status
nssm status peaks-cron-scheduler
# SERVICE_RUNNING

# 2. peaks-level status (peaks-cli reads the pid file)
peaks cron-scheduler status --project C:\path\to\peaks-project
# {
#   "data": {
#     "alive": true,
#     "pid": 12345,
#     "scheduleEntries": 1,
#     "dueTaskCount": 0
#   }
# }

# 3. Force a one-shot to verify the schedule is reachable
peaks cron-scheduler run-once --project C:\path\to\peaks-project
# {
#   "data": {
#     "ran": 1,
#     "records": [{ ... }]
#   }
# }
```

If `nssm status` reports `SERVICE_STOPPED`, the service
crashed on startup. Check the log file at
`<AppStderr>` (typically `C:\path\to\logs\peaks-cron-scheduler.err.log`).
The most common cause is `nssm` not finding the node binary
at `<AppStdout>` — verify with
`nssm get peaks-cron-scheduler AppStdout` + `AppParameters`.

## Uninstall

```sh
# 1. Stop the service
nssm stop peaks-cron-scheduler

# 2. Remove the service registration
nssm remove peaks-cron-scheduler confirm

# 3. (Optional) Remove the log files
rm "C:\path\to\logs\peaks-cron-scheduler.out.log"
rm "C:\path\to\logs\peaks-cron-scheduler.err.log"

# 4. (Optional) Remove the cron-schedule state
#    Note: the peaks-cli schedule lives under .peaks/cron/ and
#    is NOT in NSSM. Removing NSSM does not affect the schedule.
peaks cron list --project C:\path\to\peaks-project
```

If the service refuses to stop, escalate:
`taskkill /F /IM node.exe /FI "WINDOWTITLE eq peaks-cron-scheduler*"`
or `nssm set peaks-cron-scheduler AppStopMethodSkip 0` to
force NSSM to honor `Ctrl+C` instead of `WM_CLOSE`.

## Troubleshooting

- **"nssm: command not found"** — NSSM is not on PATH.
  Install it (see `Install NSSM` above) and re-run the
  `nssm install` command.
- **"SERVICE_PAUSED" on startup** — Windows Defender or
  another AV is blocking the binary. Add the node binary
  to the AV exclusion list or sign the peaks-cli install.
- **Service runs but no log lines** — the AppStdout path is
  wrong, or the directory is not writable. NSSM needs the
  AppStderr file's parent directory to exist before
  service start. `mkdir -p` the log dir before
  `nssm start`.
- **Auto-restart not firing** — `AppExit Default Restart`
  is set, but Windows also has a per-process recovery
  policy (`sc failure` for native services). For NSSM,
  `AppRestartDelay` is in milliseconds; 5000 is the
  default. 0 means "restart immediately", which can cause
  a crash loop if the underlying issue is fatal.
- **Schedule has tasks but they don't fire** — verify
  the schedule file is reachable by the service user
  (the user the service runs as, not your interactive
  user). `peaks cron list` from the interactive shell
  may show entries that the service user cannot see
  (different HOME / different `PEAKS_HOME` env).

## Production checklist

- [ ] NSSM installed on PATH
- [ ] Node.js installed at the path NSSM is configured for
- [ ] peaks-loop installed at the path NSSM is configured for
- [ ] Project root has a populated `.peaks/cron/schedule.json`
      (run `peaks cron init` from the project dir first)
- [ ] Log directory exists and is writable by the service user
- [ ] `nssm status peaks-cron-scheduler` reports `SERVICE_RUNNING`
- [ ] `peaks cron-scheduler status` reports `alive: true`
- [ ] `peaks cron-scheduler run-once` runs the lease-gc-daily
      task without error
- [ ] Service survives a reboot (`shutdown /r` then
      `nssm status peaks-cron-scheduler`)

## Related memory

- [[2026-07-29-worktree-l2-extended-part15]] — peaks-cron
  init / list / run / peaks-cron-scheduler start (Part 15)
- [[2026-07-29-worktree-l2-extended-part20]] — first pass
  NSSM recipe (Part 20)
- [[2026-07-29-worktree-l2-extended-part14]] — peaks-cron
  schedule.json shape + built-in `lease-gc-daily` task
