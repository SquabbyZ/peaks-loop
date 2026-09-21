// tests/unit/_setup/subprocess-timeouts.ts
//
// Explicit, measured per-test budgets for the tests whose cost is REAL process
// spawns — the one class the global `testTimeout` is not sized for.
//
// Why these exist (slice rid-s6-slow-test-timeouts, measured 2026-09-19):
//
//   The global `testTimeout: 30_000` is a HANG detector. It is a generous budget
//   for the ~3,400 tests that run in-process in milliseconds. It is NOT a
//   performance budget for a test that shells out to a real program, because the
//   cost of such a test is host process-spawn latency. On this machine
//   (Windows 11, 16 cores):
//
//     one `git <sub>` spawn ..................... 0.42 s   (measured)
//     a 9-spawn git fixture (init + 2 commits) ... 6.78 s   (measured)
//     one `taskkill /T /F /PID <missing>` ....... 18.7-28.7 s (6 samples, S6)
//     one `taskkill /T /F /PID <missing>` ....... 27-155 s    (12 samples, B1)
//     one `prepareFinalReview()` call ........... 11-13 git spawns
//
//   THE `taskkill` ROW IS A HOST PROPERTY, NOT A BUDGET PROPERTY (slice B1,
//   re-measured 2026-09-22; recorded here because it is the one term in this
//   table that no budget in this file can absorb):
//
//     `cmd /c ver` (a bare spawn) ....................  1.2 s
//     `taskkill /?` (loads taskkill, no PID lookup) ...  1.6 s
//     `taskkill /T /F /PID 99998` (missing) ........... 27-155 s
//     `taskkill /T /F /PID <live child>` .............. 155 s AND FAILED
//                                                        (status 128)
//     `tasklist /FI "PID eq 99998"` ................... 23.5 s
//     `process.kill(99998, 'SIGKILL')` ................ 0 ms (ESRCH, correctly)
//     `process.kill(<live child>, 'SIGKILL')` ......... 1 ms (works)
//
//   So the cost is NOT process spawn, NOT the shell, NOT a retry loop and NOT a
//   wait timeout: it is Windows process ENUMERATION, which `taskkill` and
//   `tasklist` share, and it is degraded on this host independently of load
//   (263 processes; a full `tasklist` dump takes 46.6 s). It is not in the
//   repository. That is why `service-shutdown.test.ts` sits ON its 240 s budget
//   (223 s in a green run, 287 s in S16's red one) rather than safely under it.
//   Before concluding a budget is too small, run the four commands above: a
//   healthy host finishes all of them in about the cost of one bare spawn.
//
//   and the same test's cost moves 2-3x between runs: the 2-spawn
//   `service-shutdown` test measured 44.0 s alone and 97.5 s inside the full
//   suite, and one `final-review` test measured 38.5 s in the suite against
//   69.1 s alone. So a fixed 30 s budget cannot hold this class: the measured
//   full suite produced 9 `Test timed out in 30000ms` failures, every one in a
//   subprocess-heavy file, and every one green in isolation.
//
// The global budget is deliberately NOT raised. Two independent reasons:
//   1. `tests/unit/vitest-concurrency-guard.test.ts` pins `testTimeout: 30_000`
//      as the anti-fake-green rule — "Raising testTimeout is the false-pass
//      trap. The cap must remain the fix, not a wider timeout."
//   2. A global raise is class-blind: it would also let a genuinely hung PURE
//      test take 4x longer to report, on all ~3,400 of them.
// The repo's own convention already prescribes the narrow form instead: "If a
// test legitimately needs 60s+, it MUST pass an explicit
// `it('name', fn, { timeout: 60_000 })`" (2026-07-30 test-rebuild sediment).
//
// Both values are that explicit form, derived from the numbers above:
//
//   SUBPROCESS_TEST_TIMEOUT_MS = 90_000
//     the tests measured 10-25 s. Worst measured member: 24.7 s.
//     90 s = 3.6x that worst member (and 9x the 10 s floor), so a full 2-3x
//     spread step still fits. 90_000 is also the value this repo already uses
//     for the same class in `services/dispatch/batch-counter.test.ts`.
//
//   HEAVY_SUBPROCESS_TEST_TIMEOUT_MS = 240_000
//     the tests measured >= 25 s. Worst measured member: 97.5 s.
//     240 s = 2.5x that, which covers the largest spread one and the same test
//     showed between two runs (44.0 s -> 97.5 s, 2.2x).
//
// A test given one of these budgets can still FAIL on a hang — later, by the
// value above, which is what a budget means. What it must stop doing is failing
// while it is working. The slice's injection control pins exactly that: a real
// `await new Promise(() => {})` in an annotated test still goes red.
export const SUBPROCESS_TEST_TIMEOUT_MS = 90_000;
export const HEAVY_SUBPROCESS_TEST_TIMEOUT_MS = 240_000;
