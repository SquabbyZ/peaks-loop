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
| 5 | Set the file-size cap to **300 raw lines for `src`/`packages`, 500 for `tests`** — in ONE place, currently `max-lines` in `.peaks-rules.cjs` and `DEFAULT_FILE_SIZE_THRESHOLD` in `file-size-scan.ts` disagree (400 effective vs 800 raw), then split what exceeds it | `eslintFindings` ↓ (**237 files** over the new cap: 180 `src` + 57 `tests`) |
| 6..n | eslint by rule family, largest first: `no-unsafe-member-access` (635), `no-magic-numbers` (551), `no-non-null-assertion` (549), `complexity` (414), `max-lines-per-function` (397), `require-await` (310), `no-unused-vars` (273), … | `eslintFindings` → 0 → **flip this leg to hard-fail** |

**The cap is decided: 300 raw for `src`/`packages`, 500 for `tests`** — the tight
end of the industry band. ESLint's own `max-lines` default is 300; SonarQube S104
defaults to 750–1000; ~400/500 is the common TypeScript landing zone. The repo's
current posture is ~706 raw (400 effective) plus an 800 raw scan, i.e. the loose
end, and the two numbers are the *same policy written twice in two units*: the 69
files violating `max-lines: 400` have raw counts of min 544 / median 706 / max
2271. `scripts/` is a hard-blocked family for the orchestrator, so every slice in
this table that touches `src`/`tests`/`config` goes through
`peaks sub-agent dispatch rd`.

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
