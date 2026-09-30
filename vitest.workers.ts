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
// Current default: a FIXED 2. This repository then hit load-shaped flakes at
// higher concurrency — tests that fail only when several suites run at once,
// which are indistinguishable from real failures and cost real diagnosis time.
// A low, predictable default buys determinism for everyone at the price of
// wall clock, and `PEAKS_VITEST_MAX_WORKERS` is the escape hatch for CI or a
// workstation that wants the speed back.
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
