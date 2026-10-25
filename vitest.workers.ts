// Single source of truth for the vitest worker count, shared by all SEVEN
// vitest configs: the four at this root (`vitest.config.ts` unit /
// `vitest.config.integration.ts` / `vitest.config.lint.ts` /
// `vitest.config.e2e.ts`) and the three package configs
// (`packages/peaks-loop-mut`, `packages/peaks-loop-shared`,
// `packages/peaks-loop-shared-channel`, each importing this file as
// `../../vitest.workers.js`).
//
// Why this file exists: the value used to live only in `vitest.config.ts`,
// so the other configs silently inherited vitest's own default (one
// worker per core). Any change to the policy therefore had to be repeated in
// every config, and a half-applied change would be invisible — each config
// would keep working, just with a different concurrency. That is the same
// hand-maintained-duplicate failure this repository has hit before, so the
// number is defined once and imported everywhere.
//
// The claim above is now measured, not asserted: this header used to read "all
// four vitest configs", and by the time slice c5-verifier-concurrency counted
// them there were seven, three of which imported nothing and set nothing. A
// prose census rots. `tests/unit/standards/vitest-worker-cap.test.ts` walks the
// filesystem for every `vitest.config*.ts` (this root and `packages/*/`), loads
// each one the way vitest loads it, and fails — naming the file — when a config
// declares no cap, hard-codes a literal instead of importing this module, or
// resolves to something other than the value below.
//
// History (kept because the number is a measured choice, not a guess):
//   `floor(cpus/2)` was chosen for the 2026-07-30 test-rebuild epic after
//   measuring 8.8x oversubscription (aggregate test time 3359 s vs wall 383 s
//   on 16 cores), which produced 17 timeouts; the halved schedule took that to
//   0 timeouts and 705 -> 722 passing.
//
// Current default: a FIXED 2, kept because a workstation buys more from
// determinism than from wall clock. The load-shaped flakes this file used to
// cite as the reason for the fixed 2 have NOT been reproduced at higher
// concurrency, and that is now a measurement rather than a memory.
//
// MEASURED 2026-10-25, full unit suite (629 files, 6831 cases, vitest
// 4.1.10, win32/16 cores): 854.74 s at 2 workers, and 505.3 s at 4 (489-534 s
// across two 4-worker runs). Between 2 and 4 workers EXACTLY ONE assertion
// flipped, and it was environment-dependent rather than concurrency-
// dependent: `tests/unit/standards/vitest-worker-cap.test.ts` compared the
// worker count this process imported against a hard-coded default, and
// since this module READS `PEAKS_VITEST_MAX_WORKERS` to decide that count,
// setting the variable could only ever make the assertion fail. It now
// compares against the value the import-time environment implies, and it
// holds at 2 and at 4. So 4 workers introduced no load-shaped flake.
//
// The escape hatch is therefore USABLE, and CI uses it: the `test` job and
// the `test-duration-ratchet` job both set `PEAKS_VITEST_MAX_WORKERS=4`.
// What the suite costs in wall clock is no longer discovered when a CI job
// times out — `.husky/test-duration-ratchet.mjs` measures it, compares it
// against `.peaks/lint/test-duration-ceiling.json`, and fails when it grows.
//
// Override precedence: `PEAKS_VITEST_MAX_WORKERS` (if a positive integer),
// else the fixed default below.
export const DEFAULT_MAX_WORKERS = 2;

function parseOverride(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
}

export const maxWorkers =
  parseOverride(process.env.PEAKS_VITEST_MAX_WORKERS) ?? DEFAULT_MAX_WORKERS;
