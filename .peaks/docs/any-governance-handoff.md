# any-governance program — handoff

> Written 2026-09-23 at the end of an execution session, for whoever picks this
> up next. The repo is the record; this file is the index to it.

## Where things stand

- **HEAD `21f48860`, PUSHED — and CI is GREEN on it: all 6 jobs.** It was red on
  the two preceding pushes (`c1c99c03`, `c189bb19`: each failed 4 of 6), from a
  single cause. See "The CI was red, and it was one line" below before touching
  anything there.
- **Ratchet ceiling: `eslintFindings = 2878`**, ratified after B4 (it was left at
  2943 until the gate could be re-run; see "The one gap" below, now closed).
- Last full `test:unit`: **312 files / 3476 passed / 0 failed / 3 skipped**, in
  **177.22 s** on a host ~1.7 h into its boot. The same suite took **273.88 s** at
  ~14 min of uptime and **936 s** degraded. The 312/3476 is 311/3468 plus the new
  `tests/unit/shared/json-parse.test.ts`.

## A red full-suite run here is NOT evidence of a regression — the evidence

Two runs of the *same* 36-commit tree, back to back, during the push:

| run | result | wall clock |
|---|---|---|
| first (blocked the push) | 6 files failed, 17 tests failed | **2170 s** |
| second (pushed) | 311 files passed, 0 failed | **1128 s** |

Identical code. **Every one of those 17 failures also passed in isolation** (86/86
across the 6 files). So a red full-suite run on this box is NOT by itself evidence
of a regression; check the wall clock first, and re-run before diagnosing.

**"Load" was the wrong variable, and the real one was found the same day — see
"The lead was WRONG: the discriminator is UPTIME" below.** The same 311-file /
3468-test suite ran in **273.88 s, green on the first try**, on a freshly booted
host. Nothing about the code changed; the host did.

`--no-verify` is **blocked by a project hook** (`BLOCKED: --no-verify flag is not
allowed with git push`). Do not try to route around it.

### The structural gap this exposes — one family was a phantom, one instance survived

Tests that depend on an environment prerequisite express "the environment is not
satisfied" and "the code is broken" **with the same signal — a red test**. Two
families, and only one of them held up:

- **Real symlinks — FALSIFIED 2026-09-23, no work remains.** This bullet used to
  read "`codegraph-dir-containment.test.ts` already DOCUMENTS this and adapts via
  `linkDir()`; **the others may not**." Enumerating every link-creating site in
  the repository: 18 sites across 7 test files, and every one is either a
  `'junction'` (**Windows needs no elevation for a directory junction** — it is
  precisely the fallback the codegraph fixtures use when `'file'` is refused), a
  `linkSync` hard link (unprivileged within one NTFS volume), or already guarded
  by an explicit `EPERM`/`EACCES`/`UNKNOWN` capability check. **There are ZERO
  unguarded `'dir'`/`'file'` sites.** The speculation was wrong, and it was wrong
  in the direction that costs a session: it named a slice that did not exist.
- **Subprocess-heavy tests** need a host that is not ~20–80x slow. B3 recalibrated
  the budgets for a *degraded* host, but the degradation turned out to track
  **uptime** and resets on reboot — so the real prerequisite is the **inverse** of
  the obvious one: not "this machine is fast" but **"this boot is recent"**
  (`LastBootUpTime`). That is a thing a test can actually check and say, rather
  than a budget that quietly flaps. See "The lead was WRONG: the discriminator is
  UPTIME" below.

The principled fix — make a test **state its prerequisite** when the prerequisite
is absent, not skip it and not weaken an assertion — did find exactly ONE surviving
instance, in neither of the places named above. `tests/unit/services/web/playwright-loader.test.ts`
wrapped its junction fixture in a bare `catch { return; }`, so a genuine fixture bug
would have reported **a green test that executed nothing**. It is now the shape
`codegraph-exclude-repair-hardening.test.ts` established: catch narrowed to the
privilege codes, everything else rethrown, and the refusal branch ASSERTED so the
skip is recorded rather than silent.

**Note where it survived, because that is the reusable part:** the repository's
silent-catch guard scans `SCAN_ROOTS = ['src']`, and J03's invariant names
`src/services/**`. A test that silently skips therefore sits outside every guard
that looks for exactly this shape — which is why the one instance left had to be
found by reading, not by a gate.

### The any program is essentially closed

TS-side `no-unsafe-*` went **817 → 281 → 236 → 102 → 37**.

**The last 37 are NOT repo-side leaks.** Batch B4 named their six entries, and all
of them are **outside this repo's source** — which is exactly why an instrument
that walked 60 lines up from each finding looking for eight repo patterns found
nothing. Full detail and the per-root table are in `913b453c`'s commit message
and `.peaks/_runtime/2026-09-19-session-b7530f/rd/b4-report.txt`.

**Do not re-open those 37 as a repo cleanup.** Three of the six roots
(`@types/node`'s `Readable.on('data', cb)`, `String.replace`'s replacer,
`vi.fn()`'s `Procedure`) are 19 findings of pure parameter annotation; one root
(`fzf@0.5.2`'s `.d.ts`) is a genuine defect but needs a dependency decision; one
(`no-unsafe-finally`) is not an `any` root at all — it is **core ESLint** control
flow, swept in because the bucketer matched on the **name** `no-unsafe-*`.

## The one gap in this state — CLOSED

**`pnpm gate:repo` was killed by the harness for low system memory** part-way
through, so batch B4 carried **no independently measured findings total, no
per-rule census, and no full-suite run**. The agent reported 2878 findings
against the 2943 ceiling and a 309/311 full run with 2 host timeouts; those were
**its** measurements and were recorded as **unconfirmed**.

**Closed 2026-09-23** (commit `ce8d9af3`, whose message records it): the gate was
re-run, **2878 was confirmed exactly**, and the ceiling was ratcheted 2943 → 2878.
`.peaks/lint/gate-baseline.json` now reads `eslintFindings: 2878`, with the
per-file map regenerated too. The 309/311-vs-311/311 discrepancy was the host, not
the code — see the uptime section below. **There is nothing to re-run here.**

## The lead was WRONG: the discriminator is UPTIME

**Falsified 2026-09-23, ~14 minutes after a reboot.** The reading below was real;
its causal attribution was wrong in both of the ways it could have been.

| operation | B3 (09-22) | now (fresh boot) | ratio |
|---|---|---|---|
| `node -e 0` | med 1.45 s | **med 69 ms** | 21× faster |
| `git --version` | med 1.76 s | **med 22 ms** | 80× faster |
| `taskkill /T /F /PID 99998` | med 37.6 s (max 89.7) | **med 0.6 s** | 63× faster |
| `tasklist /FI "PID eq 99998"` | 23.5 s | **med 296 ms** | 79× faster |
| full `tasklist` dump | **46.6 s @ 263 procs** (B1) | **0.433 s @ 293 procs** | 108× faster |

**`360tray` is RUNNING right now and the host is healthy** — its presence is not
the cause, so the "configure exclusions" lead is dead. The second alternative dies
too: there are MORE processes now (293 vs 263) and the dump is 108× faster, so the
count is not the mechanism either.

**The variable that fits every data point is uptime.** System event log 6005: the
host booted `09-18 19:21` and ran **continuously until `09-23 19:11`** — so S6,
B1, B3, the B4 gate run, AND the "load-flaky" table above ALL ran inside one
~4.5-day boot. Inside it `git --version` climbed monotonically with age (0.42 s at
~1 day → 1.4 s → 1.76 s at ~4 days), and a reboot returned it to 0.022 s.
`process.kill` stays 0 ms and pure file I/O stays 0 ms in both states — so this
degrades process CREATION and ENUMERATION, not syscalls generally.

**What this changes:**
- **Do NOT chase 360 exclusions.** That lead is falsified.
- Before diagnosing a red full-suite run, read the uptime:
  `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime"`.
  Over ~1 day old: reboot, re-run, re-measure. It is not a regression.
- The pre-push hook's leg 2 measured **936 s degraded → 274 s fresh** (hook total
  1057 s → 294 s) — same suite, same 311 files / 3468 tests, green first try.
- **Not settled:** whether 360 merely *amplifies* the slope. Untested — it needs a
  multi-day experiment or turning the AV off, and neither was done. Do not assert
  it either way.

**The budget consequence is a DECISION, not a mechanical change.**
`SUBPROCESS_TEST_TIMEOUT_MS = 300_000` / `HEAVY_SUBPROCESS_TEST_TIMEOUT_MS =
400_000` were sized against a DEGRADED host, where the worst spawn now measures
~0.6–0.9 s. The file itself states the direction-of-error argument: an
over-generous budget costs **speed of signal** — a genuinely hung test waits
300–400 s to report. But lowering them to healthy-host numbers would go red again
on day 2 of an uptime window. That is the user's call, not a rider on anything.

## The CI was red, and it was one line

`c1c99c03` and `c189bb19` each failed FOUR of the six jobs — `vitest + build` on
ubuntu, macos AND windows (`Run capability guards`), plus the integration suite.
ONE test caused all four: `tests/integration/capability-guard/J03-problem-resolution-flow.test.ts`,
whose contract runs `scripts/lint/silent-warning-detector.mjs` and compares its
per-rule counts against a frozen ceiling.

    catch-return-null = 42   against a CEILING of 41

The +1 was `src/shared/json-parse.ts`'s `tryParseJson`, whose `T | null` return
collapsed "the text is not JSON" and "the text is JSON of the wrong shape" — the
exact shape that ratchet exists to catch. It was NOT a newly swallowed error:
`JSON.parse` makes the catch unavoidable, and the user had adjudicated this
primitive's semantics on 2026-09-21 (parsing must fail loudly; a wrong shape is
skipped). What was missing was any way to SAY that — which is why
`src/services/sediment/pool-read.ts` had to hand-roll its parse in two steps.

`21f48860` gives the primitive a discriminated `TryParse<S>`
(`{ ok: false, reason: 'malformed' | 'shape' }`). **The ceiling was NOT raised** —
the ratchet's unit is a count, and raising it would have recorded a real capability
as debt. Eight call sites across three module-private helpers (`session-binding-bridge`,
`session-manager`, `skill-presence-service`; all already `| null`, so nothing
cascaded) collapse the result at their own call site.

**The method generalises, so it is recorded rather than only the answer.** To find
WHICH site is the new one, intersecting the 42 with "files changed since the last
green CI" gave 40 candidates out of 728 changed files — useless. What worked:
run the SAME detector against the last known-good tree (`3285e205`) and diff the
two lists, then pair added↔removed per file. 30 of the 31 "added" were the same
sites shifted a few lines; exactly one had no counterpart. A count-ratchet tells
you the total moved; it never tells you which line did it.

## What is deliberately NOT done

Each of these is recorded in a commit message; none is a surprise:

- **The remaining manually-maintained count pins.** Batch B1 fixed that class on
  ONE guard by replacing its literals with cross-measurements (an independently
  sourced reach number plus injection arms — the working example is
  `tests/unit/standards/esm-relative-import-extension.test.ts`). B4 did the same
  for the async guard. **If you add more such guards, copy that pattern rather
  than writing a new literal** — a pin whose expectation is derived from the
  traversal it guards is a **tautology**, not a guard.
- **B4 task 1 touched 5 integration files that have never EXECUTED** — the
  integration config refuses to start against a stale `dist/`. Run `pnpm build`
  first, then those files.
- **~30 tests in annotated files still run under the global 30 s** at 15–24 s
  measured: about 30 % headroom. Thin, not red.

## The execution regime (read this before dispatching)

`.peaks/docs/slice-execution-regime.md` records four efficiency levers the user
adopted after a run that produced ~20 sub-agent-hours for −45 findings (three of
those slices produced **zero**):

1. **Batch 3–5 roots per dispatch** — verification is paid per slice, not per root.
2. **Full `test:unit` only at batch boundaries**; scoped tests inside.
3. **Pins must not need manual maintenance.**
4. **Mechanical one-line changes: the orchestrator may apply them directly** —
   with a deliberately narrow scope (a pin literal or a test `timeout`), only
   with an independently measured justification, and **always declared**. The
   declaration obligation is the load-bearing part, not the permission.

It worked: batch B2 cut **−135 findings in one dispatch**, against −45 across the
four slices before it.

## Known host flakiness — do not chase it

A wall-clock timeout **in a file you never touched** is the known host problem.
`tests/unit/_setup/subprocess-timeouts.ts` carries a **host-fingerprint table**
(S6 / B1 / B3 columns) precisely so you can tell "the host changed" from "the
tests got slower". Report such a failure; do not widen a budget for it and do not
re-open it as a regression.

**Check UPTIME first — it is the discriminator, not load.** See "The lead was
WRONG" above: the S6/B1/B3 columns are three points on ONE degradation curve
inside a single ~4.5-day boot, and a reboot resets it (a fresh boot put the same
suite at 273.88 s, green). If the fingerprint's `taskkill` row reads tens of
seconds, read `LastBootUpTime`; over ~1 day old, reboot and re-run before
touching anything.

The budgets were recalibrated in batch B3 by S6's own method (worst measured
member × 4), and the file documents the direction-of-error argument: an
over-generous budget costs **speed of signal**, an over-tight one costs
**correctness of signal**. The injection control still holds — a real
never-resolving promise in an annotated test still fails.
