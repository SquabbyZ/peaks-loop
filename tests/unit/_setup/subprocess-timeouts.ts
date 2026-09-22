// tests/unit/_setup/subprocess-timeouts.ts
//
// Explicit, measured per-test budgets for the tests whose cost is REAL process
// spawns — the one class the global `testTimeout` is not sized for.
//
// WHY THESE EXIST (slice rid-s6-slow-test-timeouts, measured 2026-09-19)
//
//   The global `testTimeout: 30_000` is a HANG detector. It is a generous budget
//   for the ~3,400 tests that run in-process in milliseconds. It is NOT a
//   performance budget for a test that shells out to a real program, because the
//   cost of such a test is host process-spawn latency. On this machine
//   (Windows 11, 16 cores), as S6 measured it:
//
//     one `git <sub>` spawn ..................... 0.42 s   (measured, S6)
//     a 9-spawn git fixture (init + 2 commits) ... 6.78 s   (measured, S6)
//     one `prepareFinalReview()` call ........... 11-13 git spawns
//
//   and the same test's cost moves between runs: the 2-spawn
//   `service-shutdown` test measured 44.0 s alone and 97.5 s inside the full
//   suite, and one `final-review` test measured 38.5 s in the suite against
//   69.1 s alone (both S6). So a fixed 30 s budget cannot hold this class: the
//   measured full suite produced 9 `Test timed out in 30000ms` failures, every
//   one in a subprocess-heavy file, and every one green in isolation.
//
// THE `taskkill` TERM IS A HOST PROPERTY, NOT A BUDGET PROPERTY (slice B1,
// re-measured 2026-09-22; recorded here because it is the one term in this
// table that no budget in this file can absorb):
//
//     `cmd /c ver` (a bare spawn) ....................   1.2 s
//     `taskkill /?` (loads taskkill, no PID lookup) ...   1.6 s
//     `taskkill /T /F /PID 99998` (missing) ...........  27-155 s   (B1)
//     `taskkill /T /F /PID <live child>` ..............  155 s AND FAILED
//                                                         (status 128)
//     `tasklist /FI "PID eq 99998"` ...................  23.5 s
//     `process.kill(99998, 'SIGKILL')` ................   0 ms (ESRCH, correctly)
//     `process.kill(<live child>, 'SIGKILL')` .........   1 ms (works)
//
//   So the cost is NOT process spawn, NOT the shell, NOT a retry loop and NOT a
//   wait timeout: it is Windows process ENUMERATION, which `taskkill` and
//   `tasklist` share, and it is degraded on this host independently of load
//   (263 processes; a full `tasklist` dump takes 46.6 s). It is not in the
//   repository. That is why `service-shutdown.test.ts` sits ON its budget
//   rather than safely under it.
//
// THE GLOBAL BUDGET IS DELIBERATELY NOT RAISED. Two independent reasons:
//   1. `tests/unit/vitest-concurrency-guard.test.ts` pins `testTimeout: 30_000`
//      as the anti-fake-green rule — "Raising testTimeout is the false-pass
//      trap. The cap must remain the fix, not a wider timeout."
//   2. A global raise is class-blind: it would also let a genuinely hung PURE
//      test take 4x longer to report, on all ~3,400 of them.
// The repo's own convention already prescribes the narrow form instead: "If a
// test legitimately needs 60s+, it MUST pass an explicit
// `it('name', fn, { timeout: 60_000 })`" (2026-07-30 test-rebuild sediment).
//
// ===========================================================================
// B3 RECALIBRATION (2026-09-22) — S6's METHOD, RE-RUN ON THIS HOST
// ===========================================================================
//
// S6's method, which this section re-runs rather than substitutes: a budget is
// the worst MEASURED member of its class x a stated multiple. "Raise it until
// it stops going red" is not that method, and is not what was done here.
//
// HOW IT WAS MEASURED. All 49 test files that import this module were run ONE
// AT A TIME, sequentially, alone on the host, with `vitest run <file>
// --reporter=json` so per-test durations could be read back. Nothing else was
// run concurrently, because a measurement taken under load cannot be
// distinguished from a budget that is too small — a mistake already made three
// times on this host. 589 tests were measured; 202 of them carry one of these
// two budgets (145 SUB, 57 HEAVY).
//
//   run 1, class totals:  SUB   145 tests, 1240 s, median 4.2 s, p90 25.9 s, max 61.4 s
//                         HEAVY  57 tests, 1349 s, median 17.0 s, p90 48.8 s, max 72.7 s
//
// The 7 costliest files were then re-run a second time under the same
// conditions (117 tests paired), because a single sample cannot tell a budget
// what the spread is. The two class-worst members, measured twice, in seconds:
//
//   SUB   final-review/pre-post-diff :: counts modifier spellings and a
//         commented line the same way on both sides .............. 25.9 | 76.3
//         final-review/final-review-service :: inlines every source
//         whole or omits it — never a slice in between ........... 31.9 | 65.5
//         final-review/final-review-service :: reaches a dimension whose
//         only evidence is the very last source in the order .... 61.4 | 25.8
//         final-review/pre-post-diff :: reports an empty range as
//         unavailable instead of NO STRUCTURAL DRIFT (F8) ....... 19.0 | 54.2
//         WORST-OF-TWO MEMBER ...................................       76.3
//
//   HEAVY final-review/final-review-service :: delivers the CONCLUSION
//         even when the artifact is over the per-file cap ....... 31.5 | 97.0
//         services/dispatch/service-shutdown :: when invoked, should
//         preserves the order of registrations .................. 67.3 | 89.8
//         services/dispatch/service-shutdown :: returns skipped:
//         not-running for a pid that does not exist (win32) ..... 33.3 | 76.8
//         final-review/final-review-service :: inlines every present
//         evidence source into the prompt ....................... 72.7 | 27.8
//         WORST-OF-TWO MEMBER ...................................       97.0
//
// THE MULTIPLE, AND WHY IT CHANGED. S6 used 3.6x (SUB) and 2.5x (HEAVY),
// justified by the "2-3x spread" it had measured. This calibration uses 4x,
// because the spread itself grew and the old multiples no longer clear it:
//
//   - across the paired set the SAME test's cost moved by up to 4.65x between
//     two controlled runs (max/min), and both class-worst members moved by
//     2.95x / 3.08x. S6's "2-3x" is now the small end of the distribution.
//   - the largest number anyone has recorded for a member of this class is the
//     `service-shutdown` order test at 287 s under full load (slice S16) -
//     2.96x the 97.0 s it measured here, and against a 240 s budget. A 2.5x
//     multiple leaves zero headroom on exactly the case that went red.
//   4x is therefore the smallest multiple that clears the measured spread with
//   margin instead of landing on it, and the values are rounded UP to whole
//   minutes, never down.
//
//   SUBPROCESS_TEST_TIMEOUT_MS = 300_000
//     worst-of-two member 76.3 s x 4 = 305 s -> rounded up to 300 s
//     (rendered multiple 3.93x; 4.89x the single-run member of 61.4 s).
//     It also covers the full-suite run that blew the old 90 s budget on this
//     class with >= 3.3x to spare.
//
//   HEAVY_SUBPROCESS_TEST_TIMEOUT_MS = 400_000
//     worst-of-two member 97.0 s x 4 = 388 s -> rounded up to 400 s
//     (rendered multiple 4.13x; 5.50x the single-run member of 72.7 s).
//     It covers the 287 s full-load observation above at 1.39x, i.e. that run
//     would have been green without being close.
//
// ===========================================================================
// DIRECTION OF ERROR — WHY THIS CALIBRATION ERRS GENEROUS
// ===========================================================================
//
// The two ways a budget can be wrong are NOT symmetric, and the asymmetry is
// the whole justification for the numbers above:
//
//   - Over-generous: the cost is SPEED OF SIGNAL. A test that genuinely hangs
//     still goes red — later, at 300 s / 400 s instead of 90 s / 240 s. A hung
//     test does not stop hanging, so a wide budget cannot produce a false green.
//   - Over-tight: the cost is CORRECTNESS OF SIGNAL. A test that is working
//     goes red, and every such red costs a diagnosis that finds no defect. That
//     is what this slice was opened for: `service-shutdown`'s order test
//     measured 223 s (B1) and 287 s (S16) against a 240 s budget, and one
//     `final-review-service` test exceeded the 90 s budget under load.
//
// A delay is recoverable; a lie is not. So this calibration deliberately errs
// on the side that is wrong cheaply, and it says so here rather than letting a
// bigger number imply it.
//
// What a budget must still do is FAIL on a hang, which it does — and the
// injection control for that is pinned in the S6 slice: a real
// `await new Promise(() => {})` in an annotated test still goes red. An
// over-generous budget changes WHEN that red arrives, not WHETHER.
//
// ===========================================================================
// HOST FINGERPRINT — run these four before blaming a budget
// ===========================================================================
//
// Measured by printing the cost of one call each, in the same call shape the
// source uses (`node -e` / `execFileSync` / `process.kill`):
//
//   command                                  S6 09-19     B1 09-22    B3 09-22
//   `node -e 0` (bare node spawn)            -            ~0.85 s     min 0.95 / med 1.45 / max 2.69 s (n=7)
//   `git --version` (bare git spawn)         0.42 s       1.4 s       min 1.70 / med 1.76 / max 3.71 s (n=7)
//   `taskkill /T /F /PID 99998` (missing)    18.7-28.7 s  27-155 s    min 37.1 / med 37.6 / max 89.7 s (n=3)
//   `process.kill(99998, 'SIGKILL')`         -            0 ms        0 ms (n=7, ESRCH — correct)
//
//   A healthy host finishes all four in about the cost of one bare spawn
//   (60-100 ms each on a normal box); `node -e 0` is ~15-25x that here, and
//   `taskkill` is 1.3-5x further degraded than S6's already-degraded range.
//   Read the table that way: if the top two rows have inflated 10x+ while the
//   taskkill row is in the tens of seconds, the HOST changed — the tests did
//   not get slower, and the budgets above were already sized for it.
export const SUBPROCESS_TEST_TIMEOUT_MS = 300_000;
export const HEAVY_SUBPROCESS_TEST_TIMEOUT_MS = 400_000;
