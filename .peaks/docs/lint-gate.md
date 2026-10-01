# Lint / format / type gate — what it is and how it descends

> Created 2026-09-19. Companion to `.husky/peaks-gate.mjs` (the gate),
> `.husky/peaks-gate-baseline.mjs` (the regenerator), and
> `.peaks/lint/gate-baseline.json` (the ceilings).

## 1. Why this is a ratchet and not a strict check

The request was "the strictest possible lint / tsc / prettier check on commit,
plus unit tests on push". Measured on 2026-09-19, this repository **does not
pass any of those three repo-wide, and it does not pass them on any individual
file either**:

| Gate | Repo-wide state |
|---|---|
| eslint | 4398 real findings across 1233 files (plus 2390 phantom-rule findings and 71 files eslint cannot parse at all) |
| prettier | 1178 of 1266 files unformatted |
| `tsc -p tsconfig.json` | 142 errors |
| unit tests | **green** — 305 files, 3405 tests, 3 skipped |

Not one file in the repo is simultaneously lint-clean and format-clean. A hook
that failed on "any lint error" would therefore block **every commit from the
first one**, on files the committer never touched — and a gate that is dead on
arrival is not a strict gate, it is a gate people learn to bypass with
`--no-verify`.

So the hooks enforce the property that *is* satisfiable today and that still
closes the door on new debt:

- **a file you touch may not get worse**, and
- **a file that did not exist before must be clean**, and
- **the whole-repo totals may not grow**.

The ceilings descend slice by slice. At zero, these same hooks *are* the strict
gates — nothing has to be rewritten to get there.

## 2. What runs where

| Hook | Command | Kind | Cost |
|---|---|---|---|
| `pre-commit` | `pnpm exec lint-staged` → `peaks-gate.mjs staged` | ratchet, staged files only | ~5–10s |
| `pre-push` | `peaks-gate.mjs repo`, then `pnpm test:unit` | ratchet + **hard gate** | ~68s + ~6m53s |

`tsc` is **not** in `pre-commit` because it is whole-program: it cannot be
scoped to a file list, so a one-file commit would pay for the whole repo
anyway. It runs on push.

The unit suite is a **hard gate, not a ratchet** — it is green today, so there
is no debt to tolerate and any red is a real regression.

**Escape hatch:** `HUSKY=0 git push` (husky's own switch). Deliberately the only
one — `--no-verify` also works and is equally visible in a shell history.

## 3. The ceilings, and what each one means

`eslint` counts deliberately exclude four classes, each with its own line, so
that no artifact and no config bug can hide inside a number that gets traded
against real debt:

| Ceiling | 2026-09-19 | Meaning |
|---|---|---|
| `eslintFindings` | **4398** | the real lint debt |
| `eslintErrors` | 2561 | of which errors (the rest are warnings) |
| `eslintPhantomFindings` | 2390 | findings from **ruleIds the pinned plugin does not define** — a config bug, not code. Fires on every parsed file. |
| `eslintCoverageGapFiles` | 71 | `parserOptions.project` does not cover the file, so eslint never parsed it. **Also masks real syntax errors** — parsing never happens. |
| `eslintSyntaxErrorFiles` | 0 | in the project but unparsable. A real defect. |
| `eslintNotLintedFiles` | **0** | eslint reported nothing for a file we asked about. Always 0; a non-zero value means the gate's own invocation is broken. |
| `prettierUnformatted` | 1178 | files `prettier --check` would rewrite |
| `prettierUnparsableFiles` | 1 | prettier cannot parse it at all |
| `tscErrors` | 142 | from `tsc -p tsconfig.json --noEmit` |
| `silentWarningCatchReturnNull` | 41 *(seeded 2026-09-29)* | `catch { return null; }` — the caller cannot tell failure from absence |
| `silentWarningEmptyCatch` | 59 *(seeded 2026-09-29)* | `catch { /* nothing */ }` — the error vanishes and the run stays green |
| `fileSizeOverCap` | **166** *(seeded 174 on 2026-09-30, inputs re-seeded by the repair cycle, lowered to 166 by C wave 5 on 2026-10-01)* | files over the decided raw-line cap — **300** for `src`/`packages`/`scripts`, **500** for the root `tests/` tree — counted as `readFileSync(f,'utf8').split('\n').length` over `git ls-files` in those four directories. **Not** the `max-lines` finding count: 98 findings under 400-effective is a different population from 174 files over 300/500 raw (§4 slice 5). The row is bound to those inputs, not just to the unit: the artifact records `fileSizePolicyInputs` (`defaultCap`, `testsCap`, `scopeDirs`, `scopeExtensions`) and `fileSizeLineConvention`, and the leg re-derives all five from a live census run and **refuses** on a mismatch — so re-deciding the cap cannot quietly redefine the number it ratchets (§4b rows 7-9). |
| `fileSizeExcessLines` | **60271** *(seeded 2026-10-01 from the same census envelope; C wave 6 is the reason it exists — 60,204 → 60,271 while `fileSizeOverCap` held at 166 and `gate repo` exited 0)* | the **lines** over those caps, summed — the other half of one census run, and the quantity a file count cannot see: hoisting into a file that is already over cap adds lines without adding files. Seeded by `.husky/peaks-gate-baseline.mjs:423` copying `size.env.excessLines` (never typed), enforced beside the row above in `repo` mode and in `file-size` mode at `.husky/peaks-gate.mjs:734`; it reads `✗ file-size excess lines … > ceiling … (+1)` and exits 1 on one line more than the ceiling, and stays green as it descends. |

Those last two are counted by the repo's own AST reporter,
`scripts/lint/silent-warning-detector.mjs`, over **its own scope** — a walk of
`src/` (781 files measured 2026-09-29), not the 1298-file `git ls-files` set the
rows above use. The divergence is recorded rather than reconciled. Sites carrying
a `// TODO(g2):` grace marker are subtracted by the detector itself, and the
ceiling is seeded by the regenerator reading the detector's `--json` envelope —
never typed in, the same rule `phantomRules` follows.

They were added because the detector was referenced by nothing but
`package.json#test:ci`, which no workflow calls: **100 red violations that could
block nothing and grow unseen**. They are enforced in `repo` mode and in the
named `Silent-warning ratchet` CI step, and both refuse (exit 1) when the
detector cannot run — a leg that could not measure contributes no row, and
certainly no zero.

`fileSizeOverCap` is the third measured-only row and the fourth excluded class: the
file-size policy is **not** tradable against lint debt either, so it does not live
inside `eslintFindings`. The policy itself is one module —
`src/services/scan/file-size-policy.ts`: 300 raw lines for `src/`, `packages/`
(a `tests/` directory inside a package keeps its parent's 300) and `scripts/`, 500
for the root `tests/` tree, a line counted as `readFileSync(f,'utf8').split('\n').length`.
That unit is part of the number: on the same 174 files, split-newline gives 60,982
excess lines and `wc -l` gives 60,808 — one per file — so the artifact records the
convention next to the ceiling (`fileSizeLineConvention`).
`scripts/` is inside the scope because the 174 counts 5 files in it; a row that
silently excluded them would not equal its own measurement (the §4b class of hole).

The count comes from `scripts/lint/file-size-census.ts` — the only tool that
imports the `.ts` policy — run through tsx (`node node_modules/tsx/dist/cli.mjs
scripts/lint/file-size-census.ts --json`) over `git ls-files` of the policy's four
directories — 1424 files at the seeding on 2026-09-30, 1429 after the five files
that slice added were committed (§4b row 8 guards exactly that gap) —
the gate and the regenerator both
spawn that one tool, so the seeded ceiling and the row the gate compares are the
same measurement; nothing types 174. Since the repair cycle they spawn it through
**one** code path, `.husky/peaks-gate-file-size.mjs`, which holds the spawn and
every refusal condition — the two callers used to carry near-verbatim copies of
that logic, already drifted on one option.

It is enforced in `repo` mode and in the named `file-size` mode, and both **refuse
(exit 1)** rather than report a row when: the census cannot run, it produced no
parseable envelope, it counted nothing, the baseline has no ceiling for the key,
**the run is a named-file subset that did not pass `--control-arm`** (repair cycle
F1: one existing file printed `✓ … 0 (ceiling 174) … ceiling held` and exited 0,
vouching for a measurement that had not been made — a subset cannot contain a file
the whole-tree row does not already count), or **the policy the census just
measured is not the policy the ceiling was seeded under** (F2: the artifact now
records `fileSizePolicyInputs` — `defaultCap`, `testsCap`, `scopeDirs`,
`scopeExtensions` — beside `fileSizeLineConvention`, and the leg re-derives all
five from a live census run and refuses on any mismatch. Before that binding,
re-deciding the cap re-decided the number it ratchets: 300/500 → 174, 400/600 →
162, 800/800 → **40 and green**, and dropping `ts` from the extension list → 5 of
43, which no `countedFiles <= 0` trip can see).

`tests/unit/standards/file-size-cap.test.ts` holds the claim open by counting the
tree a third way (a filesystem walk), asserting the four readings agree, asserting
the recorded inputs equal the live policy, and asserting every file the census
counts has a per-file entry in the artifact (repair cycle F4 — the committed
artifact was 1424 entries against a 1429-file scope, missing this slice's own five
new files, with nothing guarding that freshness);
`tests/unit/lint/file-size-gate-leg.test.ts` watches the row go RED on one more
over-cap file than the ceiling, and RED on refusing a subset it was not told to
measure.

`fileSizeExcessLines` is the **fourth measured-only row** and the thirteenth ceiling
(rid `2026-10-01-file-size-excess-row`). It exists because the two file-size
quantities move independently: wave 6 cleared 19 `max-lines-per-function` findings by
hoisting helpers *into files that were already over cap*, so the file count held at
166, the lint rows fell, and the repo's excess lines rose by 67 — a trade the gate
printed in the scope note and enforced nowhere. It is a SUM, not a count, so the
equality the campaign wants has to be intentional: one hoist that lengthens a file by
20 lines and shortens another by 20 is net zero, and the row makes that visible rather
than accidental.

Both rows come from **one** census invocation — `.husky/peaks-gate.mjs:710`, the single
`measureFileSizeOverCap` call site, whose fail-closed trips and key list live in
`.husky/peaks-gate-file-size.mjs` (`missingFileSizeCeilings` at line 148 names both
keys). That sharing is deliberate: a census that cannot run, an envelope with no
integer `excessLines`, or a baseline that has seeded only one of the two ceilings takes
**both** rows down — refusal text, neither row printed, exit 1. A per-row second spawn
would be finding F5 of the cap-unify review happening again.
`tests/unit/lint/file-size-excess-gate-leg.test.ts` holds that open: RED on one excess
line more than the published ceiling (`+1`, exit 1) while the over-cap row in the same
run holds, green one line below it, and neither row printed when the census fails.

## 4. The descent schedule

Each slice lowers specific ceilings. The order is not arbitrary: **formatting
inflates line counts**, and the file-size cap is enforced by the same lint run,
so the cap must be settled *after* the bulk format, not before.

| # | Slice | Lowers |
|---|---|---|
| 1 | Fix `.peaks-rules.cjs`: remove the 2 nonexistent ruleIds; extend `parserOptions.project` to cover `scripts/**` and `packages/*/src/**`; un-anchor `ignorePatterns` | `eslintPhantomFindings` → 0, `eslintCoverageGapFiles` → 0 |
| 2 | Fix `scripts/bench/memory-search-token-cost.mjs` (syntax error since 2.8.0) | `prettierUnparsableFiles` → 0 |
| 3 | `tsc -p tsconfig.json` — fix all 142 | `tscErrors` → 0 → **flip this leg to hard-fail** |
| 4 | `prettier --write` the whole scope | `prettierUnformatted` → 0 → **flip this leg to hard-fail** |
| 5 | **POLICY HALF LANDED 2026-09-30 (rid `2026-09-30-cap-unify-01`); the splits are the remaining work.** The cap is now decided in ONE module, `src/services/scan/file-size-policy.ts` — **300 raw lines for `src`/`packages`/`scripts`, 500 for the root `tests/` tree** (a `tests/` dir inside a package keeps its parent's 300), with a line counted as `readFileSync(f,'utf8').split('\n').length`. `DEFAULT_FILE_SIZE_THRESHOLD = 800` is gone: `peaks scan file-size` resolves every changed file's cap from that module, and the whole-tree count has its own ceiling row `fileSizeOverCap` (§3), seeded from `scripts/lint/file-size-census.ts`. **TWO POPULATIONS, MEASURED IN TWO UNITS — do not conflate them.** (i) the lint rule `max-lines: [error, {max: 400, skipBlankLines, skipComments}]` fires **98 findings** (was 101) on **effective** lines; (ii) the decided policy puts **174 files** over **raw** 300/500 — `src` 134, `tests` 34, `packages` 1, `scripts` 5 — with 60,982 excess raw lines (60,808 under `wc -l`; the difference is one line per file). 98 ≠ 174 because blank/comment lines are invisible to (i) and because 400-effective sits above 300-raw. **The eslint rule value is intentionally UNCHANGED until the splits land** — tightening it would move `eslintFindings`, which §5 says may only go DOWN, and (i) is not the number the raw policy needs watched; `fileSizeOverCap` is. Provenance of 174: 263 files measured 2026-09-29, 184 after waves B1–B3 and C1–C3 (`src` 142, `tests` 35, `packages` 2, `scripts` 5; 61,352 excess), **174 after C wave 4** (60,982 excess); the 237 (180 src + 57 tests) was a 2026-09-19 count over two dirs only. What this row now makes visible: any wave that pushes a file past 300 raw reddens a row that previously passed — intended, and the reason the ceiling can only descend by splitting, never by re-deciding the cap. **Second consequence, same decision:** `peaks scan file-size` is diff-scoped and takes its threshold from the same module, and `request transition` (rd → `implemented`, unless `--allow-incomplete`) calls it — so a commit that touches one of the 174 unsplit files now reds that transition too, where 800 raw used to let it through. That is the policy being enforced, not a new bug; the fix is the split, and the documented bypass is `--allow-incomplete --reason`. **THREE POPULATIONS, NOT TWO (repair cycle F3).** The scan's red-able set is not the 174: it is **every changed file the policy measures**, which is larger than (ii) (it includes in-scope files already under the cap that a split or a new file can push over) and was, until the repair, larger still — it included files outside the four dirs and seven extensions, where `fileSizeCapFor` invented a 300 the row could never see or descend. That wider half was the defect: enforcement without a ratchet and without a descent path. The scan and the census now share one definition (`isPolicyMeasuredFile`), so the three sets are: (i) 98 `max-lines` findings at 400-effective, (ii) 174 files over raw 300/500 — the ratcheted row, (iii) the changed files a given commit touches that the policy measures — the transition gate. (iii) is a different set from (ii), and it is the one that can go red on a *new* file; but every file (iii) can red is over its cap, hence inside (ii) the moment it is committed — which is exactly the descent path (ii) provides and the out-of-scope half never had. | `fileSizeOverCap` ↓ (lint rule value and `eslintFindings` untouched) |
| 6..n | eslint by rule family. **Ordering by family size is the wrong lever** — re-measured 2026-09-30 against the files still over the line cap: cleaning `no-magic-numbers` (the largest family) unlocks **2** blocked files, `complexity` (smaller) unlocks **36**, and all four large families together unlock only **47 of 124** — **22 of those 124 cannot be unlocked by any lint cleaning**, because the blocking code references module-local state. So run slice C **file-scoped and interleaved with the split**, not as four repo-wide sweeps: 47 blocked files have ≥70 % of their shortfall inside a single `register*Commands()` function, where cleaning the family *is* the split. Family sizes re-measured 2026-09-30 at the close of C wave 3: `no-magic-numbers` **624**, `no-non-null-assertion` **547**, `max-lines-per-function` **540**, `complexity` **438**, `no-unused-vars` 160, `consistent-type-imports` 111, `max-lines` 98, `max-params` 58 (measured 2026-09-29: 633 / 559 / 547 / 450 / 161 / 112 / 101). Original 2026-09-19 plan text kept for provenance: `no-unsafe-member-access` (635), `no-magic-numbers` (551), `no-non-null-assertion` (549), `complexity` (414), `max-lines-per-function` (397), `require-await` (310), `no-unused-vars` (273), … — both 635 and 310 are now near-zero (measured **14** and absent on 2026-09-29). | `eslintFindings` → 0 → **flip this leg to hard-fail** |

**Cap reading, decided 2026-09-30:** `packages/*/tests/*.test.ts` counts at **300**, the same as its parent
scope — not the 500 a root `tests/**` file gets. That puts
`packages/peaks-loop-mut/tests/thresholds.test.ts` (313) and
`packages/peaks-loop-shared-channel/tests/shared-channel.test.ts` (321) in the queue, and it is why the
package test file created by slice A was split into two files under 300.

**Where the 300 / 500 sits.** It is the tight
end of the industry band. ESLint's own `max-lines` default is 300; SonarQube S104
defaults to 750–1000; ~400/500 is the common TypeScript landing zone. The repo's
current posture is ~706 raw (400 effective) plus an 800 raw scan, i.e. the loose
end, and the two numbers are the *same policy written twice in two units*: the 69
files violating `max-lines: 400` back on 2026-09-19 had raw counts of min 544 /
median 706 / max 2271 (re-measured 2026-09-30: the rule now fires **98** findings,
one per file, so 98 files). `scripts/` is a hard-blocked family for the orchestrator, so every slice in
this table that touches `src`/`tests`/`config` goes through
`peaks sub-agent dispatch rd`.

**How the remaining split work is classified** (read-only planning pass, 2026-09-30, over the gate's own
scope — its eslint run returned 2872 findings, exactly the ceiling, so it measured what the gate measures):
of **236** over-cap files, **44** clear by hoisting finding-free top-level declarations only (class A — a
lower bound), **124** are blocked because the shortfall sits inside code that already carries a finding
(class B), **55** need a real split because the mass is `describe()` bodies or long literals rather than
declarations (class C), and **13** are too mixed to call. Class B is only reachable through slice C, which
is why the two interleave. The structural reason extraction runs out: **"a NEW file must be clean
outright" means a finding-carrying chunk cannot be relocated into a new file**, so a file whose residual
mass is one complex function cannot be shortened by moving declarations — and renaming its literals into
constants to get around that is family-debt work wearing a split's clothes.

**Status of rows 1–4 — landed and held.** Verified by measurement on 2026-09-29, not by
reading this table: `eslintPhantomFindings` 2390 → **0**, `eslintCoverageGapFiles` 71 → **0**,
`prettierUnparsableFiles` 1 → **0**, `prettierUnformatted` 1178 → **0** (and `prettier --check` over
the four `format:check` globs independently says *"All matched files use Prettier code style!"*),
`tscErrors` 142 → **0** — plus 0 in each of the four package `tsconfig.json` programs, which the
root program does **not** include (`include: ["src/**/*.ts","tests/**/*.ts"]`), so a package
regression is invisible to the gate's `tsc` leg.

### 4b. Measurement-surface holes, found 2026-09-29

The gate held every ceiling and the unit suite was green (320 files / 3540 tests / 3 skipped), yet
four measurements on that green tree did not mean what they appeared to mean. Recorded because
"the gate is green" was being read as "the remediation is complete" — and each hole below makes a
red or absent signal look like a passing one.

| # | Hole | Measured |
|---|---|---|
| 1 | `package.json#scripts.lint` measured a **different file set** than the gate: `--ext .ts src tests packages` never passed `scripts/**`, and excluded `mts/cts/mjs/cjs/js`. | old set 1259 files → 2798 findings / 998 errors; the gate's 1298 → **2878 / 1032**. Invisible: 39 files, 80 findings, 34 errors (73 of them in `scripts/**`). Fixed by `a1`. |
| 2 | `packages/peaks-loop-shared` **exited 0 while collecting zero tests** — `passWithNoTests: true`, set on 2026-09-24 so an empty workspace would not fail `pnpm -r run test`, after `08e92d8f` deleted the root mirror tests on the premise that package tests existed. They never did. | `No test files found, exiting with code 0` inside an aggregate that reported green. Fixed by `a2`. |
| 3 | The silent-warning detector was **red and ungated**: 100 violations, exit 1, referenced only by `package.json#test:ci`, which no workflow calls and no husky hook runs. | `catch-return-null=41`, `empty-catch=59`, scanned 781 files. Fixed by `a3` (two new ceiling rows, §3). |
| 4 | §4's slice-6 family ordering **was 6 days stale** and pointed the next work at a family that had already been cleared. | `no-unsafe-member-access` 635 → 14; `require-await` 310 → absent. Corrected above. |
| 5 | The `fileSizeOverCap` row **cannot see the gate itself**: `.husky/` is not one of the policy's four scope dirs, so the largest file the gate owns is never counted by the row it emits. Found by the QA leaf of rid `2026-09-30-cap-unify-01`, 2026-09-30. | `peaks-gate.mjs` = **985 raw lines**, 3.3× the cap it enforces; `git ls-files .husky` = 2 files, `fileSizeOverCap` contribution **0**. Recorded as a scope decision, not fixed: widening the scope to `.husky` would seed the row at 175 the moment it shipped, i.e. the ceiling would rise by re-deciding the scope, which §5 forbids. The honest statement is that the row watches `src`/`tests`/`packages`/`scripts` and does not watch the tooling that reports it. |
| 6 | The census and `peaks scan file-size` **count different file sets on the untracked axis**: the census reads `git ls-files`, the scan reads the working tree. A 350-line `src/` file that exists on disk but is not staged is visible to the scan and invisible to the row. | Proved on 2026-09-30: with one untracked 350-line `src/` file present, `overCap` stayed **174**. This is the §4e index-versus-worktree gap wearing a third face. It is intended (the row must describe what a commit can contain), and the walk-guard test in `tests/unit/standards/file-size-cap.test.ts` asserts walk == git == tool == artifact so a drift here reddens a test rather than passing quietly. |
| 7 | The scan and the census **did not agree on the directory-and-extension axis**: the census enumerated `git ls-files <the four policy dirs>` filtered by the policy's extensions, while the scan measured **every** changed non-exempt file against `fileSizeCapFor`'s else-branch 300 — including paths in neither list. So an out-of-scope file could redden `request transition` while contributing 0 to the row that ratchets the policy: no ceiling to descend, no split campaign with a duty to clear it, no verdict a contributor could act on. Found by the out-of-band review of rid `2026-09-30-cap-unify-01` (V1), 2026-09-30. | `fileSizeCapFor` is documented as defined only for `src`/`packages`/`scripts`/root `tests`; the scan called it on `.husky/*`, `docs/*`, `*.json`. **Fixed in the repair cycle**: the policy now exports `isPolicyMeasuredFile(dir AND extension)`, the scan skips files it answers `false` for and names them in the new `outOfScopeFiles` verdict (auditable, like `exemptFiles`), and the census filters its `git ls-files` list with the same predicate. An explicit `--threshold` still means "every file" — the caller named the number, not the policy. Arms: `tests/unit/services/scan/file-size-scan.test.ts`. |
| 8 | The committed artifact **was stale on the per-file axis, and nothing guarded that freshness**: `ceilings` are cross-measured by the four readings above, but `files` (what the `staged` and `changed` legs compare a single file against) had no coverage assertion at all. | Measured 2026-09-30: `invocation.linted: 1424` with **no entries for the five files the slice that added the row had just created**, against a census scope of **1429**. A gate that has never seen a file cannot say it did not get worse. **Fixed**: `file-size-cap.test.ts` asserts every file the census counts has a `files` entry (and that the two counts agree), and the artifact was regenerated for this repair cycle. |
| 9 | A **line-count number that is not the cap** sat inside the policy's own population, invisible to the name-based second-copy rule: `src/services/legacy/legacy-detector.ts` `LARGE_FILE_LINES = 500`, the "is this file big enough to look legacy?" heuristic behind the `large-file` smell. | Its name does not match `CAP_NAME`, and it does not: it reports a suspicion, blocks nothing, ratchets nothing — so it is a **different subject**, not a third copy of the 300/500 decision, and it is **deliberately not folded in**. Folding it in (300) would turn all 134 over-cap `src/` files into legacy findings, i.e. it would change what `peaks scan legacy` reports in order to satisfy a naming rule. Recorded where the number lives (the constant's own comment block) and in `file-size-policy.ts`'s header, next to the two other adjacent numbers (the 400-effective lint rule and `lint-reference-shape.ts`'s 800), and pinned by an arm in `file-size-cap.test.ts` so the decision cannot be silently deleted. |

**What landed for holes 1–4** (branch `strict-remediation-abc`, 2026-09-29): rows 1-3 fixed, row 4
corrected above. Measured on the combined tree after the repair cycle — `node .husky/peaks-gate.mjs repo`
checks **1298** files with all 11 rows held and exit 0; `pnpm lint` reports the same 1298 files and the
same `2878 / 1032`; `vitest run tests/unit` is **322 files / 3559 passed / 3 skipped**; each package's
own leg runs in CI.

Two things this section still does not close, stated because each is the same defect shape one row up:

1. **The scope rule has three spellings left.** The gate's own copy is gone (it imports
   `scripts/lint/lint-file-list.mjs`, and the parity arms now spawn `repo` mode — the copy it used to
   keep could be weakened to 1259 files while still exiting 0 and printing `ceilings held`). But
   `.husky/peaks-gate-baseline.mjs:59-60` keeps `CODE_EXT` + a hardcoded `TOP_DIRS`, and
   `tests/unit/lint/eslint-rules-config-coverage.test.ts:88-89` keeps a third. The generator's copy is
   the worse one: it **writes** `scope.dirs` into the baseline (line 340), so drift there does not blind
   a gate, it **poisons a ceiling** — and nothing observes it.
2. **The root `tsc` leg cannot see `packages/*/src`.** `tsconfig.json` is `include: ["src/**/*.ts",
   "tests/**/*.ts"]`, so a package type error is invisible to the gate; only the per-package
   `tsc -p tsconfig.json` that `pnpm -r build` runs catches it. Measured 2026-09-29: all four package
   programs report 0 errors, but that is not what the gate asserts.

### 4c. Two pins that read source TEXT, not behaviour (found while splitting, 2026-09-30)

The campaign moves declarations between files. Two guards in this repo read a file's **text at a fixed
path**, so a mechanically-correct split breaks them for reasons no type check can see:

| pin | what it reads | consequence for a split |
|---|---|---|
| `tests/unit/lint/session-path-swallow-census.test.ts` | **two mechanisms.** (1) the main assertion compares the measured set against `CENSUS` entries that carry an exact `line:` — line-sensitive; (2) a second assertion demands **zero** swallowing frames for three named paths (`src/services/session/getSessionDir.ts`, `src/services/observability/observability-service.ts`, `src/services/observability/jsonl-store.ts`) — line-insensitive but **path-keyed** | (1) moving a pinned `catch` in `code/auto-compact-lifecycle.ts`, `code/auto-compact-orchestrator.ts` or `compact-statusline/compact-lifecycle-store.ts` reddens the suite unless the entry is reconciled. (2) is the sharper one: **splitting a zero-swallow file moves code into a sibling the guard does not name, so the guard silently shrinks.** Nothing catches it. A split leaf must therefore show the detector reports 0 for the new sibling, not just for the named file. |
| `src/services/feedback/promotion-artifact-evidence.ts` | regex over `src/services/code/mode-gate.ts` to recover `HardFloorCategory` and `HARD_FLOOR_CATEGORIES`, exercised by `feedback-promotion-artifact.test.ts:846` against the real repo file | hoisting those two names into a sibling makes a *different* module's parse return nothing. The leaf that found this left both names in place rather than edit the reader |

Both were discovered by leaves, not by the planning model, which reasoned about declaration entanglement
rather than about text reads and path-keyed lists. The general form:

> **any policy keyed on a file PATH must be re-declared for the sibling a split creates** — the census
> zero-swallow list, `scripts/coverage-c8.mjs`'s `--exclude` list (measured: counting one new sibling
> would have added 151 statements, 100 uncovered, to a `--100` gate), and
> `no-runtime-input-guard.test.ts`'s `MEASURED_ESCAPE_MODULES`. Three instances, same cause, all three
> invisible to `tsc`.

So the standing rule for every split leaf is two greps before a move and one list-check after it: grep the
**symbol** for text readers, grep the **path** for path-keyed policies.

**Rule for every future split leaf: before hoisting a top-level name, grep the repo for that name being
read by path.** The two above are the only instances found so far; the planning pass modelled declaration
entanglement, not text reads, so the class is under-counted by construction.

### 4d. What C wave 1 cost, and what caught it (2026-09-30)

Decomposing long functions (not moving declarations) worked: five files went
366→292, 369→48, 336→208, 358→131, 327→87, and the repo totals fell
`eslintFindings 2867 → 2846`, `eslintErrors 1029 → 1017`, over-cap `193 → 188`.

It also produced a breach that **no leaf's own check could see** — and the first diagnosis of it, mine, was
wrong in a way worth recording. A C-wave decomposition moved a `catch` body into a new sibling and moved
its `// TODO(g2):` grace marker into the sibling's JSDoc. The marker was suppressed in HEAD **because it
sat inside the catch's node span** (`silent-warning-detector.mjs:149-151`); relocate the comment and the
swallow is live again. Repo total: `59 → 60`, ceiling 59.

    ✗ silent-warn empty-catch  60 (ceiling 59)     peaks-gate repo, exit 1
    FAIL tests/unit/lint/silent-warning-gate-leg.test.ts > should hold both ceilings

The per-file comparison that "proved" a newly invented swallow was mine, and it was an artefact of reading
the detector's count as *presence of a catch* when it is really *presence of an unsuppressed catch*: HEAD
reported `empty=0` for `gate-commands.ts` not because there was no catch but because there was a
grace-suppressed one. Deleting the `try` on that reading would have changed observable behaviour —
malformed stdin currently answers `stdout {}` / exit 0 (fail-open, which is what the PreToolUse contract
needs); without the catch the throw reaches the outer handler and answers a stderr hint with **no stdout**.
The repair re-pinned the marker to its HEAD position instead. Retiring the swallow for real is a
G2 grace-expiry task, not something to smuggle into a decomposition.

Two rules follow, and they are this wave's actual product:

1. **A split leaf's verification list must include the silent-warning detector over both parent and new
   sibling**, per file, not just eslint — eslint ceilings, `tsc` and prettier cannot see a swallow. And a
   count delta must be explained by reading *the code*, not by reading the number: compare grace markers
   and their positions, or you will "diagnose" a defect that is a comment moving.
2. **Grace markers are node-span-sensitive — a sixth path/position-keyed policy.** `TODO(g2)` above a
   statement, inside it, or in a doc comment are three different answers to the detector. Any move of a
   `catch` must keep its marker inside the same node span, and the wave's totals are the check that it did.

Also counted: **a fifth path-keyed policy.** The vendor-neutral identity guard's `KNOWN_DEBT` census pins
a `vendor === 'codex' | 'claude' | 'copilot'` comparison **to its file path**, which is why wave C's
record-upgrade leaf left that comparison in the parent and paid one extra parameter rather than hoist it.

Also measured, because "the suite is green" hid it: `sync-service.ts`, `evolution-store.ts` and
`workflow-autonomous-resume-helpers.ts` have **no unit test that imports them**. Their only coverage
spawns `bin/peaks.js`, i.e. needs a fresh `dist/`, which is why the integration preflight
(`_dist-freshness-global-setup`) refuses to run while `src/` is being edited — a real cost this campaign
pays by rebuilding `dist/` once per wave and re-running those files at convergence.

### 4e. What a split cannot move verbatim (C waves 2–3, 2026-09-30)

**Wave 2 was lost to a quota, not to code.** All five leaves died on
`daily usage limit for Chat`. Two rules came out of it: a leaf that dies mid-split leaves a
half-moved file, so the budget rule is now **revert to HEAD and report "not attempted"** rather than
leave partials for the orchestrator to reconstruct; and the only verified half of that wave was
committed on its own (`90674217`), with the other file parked as
`.peaks/_runtime/2026-09-29-session-b7cf21/rd/pending-watch-split.patch` (161 lines, needs tests or a
verbatim redo). A chained four-contract brief also failed at startup with a 138,096-character context
request, which is why every leaf brief since then is self-contained.

**Wave 3 landed three files** — `cron-commands.ts` 396→130, `worktree-auth-commands.ts` 397→78,
`context-audit.ts` 398→130 — and moved the repo from `eslintFindings 2845 → 2823`,
`eslintErrors 1016 → 1008`, scope `1396 → 1404`, over-cap `188 → 184`. tsc 0, prettier 0, silent-warnings
held at 41/59, and the unit suite re-measured at 326 files / 3559 passed / 3 skipped both before the
commits and after the baseline regeneration.

The wave's actual product is a **method**, because the contract "move the chunk verbatim" is not
achievable on these files. A new file must be **clean outright**, so whatever the chunk carries has to be
*fixed* while it moves: `readSchedule`'s `complexity 18` became `assertScheduleRoot` / `toScheduleEntry` /
`isStringArray`, and `256*1024*1024` became a named const of identical value. That makes the review surface
"which lines are NOT in HEAD", and eyeballing a 400-line file for that does not work. The check that does:
strip comments, normalise whitespace, build a multiset of the HEAD file's code lines, then report (a) every
line in the new tree with no HEAD counterpart and (b) every HEAD line with no counterpart in the new tree.
Orphans are the added structure; leftovers are the deleted behaviour. Run over both wave-3 leaves it
returned 32 HEAD leftovers for cron, and **the single interesting one was the leaf's declared deviation** —
`const now = Date.now();` at HEAD:351 — which grep then confirmed was never read in its own loop.
The leftovers that were not interesting were prettier re-wrapping (`ok(` → one line) and `continue` →
`return null` at a new helper boundary. This is a *review aid, not a gate*: it cannot see a re-ordering
that keeps every line, and it says nothing about behaviour.

One deviation worth keeping visible: `cron-commands.ts` ↔ `cron-commands-actions.ts` is now a deliberate
import cycle, because `cron-scheduler-commands.ts` imports `runTask` from the registration file and the
campaign may not move a public import path to save a line count. Safe under `module: NodeNext` +
`"type": "module"` (hoisted function declaration, resolved at call time) — and no gate leg checks cycles,
so nothing in CI would have noticed if it were not.

**§4b's index hole, measured again in a benign shape:** convergence ran `gate repo` at 1396 files while
eight new files already existed on disk, because `git ls-files` is the *index*. The wave's own numbers are
only true after `git add`. Adding the files raised scope by 8 and left the totals where they were, which is
the expected result for new files that are clean outright — but a wave that added a finding-carrying file
would have been invisible until it was staged.

### 4f. C wave 4: the ten cheapest files, and what integration caught (2026-09-30)

Ten files sitting **12–59 raw lines over the line cap** went to five leaves, two files each, disjoint sets.
All ten cleared. Repo totals moved `eslintFindings 2823 → 2803`, `eslintErrors 1008 → 997`, scope
`1404 → 1422` (18 siblings added, every one of them 0 findings — the staged gate refuses a new file that
carries anything, so that is enforced rather than asserted), and over-cap `184 → 174` files
(61,352 → 60,982 excess lines on the split-newline count, 60,808 on `wc -l`; both conventions agree the
count is 174). Re-measured at quiescence: gate repo all-pass, tsc 0, prettier 0 of 1422, silent-warnings
held at 41/59, root unit suite 327 files / 3559 passed / 3 skipped / 0 failed, and all four workspace
package suites Done (shared-channel now 2 files / 20 cases = 14 + 6, up from 1 file / 20).

Per-file findings after the wave, measured by the orchestrator: `smoke-commands.ts` 0,
`code-mode-gate-commands.ts` 0, `retrospective-commands.ts` 0, `crystallization-types.ts` 0,
`capability-seed-sources.ts` 0, both split test files 0; `fork-commands.ts` 1 and
`code-job-shape-commands.ts` 3 (the latter is the file whose inline action at `:55` is pinned by
`gratuitous-async-guard.test.ts`'s `PINNED_SITES` — the leaf extracted a *different* action, so the pin
still describes its site); `artifact-templates.ts` keeps its 6 `max-params` warnings in the parent, because
a `max-params` finding cannot move into a file that must be clean outright.

**Byte-identity was re-measured, not inherited from the leaves.** Two throwaway harnesses imported HEAD's
module and the split module side by side: 80 `renderTemplate` combinations (5 roles × 4 request types × 16
inputs including backticks, `${}`, `$&`, CRLF and empty strings) with **0** differences plus the three path
helpers identical, and 145 schema comparisons on the crystallization vertical (boundary `bee_release_id`
2147483646/2147483647/2147483648, section lengths 3999/4000/4001, missing/empty/non-string keys) with every
outcome, issue path and message matching, plus `seedCapabilitySources` 32 = 32 elements with
`JSON.stringify` equal and `sourceId` order preserved. That is how the one non-verbatim line in the wave —
`CRYS_BEE_ID_MAX_I32` re-spelled from `2 ** 31 - 1` to `2147483647` because `no-magic-numbers` does not fold
the expression — was shown to be value-identical rather than assumed to be.

**What the first integration run in this campaign found was my own regression.** See §4g.

### 4g. A directory whose file COUNT is asserted (the seventh policy shape)

`src/services/capability-guard-runner/contracts/J11.ts:56-59` reads
`readdirSync('src/services/doctor/doctor-service/checks').filter(f => f.endsWith('.ts'))` and `:88-91`
asserts that length equals `PLUGINS.length`. Commit `108ebcea` (this campaign, 2026-09-29) shortened
`checks/multi-binary-drift.ts` by hoisting its pure helpers into a sibling **placed in that same directory**,
so the census went 22 plugins / 23 checks and the guard reported that the registry had missed a plugin.

It stayed red for two days and nothing in the campaign's convergence loop could see it: the whole-repo lint
gate, `tsc`, prettier and the 326-file unit suite all pass, because the assertion lives in
`tests/integration/capability-guard/J11-doctor-cli-snapshot.test.ts`, which runs under
`vitest.config.integration.ts`. It surfaced the moment `pnpm test:integration` was run (1 failed / 471
passed), and after the fix `5ed275fe` it is **472 passed / 0 failed** over 93 files.

Two rules come out of this, and they are different from the path/symbol pins in §4c:

1. **Ask whether a target directory is READ, not just referenced.** Grep the path (that is how §4c's pins are
   found) does not help here — nothing names the sibling file. `grep -rn "readdirSync" src/` over the
   directory's ancestors, and look for a length comparison, does. J11's doc comment now states that the
   checks directory is counted, so the invariant is written next to the rule that depends on it.
2. **Integration belongs in the convergence checklist of any slice that MOVES files**, not only slices that
   change behaviour. It requires a rebuilt `dist/` (its preflight refuses a stale one, measured: 882 source
   files must match the digest), which is exactly why it had been skipped — the cost is real
   (`pnpm build` ≈ 60 s, `pnpm test:integration` ≈ 410 s at one worker) and it is what caught this.

### 4h. Verification concurrency: the host is part of the gate (2026-09-30)

This development host (16 logical cores, 15.75 GB) took four `Kernel-Power 41` bugchecks with stop code
**`0x10E PFN_LIST_CORRUPT`** (2026-09-28 20:58, 2026-09-28 23:02, 2026-09-30 18:10, 2026-09-30 19:45;
minidumps in `C:\Windows\Minidump\`). Measured cost of the individual commands: one whole-program
`tsc --noEmit` is **803,436K ≈ 786 MB over 1773 files**, one type-aware eslint batch (150 files) is
**≈ 985 MB** peak RSS. Five RD leaves each finishing with a whole-program `tsc` is ~4 GB before the
orchestrator adds anything, and the orchestrator had `pnpm build && pnpm test:integration` running in the
background under a foreground full unit run. Node began dying on `VirtualAlloc`
(exit `3221225794`) — which reads exactly like "0 findings" if you do not check the exit code.

**Rules.** One heavy command at a time, foreground; a `run_in_background` slot is for reads and greps, not
for build / integration / gate-repo / full-suite; and an allocation failure is **"did not run"**, never a
clean measurement. Note that `0x10E` is a page-frame-number list corruption, not a plain out-of-memory —
memory pressure is the trigger, but a driver or DIMM is what makes it a bugcheck instead of a killed
process, and that part is not settled from here.

**The gap this uncovered in the repo.** `vitest.workers.ts` is the declared single source of truth for the
worker count and says in its own header that it is "shared by all four vitest configs (unit / integration /
lint / e2e)". The repo has **seven** configs. The three `packages/*/vitest.config.ts` imported nothing and
declared no `pool` / `maxWorkers` / `fileParallelism` (verified by grep), so each ran at vitest's own
default of one fork per core; the only reason that was harmless is that every package currently holds two
test files. `6853ba94` wired them to the same policy and added
`tests/unit/standards/vitest-worker-cap.test.ts`, which enumerates the configs by walking the filesystem —
because a hand-maintained list is precisely how the "all four" claim rotted — asserts each declares a cap
that traces to `vitest.workers` rather than a literal, and carries a positive control per arm in a temp dir
plus a live-tree proof that stripping one cap turns it red. Declared and **not** fixed:
`packages/peaks-loop-internal-runtime` ships no `vitest.config.ts` at all, so it inherits the root config
and the census cannot see it.

### 4i. C wave 5: the first wave planned against the row it had just built (2026-10-01)

Wave 5 is the first cut of the split campaign scheduled by the tooling this program was built to
produce, and it measured the population differently from the way §4 row 5 had been quoting it for
two weeks, so the numbers here supersede the "44 class-A files" planning figure for the near term.

**The band structure changed.** The census over the current tree reports 174 over-cap files whose
excess distribution is **61–120 lines: 23 files, 121–300: 76, 301+: 75 — and ZERO files within 60
lines of the cap.** Wave 4 cleared the 12–59 band, so the cheapest remaining file is
`workflow-spec.ts` at +63. A wave that keeps taking "the ten cheapest" is now taking files with
three digits of excess, which is why wave 5 was planned by class rather than by price.

**Classification of the 23** (read-only pass, one type-aware eslint batch over exactly those files,
band total 107 findings / 44 errors): **class A 8** (hoist finding-free top-level declarations),
**class B 11** (shortfall sits inside code that already carries a finding — a hoist-upper-bound
below the excess, arithmetic not judgement: `cron-commands` −5, `standards-command` −5,
`watch.mjs` −4, `workflow-autonomous` −3, and `pipeline-verify`, `dispatch-from-dag`,
`session-command` with **zero** finding-free top-level mass), **class C 4** (all test files whose
mass is `describe()` bodies). Class B is 11 of 23, which is the §4 row 6 finding restated on the
cheapest band: the remaining splits are mostly not separable from lint-family cleaning.

**Wave 5 ran 4 leaves × 2 files, dirs disjoint, and cleared all 8** —
`workflow-spec.ts` 363→232 (+149), `bundle-types.ts` 366→289 (+118),
`cross-pass-edge-merger.ts` 389→297 (+143), `api-diff-openapi.ts` 414→294 (+166),
`compact-statusline-service.ts` 410→296 (+100/+60), `version-precheck-service.ts` 417→296 (+118/+48),
`envelopes.ts` 407→261 (+185), `release-pack.mjs` 412→282 (+90/+89). Repo totals:
`fileSizeOverCap 174 → 166`, excess 60,982 → 60,204 lines, scope 1429 → 1440 files, and — stated
plainly because it is the wave's least flattering number — **`eslintFindings` 2803 → 2803 and
`eslintErrors` 997 → 997**. Eight files hoisted for zero lint progress, exactly as the plan
predicted. Convergence, measured by the orchestrator, serially: `gate repo` exit 0 at 1440 files
with all twelve rows held; `pnpm build` exit 0 (892 source files); `pnpm test:unit` exit 0
(330 files / 3614 passed / 3 skipped); `pnpm test:integration` exit 0 (93 files / 472 passed /
2 skipped); J11's counted-directory census held, so §4g's hazard did not fire in any of the eight.

**Three hazards this wave added to the record, none of which the previous waves had:**

1. **A line-anchored citation rots silently, not red.** `repo-citation-integrity` strips the `:NN`
   suffix before checking, so a citation that names a real file and a wrong line passes. The
   planning pass found one already wrong (`cross-pass-edge-merger.ts:330` citing `isTestFile`,
   which was at 361), and wave 5 then moved `isTestFile` to
   `cross-pass-edge-static-scan-support.ts:132` — a different *file*, with the checker still green.
   The guard verifies existence, not accuracy. Recorded in the backlog rather than fixed here,
   because fixing it means changing what the test asserts.
2. **A DAG's "covered by the tests" claim is not evidence.** The wave-5 DAG said these modules were
   covered by loader/eval tests; leaf `w5-1` grepped and found **no test imports either module**, so
   the hoist was proven by a HEAD-vs-split identity harness (80 checks, 0 diffs) plus a 9-file
   `createProgram` probe instead. A planned coverage claim must be re-verified by the leaf, not
   inherited.
3. **Two things that look like a leaf's failure were the orchestrator's job.** `file-size-cap.test.ts`
   went red with `expected 174 to be 166` in two leaves — that is the stale ceiling the
   orchestrator must regenerate *after* `git add` (§4e's index hole, now with a row that proves it).
   And `statusline-cli-integration.test.ts` reported 24 tests skipped with the file failed: its
   preflight refuses a stale `dist/`, and the wave had changed `src/` since the last build. Both
   resolved by `pnpm build` + re-running the named files, not by touching the leaves' code.
   The unit suite red at 329/1 is worth re-running *after a rebuild* before it is read as a
   regression.

Also worth keeping visible: leaf `w5-4` reported it could not clear `release-pack.mjs` without
creating a **second** bidirectional cycle and chose to accept it with a runtime proof
(`discover`/`topo`/`list` byte-identical, cycle loads) rather than reject the file; and leaf `w5-2`
had to widen `api-diff-openapi-schema-read.ts` by exporting `schemaToTypeString`, which extends
`api-diff-service.ts:60`'s `export *` by one previously-private name. Both are the cost of the
"new file must be clean outright" contract, and both are the kind of thing no gate leg checks.

## 5. Lowering a ceiling

After a slice lands:

```bash
node .husky/peaks-gate-baseline.mjs
git diff .peaks/lint/gate-baseline.json
```

**Read the diff.** A ceiling that went *up* is the one thing this file must
never contain — it means the slice made something worse, and the number should
not be committed. The pre-push gate enforces this after the fact, but only a
human reading the diff catches it before it lands.

## 6. What building this gate found

Every one of these was found *by building the gate*, not by running the tests —
which is the point: the tests were green the whole time.

1. **Two ruleIds that do not exist.** `.peaks-rules.cjs` names
   `@typescript-eslint/no-implicit-any` (removed in typescript-eslint v6) and
   `@typescript-eslint/no-restricted-syntax` (that is an ESLint **core** rule
   name with a plugin prefix bolted on). ESLint reports "Definition for rule X
   was not found" on **every file it parses**, at severity 2 — 2390 phantom
   findings, and, worse, **no new file can ever be lint-clean**, so a strict
   "new files must be clean" gate would be unsatisfiable.
2. **71 files that eslint never parsed.** `parserOptions.project` covers only
   the root tsconfig, so `packages/*/src/**` (37 files) and `scripts/**`
   (35 files) fail with a coverage error *before* parsing. This **masks real
   syntax errors** — which is exactly how #4 stayed hidden.
3. **33 files eslint silently skipped in a plain directory walk.**
   `ignorePatterns: ['skills/', ...]` was written to exclude the repo-root
   prose directory, but ESLint reads a trailing-slash pattern with no inner
   slash the way `.gitignore` does — matching a directory of that name at **any
   depth**. So `src/services/skills/`, `src/skills/` and two test directories
   were reported as "0 findings" while never being parsed. Fixing it moved the
   debt number **up**, from 6597 to 6788: the number grew because the coverage
   became real.
4. **A benchmark that has not run since 2.8.0.** Commit `ee571279`, titled
   `fix(typo)`, changed `peaks-clis` to `peaks-loop's` inside a single-quoted
   string — an unescaped apostrophe. `node --check` fails.
   `.peaks/memory/memory-search-y2-rerank-2026-06-19-decision.md` designates
   this script as *"the gating check for the Z-B GO/NO-GO decision"*.
5. **The gate's own first draft was decorative.** A path-normalisation bug
   (`resolve()` returns backslashes on Windows; the `${ROOT}/` prefix was built
   from that) meant the eslint leg matched **no** files and silently compared
   every one against zero. It reported "improved N -> 0 findings" and **six of
   seven injection arms passed anyway**. Caught by asking why an "improvement"
   had occurred. The fix also added a fail-closed rule: eslint not reporting on
   a file we handed it is an error, never a zero.

6. **A config that does not resolve looks exactly like an unformatted file, and
   the advice the gate gave was destructive.** `prettier.resolveConfig()` returns
   `null` and does not throw when no config is found; `{ ...null }` is `{}`, i.e.
   prettier's DEFAULTS (printWidth 80, double quotes). Measured on the 88 files
   the baseline calls prettier-clean: **6 of 6 sampled return `true` with the repo
   config and `false` with the spread null.** So one unresolvable config makes the
   gate declare every clean file dirty — and `prettier --write`, which the gate
   was telling people to run, would then rewrite the file with the *wrong* style
   (measured 8380 → 8505 bytes on `scripts/dist-freshness.mjs`, single quotes
   flipped to double).

   Worse for the generator: it spreads the same null, so one run inside the
   window would have written `prettierClean: false` for **all 1267 files** and
   made that the ceiling — permanent damage to the ratchet, from a transient race.
   The race is real: `scripts/bump-version.mjs:259` rewrites the root
   `package.json` with `writeFileSync(JSON.stringify(...))` — truncate-then-write,
   not atomic.

   Fixed by making an unresolved (or merely *wrong*) config its own failure class:
   no `--write` advice, and the resolved config compared against the repo's own
   declaration. The generator refuses to write rather than poisoning the ceiling.

   **And the first fix of it was itself broken.** `prettierCheck` omitted the
   `configProblem` key on success, so `result.configProblem` read as `undefined`,
   and `undefined !== null` is true — every file took the CONFIG UNRESOLVED branch
   and **nothing could commit at all**. Caught by running the gate against a
   healthy tree, not only against the failure case. A sentinel must be one value,
   not "null or absent".

## 7. Verifying the gate itself

The gate is a guard, so it gets the treatment this repo gives guards: try to
make it red, then try to make it *miss*. Seven arms, all driven by editing the
baseline only (no source file is touched), in `.tmp/test-gate.mjs` — a scratch
file, not committed:

| Arm | Expectation | Result |
|---|---|---|
| A. baseline file, unchanged | pass | ✅ |
| B. same file, ceiling lowered by 1 | **fail** | ✅ |
| C. baseline claims "was clean", file is dirty | **fail** | ✅ |
| D. unlinted file (coverage gap) | pass **with warning** | ✅ |
| E. entry deleted, file is clean | pass (a new clean file is allowed) | ✅ |
| F. entry deleted, file is dirty | **fail** | ✅ |
| G. out-of-scope path | pass (ignored) | ✅ |

End-to-end through real git, not just the script:
`git hook run pre-commit` with a dirty new file → **exit 1** with the exact fix
command; with a clean new file → **exit 0**.

---

## 8. 执行实录（2026-09-19）—— 计划被现实改写的地方

§4 是出发时的计划。实际走下来有几处**必须记住的偏离**，因为它们是这个仓库的
真实性质，而不是执行失误。

### 8.1 走完的片

| 片 | 内容 | 效果 |
|---|---|---|
| S1 | eslint 配置三处"没生效/没覆盖" | phantom 2390→0、coverageGap 71→0、never-linted 0 |
| S3a–S3f | `tsc -p tsconfig.json` **142 → 0**（六片） | 上限到 0 = 该腿自动成为硬门禁 |
| S4b | 全仓 `prettier --write`（1129 文件） | prettierUnformatted **→ 0** |
| S5a | 格式化暴露的两个阻塞项 | J03 抑制标记锚点、`sync-version` 输出 |
| S5b | 重钉 15 个源文件行号 | 套件从 13 个失败降到 4 个 |

### 8.2 计划与现实的三处偏离

**(1) "格式化"与"行数上限"直接冲突 —— 已裁决。**

格式化让 867/1269 个文件变长，共 **+26,653 有效行**，于是 `eslintFindings` 上升 **+164**
（`max-lines` +28、`max-lines-per-function` +136，两者相加精确相等）。

而这两条规则**故意把单元测试排除在外**（`tests` 的 `max-lines-per-function` 是 `off`），
所以只有文件级上限影响测试。

**裁决（用户）：先格式化，再按格式化后的形态重定上限。**

**最终裁决（用户）：上限保持不变（`max-lines` 400 / `max-lines-per-function` 50）。**
零新工作量；扫荡带来的 +164 被基线吸收并**逐条归因**。债务（101 个文件 + 559 个函数）
作为债务留着。

方向性事实值得记住：**抬高阈值会降低 `eslintFindings`，所以"抬高"是 ratchet 合法的；
"降低"才会顶破上限。**

**(2) 格式化暴露了整类缺陷：行位置耦合的守卫。**

三条，形状相同 —— 都是"仓库自己的机制在跟自己的格式化器打架"：

- **抑制标记按行锚定**：`// TODO(g2)` 原本在 `} catch {` 同一行，prettier 把它挪到下一行，
  于是**131 处抑制被静默关掉**（`catch-return-null` 41→106、`empty-catch` 59→125）。
  而 41/59 **正是 J03 的上限** —— 也就是说那次格式化**同时突破了 J03 的两条线**，
  而"未绿"这个标签没能说出这一点。修法：锚改成**节点自身的行区间**，
  而不是起始行。另一条路（让标记在格式化后仍锚定）**实测不可行** —— 三种写法都被 prettier 破坏。
- **断言钉着源文件行号**：15 处。**漂移不是 ±1**（有两处 +63 / +83，因为单行 `catch` 块被炸开）。
  重钉必须**按内容**，不许照抄失败信息里的数字。
- **`.gitignore` 的 `best-practice/` 把 6 个 tracked 源文件蒙住了** ——
  prettier 自己读 `.gitignore`，所以 `prettier --check` 会对它**从未打开过**的文件报"全部合规"。
  这是这个 bug 类的**第三次**（前两次：eslint 的 `'skills/'`、codegraph 的 excludes）。
  三次都是同一个误读：带尾斜杠、内部无斜杠的模式，匹配**任意深度**的同名目录。

**(3) `prettierUnformatted: 0` 曾经不可维持。**

`scripts/sync-version.mjs` 用 `JSON.stringify` 写 `version.ts`（双引号），
而配置要 `singleQuote`。它在 `build`/`prepack`/`pretest` 里都跑 ——
**每次构建都把 tracked 文件写脏、把门禁转红**。已修。
（它同时会**故意删掉** `packages/*/dist/version.*` 以强制重建 —— 这是设计行为。）

### 8.3 剩余的两条轴

| 轴 | 当前 | 说明 |
|---|---|---|
| `eslintFindings` | **5379** / 上限 5380 | 这是**最后一条大轴**。里面包含格式化带来的 164 条行数违规（已裁决保留）。清它需要按规则族逐片做 |
| 慢测试超时 | 4 个 | 都是 30 秒默认超时；单独跑都能过。**push 门禁会把间歇性抖动变成阻断**，所以必须处理 |

### 8.4 一条流程缺口（已修）

**`tsc -p tsconfig.json` 依赖未跟踪的 `packages/*/dist`**，而 CI 之所以在 tsc 前先
`npm run build` 正是这个原因。门禁最初漏了这一步，于是它曾因**派生产物**而红，
报出 7 个与源码无关的错误。现已改成对这种形态报"先跑 `pnpm build`"。

**循环因此增加一步：跑 `pnpm test:unit` 之前先 `pnpm build`。**

### 4k. What 2803 is actually made of (full histogram, measured 2026-10-01)

Reproduced with the regenerator's own invocation — `git ls-files` filtered to the four top dirs and the
seven extensions (**1444 files**), `eslint --config config/eslint/.peaks-rules.cjs --no-ignore
--format json`, batches of 150, fatal messages excluded, phantom rules subtracted. **Total 2803, exactly
the ceiling; 997 errors, 1806 warnings; 33 distinct ruleIds; 0 null-ruleId messages.** 674 files carry
everything and **770 files are clean**, so this is a concentrated debt, not a diffuse one: the ten
dirtiest files hold 292 findings (10.4 % of the total).

| ruleId | findings | sev2 |
|---|---|---|
| `no-magic-numbers` | 623 | 0 |
| `@typescript-eslint/no-non-null-assertion` | 547 | 0 |
| `max-lines-per-function` | 529 | 529 |
| `complexity` | 431 | 0 |
| `@typescript-eslint/no-unused-vars` | 160 | 160 |
| `@typescript-eslint/consistent-type-imports` | 111 | 0 |
| `max-lines` | 98 | 98 |
| `max-params` | 58 | 0 |
| `@typescript-eslint/no-base-to-string` | 39 | 39 |
| `@typescript-eslint/no-require-imports` | 26 | 26 |
| `no-duplicate-imports` 22, `no-useless-escape` 16, `no-unnecessary-type-assertion` 16, `no-control-regex` 15, `prefer-const` 14, `no-unsafe-member-access` 14, `await-thenable` 11, then 16 rules at ≤ 9 | 246 | — |

**The intersection that decides slice 5/6 ordering.** Of the **166** files over the 300/500 raw-line cap,
they hold **1263 findings (45.1 % of 2803), 519 of them errors** — and **only 3 of the 166 are
lint-clean**: `scripts/packages-build-prerequisite.mjs` (+834),
`src/services/codegraph/codegraph-index-integrity.ts` (+367) and
`tests/unit/scripts/packages-build-prerequisite.test.ts` (+221). Because a new file must be clean
outright, class A is effectively extinct in the remaining queue: 163 of 166 files require finding-fixing
before they can be shortened, and the families sitting inside them are exactly the ones already at the
top — `max-lines-per-function` 277, `no-non-null-assertion` 240, `no-magic-numbers` 219, `complexity` 211,
`max-lines` 96. This is §4 row 6's "run slice C file-scoped and interleaved with the split" measured
again, and it says the interleaving is no longer a strategy preference but the only remaining shape.

**A measurement-surface hole this run exposed.** §4 row 6 records family sizes as a top-eight list, and
that list is all the campaign has ever kept. Between the wave-3 record (624 / 547 / 540 / 438 / 160 / 111
/ 98 / 58) and this one the top eight fell by **19**, while `eslintFindings` stayed **2803** — so 19
findings moved into the tail and **nothing in the docs can say which rules**, because no prior full
histogram exists. The fix is not a new rule, it is a habit: a composition claim needs the whole tail
recorded, or the number can shift between families without ever tripping the single ceiling that is being
ratcheted. The full 33-rule breakdown is now committed in this section, so the next such move is visible.

Also correcting my own earlier citation: the histogram quoted in the C wave 5 and cap-unify commit
messages (619 / 545 / 524 / 423 over a total of 2823) was measured over **1485 files including parse
messages and files outside the gate's four dirs** — a different measurement surface from the gate's. The
gate-scope numbers are the ones in this section.

### 4l. C wave 6 — the marginal band, and what hoisting actually costs (2026-10-01)

Planned from the §4k measurement rather than from a file list: of the 529 `max-lines-per-function` arms,
**105 are 51-60 lines** — one to ten over the cap — and they sit in 98 files. Wave 6 took 20 of them in
20 files across 5 directory-disjoint leaves. **19 cleared, 1 rejected with a measurement**
(`scripts/lint/apply-g2-grace-markers.mjs`: the only verbatim-movable block gives the new helper
`complexity 13`, a fresh warning, and the remainder still 17 lines over; the other blocks are walled by
three `continue`s and a closure write to `dirty`).

Repo movement, all re-measured after the wave: `eslintFindings 2803 → 2780`, `eslintErrors 997 → 978`,
`max-lines-per-function 529 → 510`, the 51-60 band `105 → 86`, files carrying the rule `301 → 289`.
Ceilings were regenerated and exactly two rows fell — `anyRaise: false`. `pnpm build`, `pnpm test:unit`
(333 files / 3641 passed / 3 skipped) and `pnpm test:integration` (93 / 472 / 2) all exit 0, the
capability-guard J-contracts included.

**The cost nobody should gloss:** `fileSizeOverCap` stayed **166**, but the *excess* grew —
60,204 → **60,271** lines. Clearing a body-length cap by hoisting a helper into the same file makes the
file **longer**: every leaf reported net line growth (e.g. `dag-orchestrator.ts` 514 → 527,
`ecc-bridge.ts` 526 → 529, `auto-compact-lifecycle.ts` 657 → 669). So the two rows can move in opposite
directions, and this wave spent 67 lines of split-debt to buy 19 lint findings. That is not a reason to
skip the work — 110 of the 166 over-cap files carry MLPF arms, so the rule has to be cleared for the split
queue to move at all — but it is a reason to **plan hoists into siblings rather than in-file when the file
is already under its cap**, which is what kept every under-cap file under cap this wave (checked per file
by each leaf; `J03/J04/J05` and `dispatch.ts` all stayed small). That trade now has a ceiling of its own:
`fileSizeExcessLines` (§3) was seeded the next day at the 60,271 this wave ended on, so paying split-debt to
buy lint findings moves a row the gate refuses to let rise.

Two hazards paid off as designed. `w6-4` checked whether `capability-guard-runner/contracts/` is
enumerated before creating any sibling and found registration is **name-based static imports** in
`registry.ts`, not a directory count — so it created zero siblings anyway. `w6-5` hit the line-pinned
swallow census (§4b row 2): moving `settleOpenLifecycleRun` shifted pinned catches 439/580/653, the test
caught it red on the first run, and the leaf reconciled both the `CENSUS` entries and an **inline** `653`
literal the census list does not own — a second copy of the same fact that no `CENSUS` diff would have
shown. Both files then exit 0.

Still open after this wave: 86 marginal arms in the 51-60 band, 165 in 61-80, and the
700-930-line `register*Commands()` cohort, which is where §4 row 6's "cleaning the family *is* the split"
actually applies.

### 4m. C wave 7 — the first wave whose target was a line count, and what it cost to measure (2026-10-01)

`fileSizeExcessLines` had just become a ceiling (§4l's +67 was the last straw), so wave 7 aimed at the
number rather than at the file list: the 5 largest files, **7,346 excess lines (12.2 % of the repo
total)**, one file per leaf, five leaves, directories disjoint by construction.

**Result: 4 cleared, 1 rejected with a blocker nobody had written down.** Repo movement, measured before
and after with the census: `fileSizeExcessLines 60,271 → 54,318` (**−5,953, −9.9 %**),
`fileSizeOverCap 166 → 162`, `eslintFindings 2780 → 2768`, `eslintErrors 978 → 971`,
`countedFiles 1,445 → 1,474` (+29 siblings). Unit: **344 files (+10) with the case count unchanged at
3,651 passed / 3 skipped** — the number that proves splitting four suites moved cases and did not lose
them. Build 0, integration 0 at 93 files / 472 passed / 2 skipped.

The rejection is the more useful half. `scripts/install-skills.mjs` (1,393 excess) could not be split by
the leaf that tried: `package.json#files` lists **that path concretely**, npm tarball membership does not
follow imports, and the entry's main block statically reaches the whole module graph — so hoisting a
region ships a global install whose postinstall dies `ERR_MODULE_NOT_FOUND`. No gate sees it:
`tests/unit/publish/files-entries-resolve.test.ts` checks entries→disk, not disk→entries, which is the
silent-short-tarball direction its own header already names. The unblock is a `package.json`-owning slice
plus interleaved lint cleaning (the file also carries 11 errors/11 warnings, so no chunk relocates into
a must-be-clean sibling). Recorded in the leaf envelope, not worked around.

**Three things convergence caught that the leaves' own reports did not contain**, which is the argument
for the orchestrator re-measuring instead of reading: seven of the new files were prettier-unformatted
(their eslint was genuinely clean, so their self-checks were truthful and incomplete); the baseline
generator **raised `prettierUnformatted 0 → 7` and wrote it** because it has no monotonicity check at all
(backlog §2.27 — the ratchet is one command away from erasing itself); and a guard that reads the
service's source **text** now covers 273 of the 1,858 lines it used to examine, passes, and is blind
(backlog §2.28, with the two rules it implies: a text guard must read the module set after a split, and
it needs an arm that fails when its own subject shrinks).
