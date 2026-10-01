# Diagnosis — the `peaks worktree list` process population (opened 2026-09-30, still open 2026-10-01)

**Status: root cause NOT established. No fix is proposed in this document, and none should be written
until the emitter is caught red-handed.** Two genuine defects did fall out of the investigation and
are recorded in `.peaks/docs/backlog.md` (§2.21, §2.22).

## 1. What was actually observed (measurement, not inference)

Population, counted by `Get-CimInstance Win32_Process` grouped on the full command line:

| Time | Identical `node.exe` on `"...peaks-loop\bin\peaks.js" worktree "list"` | Free RAM |
|---|---|---|
| 2026-09-30 20:31 | 385 (of 388 node processes, 4.4 GB total, max 101 MB each) | 0.43 GB / 15.75 GB |
| 2026-09-30 20:33 | 416 → 428 | 0.22 GB |
| 2026-09-30 ~20:40 | 0 | 7.75 GB |
| 2026-10-01 22:12–22:15 | 158 alive at 22:15, then 523 node processes | 0.61 GB |
| 2026-10-01 ~22:25 | 0 | 6.14 GB |

Each leaked process's immediate parent is `cmd.exe /d /s /c "peaks worktree "list""` — that string was
never truncated in the log and is unambiguous.

Consequences measured while the population was alive: `pnpm test:integration` exited 1 with **0 failed
tests** and 3 vitest `spawn UNKNOWN` unhandled errors (three test files never started);
`packages/peaks-loop-shared` died with `0xC0000409` and `Committing semi space failed`; and
`peaks code context-now` — a trivial CLI call — died with `young object promotion failed` on a
~30 MB heap. Per the campaign's own rule (§4h) all three are **"did not run"**, not results.

## 2. Fingerprint the emitter must satisfy (these are hard constraints, from observation)

1. It invokes **through a shell string with a quoted argument**: `peaks worktree "list"`. That is not
   what `execFileSync('peaks', ['worktree','list'])` produces, and no such call exists in the repo.
2. It sustained roughly **8 processes/minute for ~22 minutes** and stopped within ~2 minutes of the
   heavy work stopping; the population then drained by itself in ~10 minutes.
3. Its rate **correlates with heavy CPU/IO load on this host**: both bursts fell entirely inside
   windows where the orchestrator was running `gate repo` / `test:unit` / `build` / `test:integration`
   / four wave-5 leaves.
4. Each child is a full CLI start (measured 785–1459 ms on an idle host, exit 0), so under contention
   they queue rather than pile up as crashes.

## 3. Hypotheses tested and eliminated (with the measurement that killed each)

| # | Hypothesis | Test | Result |
|---|---|---|---|
| 1 | Qoder scheduled automation re-invoking it | `qoder_cron list` | **0 tasks** — eliminated |
| 2 | A peaks cron-scheduler daemon is running | `peaks cron-scheduler status` on both roots; process scan for `cron-scheduler` | **pid null, alive false, 0 schedule entries** in both roots; 0 daemon processes — eliminated *for these roots* (an unknown third root is not excluded) |
| 3 | A user SOP's command gate runs it | `peaks gate enforce` path read (`sop-check-service.evaluateCommand` → `execFileSync(bin, args)`); `.peaks/sops/**` in both trees + `~/.peaks/sops` | no `worktree` gate anywhere; and `execFileSync` argv cannot produce the quoted shape — eliminated |
| 4 | The test suite spawns orphans | grep `tests/**` for `worktree list` | only `execFileSync('git', ['worktree','list','--porcelain'])` — eliminated |
| 5 | `peaks worktree list` re-invokes itself | probe: run it and sample children for 6 s | exit 0, **785 ms, 0 children** — self-recursion eliminated. (The earlier 2026-09-30 conclusion said "not reproducible after reboot"; it was right for the wrong reason — see §5.) |
| 6 | `peaks statusline` / `peaks code gate-step-08` / `peaks gate enforce` / `peaks session primer` / `peaks cron list` / `peaks workspace init` emit it | same probe, each command | **0 children each** — eliminated |
| 7 | Static grep for the call site | searched the installed 4.0.54 `dist/` and the branch `src/` for the quoting shape | the **only** code in the shipped build that emits `peaks <cmd> "<arg>"` is `runTask()` (`cron-commands.js:147`), whose built-in `lease-gc-daily` task is exactly `command:'worktree', args:['list']` (`src/cli/commands/cron-commands-schedule.ts:164`). Consistent with the fingerprint, but nothing on this machine was found driving it. |

## 4. Two real defects that fell out (detailed in backlog §2.21 / §2.22)

- `EXEC_TIMEOUT_MS = 5 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND` — the identifier says
  five minutes, the arithmetic yields **5 hours** (18,000,000 ms). A hung task child is therefore not
  reaped for five hours, which is exactly the accumulation shape observed.
- The comment block at `src/cli/commands/cron-commands.ts:11` states the built-in task runs
  `peaks worktree gc --all-sessions`; the code at `cron-commands-schedule.ts:164` runs
  `worktree` + `['list']`. I asserted a source-versus-shipped divergence from the comment and was
  wrong: the comment lies, the code matches the shipped build.

## 5. Instrumentation errors I made, because they are the reason this is still open

1. **My parent-chain logger truncated command lines to 90 characters** — a length that ends *exactly*
   where the arguments begin. That turned "the parent is `peaks worktree "list"`" into something I read
   as self-recursion, and it hid the possibility that the parent was a peaks command whose `--project`
   path merely contains `.qoder-cn\worktrees\`. Fixed: the watcher no longer truncates.
2. **My filter `-match 'worktree'` over-matches**, because the session path itself contains
   `worktrees`. Counts of "worktree processes" from that filter are untrustworthy; the grouped full
   command lines in §1 are not (they were read off the displayed string, not off the filter).
3. **I concluded "not reproducible" by looking for leftovers.** A child that finishes leaves nothing.
   The correct question is "how many children did this invocation *create*", which needs sampling
   during the run — and sampling by **parent pid**, not by command-line substring.
4. My 200 ms sampler in `fingerprint.ps1` captured 1 line for a run that provably executed (the
   history record exists: `lease-gc-daily`, exit 0, 767 ms), so it missed the child. The fix is to
   attach the sampler to the known parent pid, and to `Add-Content` from the caller rather than from
   a `Start-Job` whose working directory is not the one under test.

## 6. What would settle it

Keep the corrected watcher (`leak/watch.ps1`, untruncated, matches `worktree` **and** `cron`) armed
across the next heavy run, and when the population appears, take **one full command line plus its
ancestor chain to the root** — that names the emitter without guessing. If no recurrence happens, the
next-best evidence is a controlled experiment in a scratch project root that already holds a
`schedule.json`: run `peaks cron run` under a parent-pid-anchored sampler and count children per tick,
then check whether anything on the machine can reach that command at ~8/minute. Not to be attempted
while free RAM is under ~4 GB: the failure mode of a burst on this host is a `0x10E` bugcheck, and a
bugcheck costs the uncommitted work of every leaf running at the time.

## 7. The instruments, inlined so they survive the gitignore

### `leak/watch.ps1` — untruncated parent-chain watcher (4 s poll)

```powershell
$ErrorActionPreference = 'SilentlyContinue'
$log = 'C:\Users\small\.qoder-cn\worktrees\app\1e2aef\peaks-loop\.peaks\_runtime\2026-09-30-session-3e3d50\leak\spawn.log'
$seen = @{}
function Chain($p) {
  $parts = @()
  $cur = $p
  for ($i = 0; $i -lt 6; $i++) {
    if (-not $cur) { break }
    $c = $cur.CommandLine
    $parts += ("[" + $cur.ProcessId + "]" + $cur.Name + " " + $c)
    $cur = Get-CimInstance Win32_Process -Filter "ProcessId=$($cur.ParentProcessId)"
  }
  return ($parts -join ' << ')
}
while ($true) {
  $procs = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'peaks' -and ($_.CommandLine -match 'worktree' -or $_.CommandLine -match 'cron') })
  foreach ($p in $procs) {
    $k = [string]$p.ProcessId
    if (-not $seen.ContainsKey($k)) {
      $seen[$k] = $true
      $line = (Get-Date).ToString('HH:mm:ss') + " NEW pid=" + $p.ProcessId +
        " created=" + $p.CreationDate.ToString('HH:mm:ss') + " alive_count=" + $procs.Count +
        " chain=" + (Chain $p)
      Add-Content -Path $log -Value $line
    }
  }
  Start-Sleep -Seconds 4
}
```

### `leak/probe.ps1` — per-command child census

```powershell
param([string]$Cmd)
function Snapshot {
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
      $_.CommandLine -match 'peaks-loop' -and $_.CommandLine -match 'worktree'
    })
}
$before = @{}
foreach ($p in Snapshot) { $before[[string]$p.ProcessId] = $true }
Write-Output ("matching_before=" + $before.Count)
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$out = & cmd /c $Cmd 2>&1
$code = $LASTEXITCODE
$sw.Stop()
Write-Output ("cmd_exit=" + $code + " cmd_wall_ms=" + [int]$sw.ElapsedMilliseconds + " out_chars=" + (($out | Out-String).Length))
$newTotal = 0
for ($i = 0; $i -lt 6; $i++) {
  Start-Sleep -Seconds 1
  $snap = Snapshot
  $new = @($snap | Where-Object { -not $before.ContainsKey([string]$_.ProcessId) })
  $newTotal = [Math]::Max($newTotal, $new.Count)
  foreach ($n in ($new | Select-Object -First 3)) {
    Write-Output ("  NEW t=" + ($i + 1) + " pid=" + $n.ProcessId + " ppid=" + $n.ParentProcessId + " cmd=" + $n.CommandLine)
  }
  Write-Output ("  t=" + ($i + 1) + " alive_matching=" + $snap.Count + " new=" + $new.Count)
}
Write-Output ("max_new_seen=" + $newTotal)
```

## 8. Negative result from the controlled experiment (2026-10-01, idle host)

A scratch project root (`%TEMP%\leakprobe`, its own git repo) was given the fixture
`.peaks/cron/schedule.json` with `lease-gc-daily` — `command:'worktree'`, `args:['list']`,
`intervalMs:86400000`. Two runs, `peaks cron run --project .` and `peaks cron run --id
lease-gc-daily --project .`, both exited 0 and wrote both history records:

```
{"taskId":"lease-gc-daily","startedAt":1790826962996,"finishedAt":1790826963763,"exitCode":0,"stderr":""}  → 767 ms
{"taskId":"lease-gc-daily","startedAt":1790827444236,"finishedAt":1790827444981,"exitCode":0,"stderr":""}  → 745 ms
```

So the task does execute, its child completes in under a second, **and nothing accumulates on an idle
host** — including the first run's child, which the 200 ms census saw zero of, and the second, which
the parent-pid-anchored sampler at 60 ms also missed. Either the sampler cannot see a 745 ms grandchild
of a `Start-Process` grandchild (most likely; `descendants=4` with duplicate rows for already-exited
pids is consistent with that), or the child is not the process shape the leak showed. Either way this
is not a reproduction, and the emitter remains unnamed.

What the two runs do establish: `runTask` on a healthy host is a ~750 ms, exit-0, non-accumulating
operation. The observed population therefore needs the **load precondition** — children slowed enough
to overlap the invocation rate — and can only be attributed by catching it live. That is what the
corrected watcher in §7 is for, and why §6's advice (do not run the experiment under <4 GB free) stands.
The sampler's blind spot is a named defect of the instrument, not evidence about the leak.

## 9. The mechanism the review found (2026-10-01) — accumulation explained, invoker still not named

An independent review of the `EXEC_TIMEOUT_MS` fix came back **BLOCKED with 1 CRITICAL**, and the reason
was about my prose, not the constant: I had written that reaping happens within minutes. Re-measured by
the orchestrator with `runTask`'s exact options:

```
{"caught":true,"code":"ETIMEDOUT","signal":"SIGTERM","elapsed_ms":1519}
{"after_ms":0,"survivors_of_the_killed_task":1}
{"after_ms":3000,"survivors_of_the_killed_task":1}
{"after_ms":6000,"survivors_of_the_killed_task":1}
```

The task was `node -e "setTimeout(…, 60000)"` under a 1500 ms timeout. `execSync`'s timeout kills the
shell — on Windows `cmd.exe` — and **orphaned the node grandchild, which lived on.** So two things change:

1. §2.21's fix is real but narrower than I claimed: it stops a blocked `runTask` caller waiting five
   hours; it does not stop a stalled task child from surviving. Recorded as backlog §2.23, with the
   related honesty problem that a timed-out record reports `exitCode 1` / `stderr ''` while the task may
   still succeed — the history lies.
2. The fingerprints in §2 now have a mechanism. `cmd.exe /d /s /c "peaks worktree "list""` is exactly the
   process `execSync` kills, and the surviving node child is exactly the population we counted. It also
   fits a sample I took at 20:36 and dismissed: a leaked node whose parent process **could not be
   resolved** — I read that as noise; under this mechanism it is the expected shape of an orphan.
   And backlog §2.24 is the rate half: the daemon's `tick()` calls `runTask` and **discards the record
   without writing `lastRunAt`**, so a 24-hour task stays permanently due and re-fires every 60-second
   tick, each slow fire leaving another orphan behind.

What is still NOT established: an instance. No `peaks-cron-scheduler` process, no `scheduler.pid`, and no
`.peaks/cron` directory exists anywhere within the depth searched on this machine, and `cron-scheduler
status` reports `pid null / alive false / 0 entries` in both peaks-loop roots. A mechanism without a
confirmed caller is not a root cause, so §5–§8 stand: the watcher stays armed, and the next recurrence
must be answered by taking one **full** command line plus the ancestor chain to a resolved or
irrecoverably-gone parent — the two cases this document has now learned to tell apart.

The lesson worth keeping, stated plainly because I am the one who made the error: I wrote a claim about
what a timeout *does* while holding evidence only about what a timeout *is*. Arithmetic was measured;
reaping was assumed. An independent reviewer with a 30-second probe caught it.

### 9.1 Addendum — §2.23 fixed the same day, and what that does and does not close
(rid `2026-10-01-cron-task-tree-kill-01`)

`runTask` now spawns the task through `process.execPath` + `bin/peaks.js` with an argv array: there is no
`cmd.exe` between the scheduler and the task, so the exec timeout acts on the task process itself.
Measured with the marker-in-argv process count of `tests/unit/cli/commands/cron-task-tree-kill.test.ts`
(same instrument as §7, same 1500 ms injected timeout, a 30 s task body): survivors **1 → 0**, and the
record that used to read `exitCode 1, stderr ''` now reads
`killed: true` with a stderr naming the timeout.

**Does this close the accumulation half of the mechanism above? For the shape this document measured,
yes — with two limits, both stated rather than assumed.**

1. The population in §1 was node processes whose parent `cmd.exe` had been killed. That indirection is
   gone, so *that* accumulation can no longer be produced by a stalled cron task: a stalled fire is now
   dead within `EXEC_TIMEOUT_MS` — **dead for the task process, which is all the code asks for.** "And
   leaves nothing" was the wrong phrase, and this file has now overclaimed reaping twice: nothing in
   `runTask` requests a descendant kill (no `taskkill /T`, no job object, no process group, and on POSIX
   the same call signals one pid), so the honest record is the measurement, not a guarantee — the
   independent reviewer's four win32 probes of `runTask`'s exact options each saw the marked process
   family go **2 → 0** (an async node grandchild, an `execFileSync('git')` shape, a non-node holder),
   every zero backed by a live count of 2 taken just before the kill; the mechanism by which the
   descendants died is not understood, so **tree reaping is not a guarantee** and the committed suite
   asserts the task process only. It does **not** follow that the 2026-09-30/10-01
   population was cron — §8's negative result stands, no caller was ever observed, and the emitter is
   still unnamed. The watcher stays armed.
2. Reaping is asserted for the task process. A task that spawns descendants of its own was measured on
   win32 (three runs, zero survivors, both roles proven to have started by a per-pid provenance line)
   but no code in the fix asks for a descendant kill, so that is an observation about this host's process
   handling, not a guarantee, and the suite does not assert it. `lastRunAt` is still not persisted by the
   daemon tick (§2.24), so the *rate* at which fires happen is unchanged: what changes is that each fire
   now cleans up after itself.
