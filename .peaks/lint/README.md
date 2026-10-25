# `.peaks/lint/` — what these files are, and what their metadata does NOT say

Added 2026-09-25 with `rid-6f1df581`. Written because the two files that then lived here carried
metadata that was **byte-identical to `HEAD` while their contents had changed**, and nothing in the
repository explained the difference. Their only account lived in a gitignored session handoff, which is the same defect as a
comment the code contradicts.

## `baseline.json` — the per-file waiver

**Read by** `matchBaseline` / `loadBaseline` (`src/services/lint/eslint-runner.ts`). A finding whose
`ruleId` + `file` + `line` + `severity` + `message` matches an entry is moved out of `findings` and into
`baselineWaived`. **Written by** `peaks lint baseline` (`writeBaselineJson`,
`src/cli/commands/lint-commands.ts`).

### Its two dates are different, and the file says neither

| what | when | which tool |
|---|---|---|
| the **violations** | `generatedAt: 2026-08-07T01:47:16.559Z` | `toolVersion: peaks-loop-4.0.16+` |
| the **`file` keys** | 2026-09-25 | peaks-loop **4.0.54** |

`generatedAt` and `toolVersion` are the original generation's, and they were **deliberately left
untouched** by the re-rooting, because they are the true provenance of the *entries*. They are
therefore **not** the provenance of the keys. A reader who takes the header as describing the whole file
will be wrong, which is why this file exists.

### Why the keys were re-rooted in place rather than regenerated

Before 2026-09-25 every `file` key was an **absolute** path rooted at a different machine
(`C:\Users\smallMark\Desktop\peaks-loop\`). `matchBaseline` compares by exact string, so on any other
checkout the waiver was **null** — not degraded, null — and editing a baselined file surfaced its own
pre-existing violations as **new** findings.

`peaks lint baseline` could not be used to fix it. It writes **`full scan MINUS what the existing
baseline covers`**, so the 7 tuples the reader was waiving were absent from its output
(`2881 + 7 = 2888`). That is **not a snapshot of the tree**, and regenerating would have replaced 192
reviewed waivers with 2881 unreviewed ones across 692 files instead of 53.

So the data was **transformed in place**, and the transform was checked as a multiset:
`ruleId|file|line|severity|message` is identical before and after, 0 entries added, 0 dropped. (192
entries over 185 distinct tuples: 6 collision groups contribute 7 extra entries — genuinely distinct
violations that share a line.)

`peaks lint baseline` now emits **repo-relative** keys, so a future regeneration no longer re-roots the
file at whichever machine ran it.

## `gate-baseline.json` — the ratchet

A **different artifact** with a different reader. It holds repo-wide ceilings
(`eslintFindings`, `prettierUnformatted`, `tscErrors`), not per-file waivers. Changing this file changes
a ceiling; changing `baseline.json` changes which findings are exempt. They are not
interchangeable and a fix to one is not a fix to the other.

## `coverage-floor.json` — the coverage floor, which points the OTHER way

A third artifact with a third reader, and a direction that is the mirror image of the ratchet above.
Do not read this file with the reading the one above taught you.

| | `gate-baseline.json` (`ceilings`) | `coverage-floor.json` (`linesPct`) |
|---|---|---|
| what it is | a **ceiling** | a **floor** |
| which way it may move | only **DOWN** | only **UP** |
| a rise means | a regression — refused | the outcome the gate exists to encourage |
| **read by** | `.husky/peaks-gate-baseline.mjs` and the monotonic trips | `.husky/coverage-ratchet.mjs` |
| **written by** | `.husky/peaks-gate-baseline.mjs` | `.husky/coverage-ratchet.mjs --raise` **only** |
| **population** | the repository's lint scope | `src/**`, pinned by path AND by row count |

**Why it could not be a row in `ceilings`.** The decisive reason is the **direction**:
`compareCeilings` puts a *rise* into `raised`, and any `raised` row is `ok: false`, so that machinery
accepts only a fall. A coverage floor may only rise, and the good direction for coverage is precisely
the change it refuses. A second, weaker reason: `ceilingProblem` requires `Number.isInteger`, so a
**fractional** percentage cannot live there. (It is *not* true that a percentage cannot live there "at
all" — `Number.isInteger(47.0)` is `true`, and 47.0 is this artifact's own seed. The direction argument
stands alone; recorded because the first draft of this section overreached and a review caught it.)

**Read by** `.husky/coverage-ratchet.mjs`, run by the CI job `coverage-ratchet`. It measures `src/**`
under vitest coverage, prints the population it measured on every run (so "0 files measured" can never
read as green), and fails when the measured line percentage is below `linesPct`. The boundary is
**inclusive**: measured equal to the floor holds, because a ratchet set at the value it just wrote must
not be red on the tree it wrote on. The population is pinned **twice** — every row must be under
`src/`, *and* the report must account for at least `files` rows — so a report holding a mere subset of
the source cannot read green at a high percentage.

**Written by** that script's `--raise` mode and nothing else, so the number is measured rather than
typed. `--raise` records the measurement it just made minus a 0.5 pp margin, and **refuses** to write a
value below the floor already on disk — the tool cannot lower the bar. Lowering is therefore a hand
edit, and the script reads HEAD's copy with `git show` and refuses a working copy lower than HEAD's
unless `--lower-floor` says so explicitly, so that lowering is a **named act** rather than one nobody
notices.

**Its fields, and which of them a reader may trust.** `linesPct` is the enforced floor and `files` the
enforced row count. `measuredPct`, `measuredOn` and `measuredAt` are the measurement the floor was
derived from and the platform it came from, kept beside the floor so the margin is an inspectable fact
rather than a claim in prose. **Recalibrated 2026-10-16:** `measuredPct` was **inherited** at the seed
from another slice's run and never reproduced by this artifact's own command, so the floor is now
`round2(measuredPct − margin)` off a **measured** figure — written by a hand edit plus `--lower-floor`,
because `--raise` provably cannot lower the bar. That figure is a **`measuredOn: "win32"`** measurement
applied to a job that enforces on **ubuntu**; the `note` carries that caveat, the size of the
platform-conditional surface under `src/**` (76 lines across 32 files by
`git grep -n -E "process\.platform|win32|darwin|IS_WINDOWS|isWindows" -- src`, ≈0.18 pp in the worst
case), and what to do if CI prints `BREACHED`. The measuring expression is also **root-anchored**
(`<root>/src/**`, forward-slashed, and with the root escaped as a glob literal): vitest matches
`coverage.include` with picomatch `{ contains: true }`, so the bare `src/**` used to admit
`packages/*/src/**` rows for modules the tests imported directly — which is what made this artifact's
first real measurement refuse. A percentage here is only
comparable to another percentage produced by the same measuring expression: the denominator is whatever
`.husky/coverage-ratchet/report.mjs` declares, so a figure from a different tool is a different
quantity wearing the same units. The two denominators in play are **185,914** (the c8 method, ~88 % of
`src`'s physical lines) and **42,415** (this ratchet's executable line entries over the same files, as
last measured);
they are not interchangeable, and the floor's number is on the second.

## `test-duration-ceiling.json` — the unit suite's wall clock, a third direction

A fourth artifact, and a third DIRECTION: a **ceiling** whose good direction is **DOWN**.
`gate-baseline.json` holds ceilings that may only fall and `coverage-floor.json` holds a
floor that may only rise; this one is a ceiling, so it behaves like the first — and it is a
separate file because its unit is SECONDS, a quantity that belongs to no row of any other
artifact here.

| | `gate-baseline.json` (`ceilings`) | `coverage-floor.json` (`linesPct`) | `test-duration-ceiling.json` (`ceiling.wallSeconds`) |
|---|---|---|---|
| what it is | a **ceiling** on counts | a **floor** on a percentage | a **ceiling** on wall-clock seconds |
| which way it may move | only **DOWN** | only **UP** | only **DOWN** |
| a rise means | a regression — refused | the outcome the gate exists to encourage | a regression — refused |
| **read by** | `.husky/peaks-gate-baseline.mjs` | `.husky/coverage-ratchet.mjs` | `.husky/test-duration-ratchet.mjs` |
| **written by** | `.husky/peaks-gate-baseline.mjs` | `.husky/coverage-ratchet.mjs --raise` **only** | `.husky/test-duration-ratchet.mjs --tighten` **only** |
| **population** | the repository's lint scope | `src/**`, pinned by path AND by row count | `tests/unit/**/*.test.ts`, pinned by path AND by file count |

**Why it exists at all.** The repository's `.husky/` gates measured lint findings, coverage,
file size and formatting — NOT ONE of them measured how long the unit suite takes or how
many test files it has. Measured 2026-10-25: the full suite took 854.74 s at 2 workers
(629 files / 6831 cases) and 505.3 s at 4 (489-534 s across two 4-worker runs); the file
count had been growing at about +9.1 files a day since 2026-08-05; and CI's `test` job
carries `timeout-minutes: 60` while never having set `PEAKS_VITEST_MAX_WORKERS`, so CI ran
at 2 workers too. The growth was therefore silent until it hit the job timeout — a symptom
with no cause attached.

**Read by** `.husky/test-duration-ratchet.mjs`, run by the CI job `test-duration-ratchet`
(ubuntu-only). It measures the unit suite, prints the population it measured on every run
(file count, case count, wall clock, concurrency, platform — so "0 files measured" can never
read as green), and fails when the measured wall clock is over the ceiling. The boundary is
**inclusive**: measured equal to the ceiling holds, because a ratchet set at the value it
just wrote must not be red on the tree it wrote on. The population is pinned **twice** —
every file must be under `tests/unit/`, *and* the report must account for at least
`population.files` files — so a report holding a mere subset of the suite cannot read green.

**Written by** that script's `--tighten` mode and nothing else, so the number is measured
rather than typed. `--tighten` records the measurement it just made plus a 300 s margin, and
**refuses** to write a value looser than the ceiling already on disk — the tool cannot
relax the bar. Relaxing it is a hand edit, and the script reads HEAD's copy with `git show`
and refuses a working copy looser than HEAD's unless `--loosen` says so explicitly, so that
a relaxation is a **named act** rather than one nobody notices. A tightening also **raises
`population.files`** to the file count it measured: that row is the trust floor the
subset-report guard is built on, and a floor left at the seed depreciates on its own — the
suite grows, and a report covering half of it still clears the old number.

**Tighten on the machine that ENFORCES the ceiling.** A tightening takes the measurement it
just made, so a local win32 measurement (505.3 s) writes a ceiling (806 s) that an ubuntu
runner — which is slower — breaches on its very first run. That is a loud failure rather
than a silent one, and loud is the right shape: the gate is telling the truth about a number
measured on the wrong machine. Tighten on the enforcing platform, or accept the slower clock
by hand.

**Its fields, and which of them a reader may trust.** `ceiling.wallSeconds` is the enforced
ceiling, and `ceiling.maxWorkers` is the concurrency it was seeded at — a wall clock is
only comparable at ONE concurrency (the same 629 files cost 1.357 s each at 2 workers and
0.776 s each at 4), so a fresh measurement taken at a different concurrency is REFUSED
rather than compared. `population.files` is a trust FLOOR, not a cap: a bigger population is
fine (new files joined), a smaller one is a refusal. `measured.*` is the measurement the
ceiling was derived from and the platform it came from, kept beside the ceiling so that the
margin between them is an inspectable fact rather than a claim in prose.

**THE CROSS-MACHINE CAVEAT, STATED.** The seed was measured on **win32** (16 cores) and is
enforced on **ubuntu**. The ceiling is deliberately loose (2700 s against a 505.3 s local
measurement) so that the job is green on arrival, and the first CI run tightens it with
`--tighten` at the concurrency that job runs. The windows and macos cells of the `test` job
are NOT enforced by this gate — their durations are bounded by that job's own
`timeout-minutes: 60` instead — and that asymmetry is a stated cost of measuring on one
platform, not an oversight.

## Two behaviours worth knowing before trusting a run here

- **`peaks lint check` is diff-scoped** (`inDiff`), so an untouched file surfaces nothing. A green run
  on a clean tree says nothing about whether the waiver works. Demonstrate it by editing a line that
  the baseline covers.
- **`peaks lint baseline` is not idempotent** — its read side ignores `--baseline-file`, so measuring
  against a scratch path does not subtract what the real file covers. This is a known open item, not a
  property to rely on.
- **31 of the entries are `line: 0` parsing errors.** A parse error has no line, so it can never be
  diff-scoped, and it will behave differently from the other entries under `diffOnly: true`.
