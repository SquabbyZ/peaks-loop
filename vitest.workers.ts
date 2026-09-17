// Single source of truth for the vitest worker count, shared by all four
// vitest configs (unit / integration / lint / e2e).
//
// Why this file exists: the value used to live only in `vitest.config.ts`,
// so the other three configs silently inherited vitest's own default (one
// worker per core). Any change to the policy therefore had to be repeated in
// four places, and a half-applied change would be invisible — each config
// would keep working, just with a different concurrency. That is the same
// hand-maintained-duplicate failure this repository has hit before, so the
// number is defined once and imported everywhere.
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

export const maxWorkers = parseOverride(process.env.PEAKS_VITEST_MAX_WORKERS) ?? DEFAULT_MAX_WORKERS;
