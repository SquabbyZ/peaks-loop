---
name: 2026-09-30-four-host-bugchecks-from-overlapping-verification-runs
description: The dev host took four Kernel-Power 41 bugchecks with stop code 0x10E PFN_LIST_CORRUPT (9/28 20:58, 9/28 23:02, 9/30 18:10, 9/30 19:45) while whole-program type checks overlapped. Measured: one tsc --noEmit = 786 MB over 1773 files, one type-aware eslint batch = 985 MB, box = 16 cores / 15.75 GB. Right before the 18:10 crash there were 527 node processes holding 9.45 GB RSS, 526 of them `peaks-loop\bin\peaks.js worktree "…"`. Rule: one heavy command at a time, never backgrounded alongside another.
kind: feedback
---

**The mistake.** During the `strict-remediation-abc` campaign I ran `pnpm build && pnpm test:integration`
with `run_in_background`, and while it was live I ran the full unit suite, `pnpm -r --if-present test`, and a
per-file eslint loop in the foreground. Node started failing to allocate
(`low_level_alloc … Check new_pages != nullptr failed: VirtualAlloc failed`, exit `3221225794`), which I
initially read as "eslint found nothing" — it is **did not run**. The host then took a `0x10E` bugcheck.

**Measured footprints on this box (16 cores, 15.75 GB).**

| command | peak |
|---|---|
| `tsc -p tsconfig.json --noEmit` (whole program, 1773 files) | 803,436K ≈ **786 MB** |
| one type-aware eslint batch (150 files, gate config) | ≈ **985 MB** RSS |
| `vitest run tests/unit` | capped at 2 forks by `vitest.workers.ts` (`DEFAULT_MAX_WORKERS = 2`) |
| `pnpm test:integration` | 474 cases; each case may spawn a `node bin/peaks.js` child |

Five concurrent RD leaves each running `tsc` is ~4 GB before the orchestrator adds anything.

**How to apply.**

1. **One heavy command at a time, foreground.** `run_in_background` is for things that do not allocate (a
   read, a grep), not for build / integration / gate-repo / full-suite runs.
2. **An allocation failure is "did not run", never "clean".** If a number comes back suspiciously empty,
   re-run that command alone before recording it.
3. **Check the cap actually covers every entry point.** `vitest.workers.ts` claimed to be the single source
   for "all four vitest configs"; the repo has **seven**, and the three `packages/*/vitest.config.ts` set no
   `pool` / `maxWorkers` / `fileParallelism` at all. Harmless only because each package has 2 test files —
   the moment one grows, `pnpm -r test` is 16 forks per package. Fixed in `6853ba94`, with a census guard
   (`tests/unit/standards/vitest-worker-cap.test.ts`) that enumerates the configs by walking the filesystem
   and proves red on the live tree when a cap is stripped.
4. **Report the mechanism you cannot see.** 526 lingering global-CLI processes appeared between 18:10 and
   19:25 and I could not reproduce it after the reboot: `peaks worktree` subcommands all exit promptly
   (`status`/`gc`/`renew`/`release`/`spawn`/`auth status`/`auth list`), and `src/services/worktree/*` has no
   detached child or heartbeat timer. Say "not reproduced" rather than inventing a cause. The capture to run
   next time it appears: `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` with
   `ProcessId,ParentProcessId,CreationDate,CommandLine`.
5. **`0x10E` is not plain OOM.** Windows under memory pressure kills processes; PFN-list corruption points at
   a driver or RAM faulting under that pressure. The dumps are in `C:\Windows\Minidump\`. Worth
   `mdsched.exe` / a dump read before concluding "the test suite crashed it".

Related: [[a-guard-keyed-on-a-file-path-shrinks-silently-when-you-split-that-file]],
[[2026-09-30-a-guard-that-counts-a-directory-silently-blames-the-registry]].
