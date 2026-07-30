---
name: 2026-07-30-windows-parallel-hooktimeout-fix
title: Windows parallel hookTimeout flake in vitest@4.1.10 + server.deps.inline
description: When 11 test files run in parallel under pool:forks + fileParallelism:true on Windows, os.tmpdir() + mkdtempSync contention fires a 5s hookTimeout; fix at 30s + setImmediate rmSync.
kind: feedback
---

# Windows parallel hookTimeout flake in vitest@4.1.10

## When this happens

A vitest 4.1.10 unit suite that:
- runs under `pool: 'forks'` + `fileParallelism: true`
- uses `server.deps.inline: [/^src\//]` to transform .ts source
- has ≥ 10 test files that ALL call `mkdtempSync(os.tmpdir(), 'prefix-')`
  in their beforeEach (the antfu-style "tmp workspace per test" pattern)
- exercises a real cross-process `withFileLockSync` somewhere in the suite

The 5s `hookTimeout` fires on the afterEach `rmSync(ws.path, { recursive: true, force: true })` in 3-5 of the 11 files, intermittently across full-suite runs.

## Why

On Windows, `%TEMP%` is a per-user directory backed by NTFS with
opportunistic locking. When 11 vitest forks each call `os.tmpdir()`
and `mkdtempSync` at the same moment, plus several of them then
acquire a `.lock` sidecar on a file under `%TEMP%/<random>/`, the
NTFS handle table backs up. The `rmSync(ws.path, { recursive: true, force: true })`
in afterEach then has to enumerate and close every open handle
before the recursive delete can complete; the 5s budget is not
enough.

## Fix (slice 6 of the 2026-07-30 test-rebuild epic)

Two-line fix in `vitest.config.ts` + `tests/unit/_setup/tmp-workspace.ts`:

1. Bump `testTimeout: 30_000` and `hookTimeout: 30_000` in vitest.config.ts.
   30s is the smallest budget that consistently runs the full 11-file
   suite green across 3 consecutive runs (82s each).
2. Move the afterEach `rmSync` to `setImmediate` so the hook itself
   returns within the hookTimeout, even when the recursive delete is
   slow. The next test's beforeEach is not blocked on the previous
   file's rmSync.

Commit `b4dce497` (SquabbyZ sole author).

## How to apply

- The 30s budget is NOT a sign the test is slow; it is a sign the
  parallel-fs contention is real. The actual test logic runs in
  < 100ms in pure unit tests; the 30s headroom absorbs the
  Windows-specific tmpdir lock contention.
- DO NOT switch to `pool: 'threads'`. Threads share module-scoped
  state, which breaks the `active` / `previousCwd` single-instance
  invariant in `tests/unit/_setup/tmp-workspace.ts`. The whole
  point of antfu-style tmp workspaces is per-file isolation; threads
  would silently re-introduce the cross-file state leaks the old
  464-line vitest.config.ts was designed to avoid.
- DO NOT bump to 60s+ without first checking whether the test
  actually needs more time. 30s is enough for `withFileLockSync`
  under contention. If a test legitimately needs 60s+, it MUST
  pass an explicit `it('name', fn, { timeout: 60_000 })`.
- If a future test or a future Windows version changes the
  %TEMP% contention profile, re-validate this fix by running
  `for i in 1 2 3; do pnpm vitest run; done` and checking that
  all 3 runs are green.

## Related

- `2026-07-30-test-rebuild-epic-sediment.md` — the 12-commit
  table that motivated this fix
- `peaks-b1-coverage-global-setup-false-positive-2026-07-26.md` — a
  different Windows-only flake in the same suite, fixed at a
  different layer (coverage gate vs hookTimeout budget)
