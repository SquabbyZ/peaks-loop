# peaks-loop Backlog

> Created 2026-09-19 from the Phase A defect-closure session (16 commits, `dc44116b..ae46e118`, released as 4.0.54).
> Everything here was **found and verified** during that session but **deliberately not fixed** — either out of the
> slice's scope, or because it needs a decision rather than an implementation.
>
> **How to read an item.** Each one names where it lives, what was actually measured, and why it was left. Nothing
> here is a guess: if an item says "measured", a command was run. If it says "not measured", that is stated too —
> the session's single most common defect shape was a claim whose evidence was never gathered, so the absence of a
> measurement is written down rather than hidden.
>
> **Revised 2026-09-24** — an audit pass, not a new session, and not by the session that wrote the rest.
> Changed and marked inline: **1.2, 1.3, 2 preamble, 2.1, 2.4, 2.9, 2.10 (new), 2.11 (new), 3, 6.1, 6.2**.
> The pass began as a re-measurement of §3, and its finding turned out to be about this document:
> **`cf21d188` — the 1129-file reformat — invalidated the line numbers quoted throughout**, and two items
> were wrong beyond that (§2.9's file size, §2.4's second half). Every correction is a measurement and its
> command is given inline. Where something is unverified, that is said.
>
> **Later the same day — §2.11 was fixed** (rid `rid-muf2sasw`), and the work changed three of this
> document's own entries. §2.11 now records what shipped, and that **its first implementation was wrong
> in exactly the shape this document is about** (a `fresh` verdict over an incomplete `dist/`, reachable
> from `pnpm dev`) — caught by an independent QA agent, not by its author. **§2.12 and §2.13 are both new, and §2.12 is the more serious.** §2.12: the emit check walks
> only the **top level** of `src/`, so **19 of 37 sources** are invisible to it — the §2.11 shape one
> directory down, because a nested emit *is* imported. It is **pre-existing** (`bef907a4`, 2026-07-30,
> proven with `git log -S`), so it must not be attributed to §2.11. §2.13 is the root-`dist/` axis:
> **two** files rather than the one an earlier pass claimed, and one of the two fails *without* any
> remediation text. Note also that three competent measurements of the same import count (190 / 192 / 195)
> disagree, which is why those numbers were dropped rather than pinned — a permanently-reproducible wrong
> number is worse than no number. The same disease appears on a *timing*: four measurements of one
> `pnpm build` spread **8.89 s – 14.2 s**, and that spread is host variance, so §2.13 carries a range.
>
> **Revised 2026-09-25 — a rescue, not an audit.** §2.14 and §2.15 are new. Both record material that
> existed **only in gitignored session artifacts** (`rd/…-repair-5-handoff.md` §4 and
> `qa/security-…md`), whose home does not survive the session that wrote them. Nothing here was
> re-measured — every number is quoted from the report named inline, and where a claim was never
> measured that is said rather than smoothed over. The rescue changed no verdict: §2.14's three sites
> remain deliberately unfixed, and §2.15's four findings were **decided the same day — queued as work
> items, not accepted** (the call was the user's, and it is recorded in the entry rather than left
> implied).
>
> **Same day, later again.** §2.15's F3 and F4 were then taken as job `pkg-build-guard-lows` slice 1
> and are **fixed** — see §2.15's Outcome block, which also records a third defect the slice found. So
> §2.15 is no longer a queue entry for all four findings; **F5 and F6 remain queued** as slice 2. §2.8
> gained one entry from the same slice.

---

## 0. The shape (why these exist)

The session's working finding, stated once so the items below read as instances of it rather than as a list:

> **A cheap approximation replaced a real property, and then the approximation was never checked again.**

Every item below is one instance. The corollary that decided how each was handled:

> **"It can fail" and "it misses nothing" are two different claims, and verification is usually pointed at the first.**

---

## 1. Needs a decision, not an implementation

### 1.1 `docs/**` — 165 dangling citations, genre undecided

- **Where**: `docs/superpowers/{plans,specs}/**` (14 files) plus the repo-root `docs/`
- **Measured**: adding `docs/` to the citation guard's corpus reports **165 findings across 11 files**. Of 71 distinct
  cited paths, **62 never existed** (planned-but-never-built: `packages/runtime/**`, pre-`skills/` `.claude/skills/**`,
  `2026-MM-DD-*` fill-ins) and **9 did exist and were deleted** — those 9 correspond 1:1 to the 9 diagnosis findings
  D1 called genuine.
- **Decided**: `docs/superpowers/**` is **not in the guard's genre** (plan prose is intent, not obligation). Recorded
  in the guard's `CORPUS_ENTRIES` comment.
- **Still open**: the **9 genuinely dangling** citations are not dispositioned. Either fix them, or state explicitly
  that historical plan documents are exempt from citation integrity.
- **Scale note**: 165 is the same order as 4.0.51's 178/64 when `skills/**` was added — which is why it was not
  widened in-session.

### 1.2 `.peaks/memory/` — 83 stale pointers across 42 files

- **Measured**: of 1584 backticked repo-anchored paths in `.peaks/memory/`, **608 do not resolve**. Of those, **83
  point at a file that still exists elsewhere** (moved, not deleted) — the genuinely stale class. The rest are
  ephemeral `.peaks/_runtime/` artifacts or files legitimately deleted since.
- **Fixed in-session**: 5 pointers across 3 files (the ones the doc migration broke).
- **Decided by the user**: stale historical sediment should be **fixed or discarded**.
- **Still open**: the remaining 83. They include the `skills/peaks-rd/` → `skills/bee/peaks-rd/` move and the
  `packages/peaks-loop-mut/` extraction.
- **One sub-class sized 2026-09-24** (measured; the other half deliberately not): the skill-move class is
  **8 occurrences across 7 files** — `grep -ro 'skills/peaks-rd' .peaks/memory/ | wc -l` → 8, across 7 files, of
  which **2 sit under `archived/`**. `skills/peaks-rd` does not exist and `skills/bee/peaks-rd` does, so these
  are stale as described. Note `archived/` is sediment being kept for the record — whether *it* should be
  rewritten at all is part of the decision, not a mechanical consequence of it.
- **The `packages/peaks-loop-mut/` half was NOT checked, and cannot be by existence alone.** That bullet means
  pointers broken by files *moving into* the package, not pointers *to* it — and the package does exist, so
  "the path resolves" would refute nothing. Checking it needs the 1584-path traversal, which this pass did not
  re-run. The 83 is therefore still the 2026-09-19 number, not a fresh one.
- **Note**: `.peaks/memory/` is **not** in the citation guard's corpus, so nothing will flag these automatically.

### 1.3 `test-style-contract.md` moved — downstream unverified

- **Change**: `docs/test-style-contract.md` → `contracts/test-style-contract.md` (4.0.54). It ships in the npm
  tarball, so the consumer-visible path changed to
  `node_modules/peaks-loop/contracts/test-style-contract.md`.
- **Measured**: no runtime reader in `src/`/`scripts/`/`packages/`; both `npm pack` and `pnpm pack` include it.
- **Still open**: **no downstream consumer was checked.** If any project reads the old path, it breaks silently.
- **Narrowed 2026-09-24 — closed as far as it can be closed from this repo:**
  - `contracts/test-style-contract.md` exists (4839 bytes) and **is** in `package.json#files` (`:88`), so it
    ships. The entry is **pinned** by `tests/unit/publish/files-entries-resolve.test.ts:290`, and that guard
    has a **negative arm** (`:157`/`:164` assert a non-existent entry like `docs/test-style-contract.md` IS
    reported) — so the pin is falsifiable, not decorative.
  - **No shipped instruction points at the old path.** A repo-wide grep for `test-style-contract` over
    `*.ts` / `*.mjs` / `*.js` / `*.json` / `*.md` finds the old path only in `CHANGELOG.md:1046` (historical
    entry, correctly historical) and as the negative fixture above. Nothing under `skills/**` or `README*`
    tells a consumer to read `docs/…`.
  - **What remains is inherently unverifiable here**: whether some *external* project hard-coded the old
    path. That cannot be settled from this checkout, and no further in-repo check will settle it.
- **Why it moved**: it is a published contract, and `.peaks/` reads as private tool state; `contracts/` reads public.

---

## 2. Real defects, verified — one now fixed, the rest not

> **§2.11 is FIXED** (2026-09-24, rid `rid-muf2sasw`) and its entry records what shipped. Everything else
> in this section is still open. The section keeps its name for the rest of the items; read §2.11's entry,
> not this heading, for its state.
>
> **Citations re-verified 2026-09-24.** `cf21d188` reformatted 1129 files, so the line numbers
> this section quotes were invalidated by a commit that changed no semantics. Re-checked against
> the current tree, item by item — the **substances all still hold**; several citations had rotted.
> Paths were written loosely here (bare filenames), which is why some do not resolve verbatim.
>
> | Item | Cited | Actual now | Substance |
> |---|---|---|---|
> | 2.1 | `dispatch-commands.ts:196` / `:199` | **`:262-264`** / **`:266`** | **live** — the `--from-dag` branch still returns before `validateRole` |
> | 2.1 | `sub-agent-dispatcher.ts:169` | `:169` — `src/services/dispatch/` | **live, exact** |
> | 2.2 | `reviewer-dispatch-policy` | `src/services/rd/reviewer-dispatch-policy.ts` | **live, exact** — re-measured: 13 exports, exactly **11** with zero refs |
> | 2.3 | `skill-command.ts:57` | **`:71-78`** | **live, and sharper** — see below |
> | 2.5 | `index.ts:100` | `:100` | **live, exact** |
> | 2.4 | `src/services/release/` | `release-state.ts:85-100` | **half falsified → narrowed**; see below |
> | 2.6 | `vitest-concurrency-guard.test.ts` | 95 lines | file exists; §2.9's size for it was wrong |
>
> **Not re-verified**: 2.7, 2.8. Said plainly rather than left implied.
>
> **2.4 lost its second half.** It claimed `rollbackRelease` and siblings skip `isValidStageTransition`;
> they do not (`:160`, `:135`). The defect is the **reader** only, which makes it a contained fix rather
> than a release-safety hole. Details inline at 2.4.
>
> **2.3 is understated as written.** It says `auto-fire` "has no `action` equivalent". The actual
> code (`code-runtime-commands.ts:80`) is `kind === 'none' ? 'ok' : 'soft-warn'` — so `auto-fire`
> is **reported as `soft-warn`**, an actively wrong label, not a missing one. `skill-command.ts:78`
> publishes `action: trigger.kind` verbatim and so is correct. That matters because `auto-fire`
> (≥ 0.80) is the tier that mandates compaction, while the probe a reader trusts says everything is
> merely soft — a silent under-report the peaks-code skill itself acknowledges in prose.

### 2.1 `--from-dag` validates no role

- **Where**: `src/cli/commands/dispatch-commands.ts:262-264` — the `--from-dag` branch calls
  `runDispatchFromDag` and returns — **before** `validateRole` at `:266`, which is still its only call
  site repo-wide (defined at `sub-agent-shared.ts:185`, re-exported `sub-agent-commands.ts:34`). The
  path's only check remains `supportsRole: (role) => role.length > 0`
  (`src/services/dispatch/sub-agent-dispatcher.ts:169`). *Cited as `:196`/`:199` before 2026-09-24;
  those lines rotted in the reformat — see the §2 preamble.*
- **Consequence**: the deprecated-reviewer policy F2 wired into the warm path is bypassed entirely by `--from-dag`.
  Same validator, one of two paths missing it.

### 2.2 `reviewer-dispatch-policy` — 11 of 13 exports still unreferenced

- **Measured**: 13/13 exports had zero references across `src/`+`packages/`+`scripts/` (865 files scanned). F2 wired
  one call path; **11 remain unreferenced**, and **the 5→3 decision-table half is pinned by nothing** (the predicate
  half is covered by `reviewer-dispatch-policy.test.ts`, 6 cases, added `7191140f`).

### 2.3 Two vocabularies over one threshold table

- **Measured**: `peaks skill presence` (`core/skill-command.ts:57`) and `peaks code context-now`
  (`code-runtime-commands.ts`) **both** call `evaluateCompactTrigger` + `resolveAutoCompactProfile`, but publish
  **different vocabularies**: the former emits `trigger.kind` verbatim (`none|soft-warn|auto-fire|pre-compact|
  red-line`), the latter maps to `action` (`ok|soft-warn|auto-compact-now|red-line`). `auto-fire` has no `action`
  equivalent. H4 aligned the two on behaviour but **did not unify the vocabularies**.

### 2.4 `readReleaseState` trusts an unvalidated `currentStage`

- **Where**: `src/services/release/release-state.ts:85-100` — `readReleaseState` casts
  (`JSON.parse(raw) as Partial<ReleaseState>`, `:90`) and returns `parsed.active` verbatim (`:94`). It
  checks only `parsed.version !== 1`. The validator that would catch this **exists** —
  `isReleaseStage(value): value is ReleaseStage` at `:52` — and `readReleaseState` never calls it.
- **Consequence**: a state file with an unknown or retired stage (e.g. the dropped `hotfixed`) is read as-is.
  H2 hardened `isValidStageTransition` itself (`(VALID_TRANSITIONS[from] ?? [])`, `:49`) but not this reader.
- **CORRECTED 2026-09-24 — the second half of this item was wrong, and the correction narrows it.**
  It read "`rollbackRelease` and siblings do not pass through `isValidStageTransition`". They **do**:
  `rollbackRelease` calls it at `:160`, and the transition path calls it at `:135`. So the hole is
  **only the reader**, not the transitions.
  - **The real impact is therefore smaller than it looked**: an unknown stage is accepted on read and then
    surfaces in output/typing (a state file claiming a stage the table no longer has), but every
    *transition out of it* is already refused — `VALID_TRANSITIONS[from] ?? []` yields `[]`, so
    `isValidStageTransition` returns `false`. It is a **display/typing lie, not a transition-safety hole.**
  - That matters for prioritisation: §2.4 is a small, contained fix (validate on read, e.g. via
    `isReleaseStage`, and decide what to do with a stage that fails), not a release-safety defect.

### 2.5 `metadataKey` check is unreachable for object input

- **Where**: `src/services/memory/project-memory-service/store/atomic-write.ts`
- **Measured**: `containsSensitiveConfigValue` **recurses into values**, so `{…body:{token:'x'}}` returns `true`;
  the branch is only unreachable for **string** input. `assertSafeMemory` is a **public export** (`index.ts:100`),
  so deleting the branch **would** weaken detection. Zero test coverage.
- **Corrected in-session**: the tech-doc's mechanism description was wrong and is now right; the branch itself stays.

### 2.6 A guard whose two dimensions have no assertions

- **Where**: `tests/unit/vitest-concurrency-guard.test.ts`
- **Measured**: the file's own header claims four dimensions; "cap within a sane bound" and "env override honored"
  have **zero assertions**. The negative arm was added in-session (it now catches the comment-out form), but those
  two dimensions are still empty.

### 2.7 Two bounded blind spots, deliberately not widened

- `const maxWorkers = 1` still passes `vitest-concurrency-guard` — the added assertion targets the ACTIVE line, not
  the value.
- The upstream tag sanitiser `sed 's/[-+].*//'` still passes `publish-tag-strict` — the operand assertion is bounded.
- Both recorded; neither widened, because widening needs a reason and a red case.

### 2.8 Residual reach gaps in the citation guard

- `docs/nonexistent.md:42:43` (`path:line:col`) is **silent** — now in the `LINE_SUFFIX` comment and pinned by m4.
- Ranges `path.ts:14-17` remain **invisible**; the single corpus instance (`coding-style.md:39`) names a file that
  **exists**, so it is a live citation behind the blind spot.
- Backticked bare filenames (no `tests/` prefix, no slash) remain invisible; closing it is a resolution-contract
  change, not a candidate widening.
- **The guard admits a citation by EXCLUSION as well as by resolution** (found by QA in `rid-30cc31f7`'s
  cycle 2, 2026-09-25). `repo-citation-integrity.test.ts:1267` accepts a path that either `existsSync`es
  **or** `isGitIgnored`s. A cited `.peaks/_runtime/**` artifact therefore passes because **git never tracks
  it**, not because it resolves — prune the artifact and the citation dangles green. The distinction matters
  because "ignored" is a property of the git configuration, not of the file: a citation into a gitignored
  tree is unverifiable by this guard by construction, so a claim resting on one is only as durable as the
  gitignore rule that hides it. The `rid-30cc31f7` provenance happened to survive on a second, tracked leg
  (`backlog.md` §2.13), which is what made the gap visible rather than harmful there — a citation whose
  *only* leg is gitignored would have none. Note this is a scope statement, not a proposed widening: the
  guard's own header argues the ignored-leg was deliberate, and closing it would mean deciding what a
  citation into a gitignored tree is even supposed to assert.

### 2.9 Coverage of the guard audit itself

- **Measured**: of the corrected **46 stations**, only **22** have had mutation runs.
- Guards in `scripts/**` / CI jobs / `packages/*/tests/**` **were never enumerated** — all five enumeration
  strategies keyed on `tests/**/*.test.ts`.
- The concurrency guard file is **95 lines** — corrected 2026-09-24; it is not 1292, and no larger
  file of that name exists. `tests/unit/vitest-concurrency-guard.test.ts` is the only match
  (95 lines / 4975 bytes). The 1292 in this bullet is the **citation** guard's number, carried over
  from §3. See §3 for the real cap — which is not 800 either.

### 2.10 The D5 no-touch-stockcode waiver is INERT on every checkout but one (found 2026-09-24)

- **Where**: `.peaks/lint/baseline.json` — **tracked in git**. 192 violations, 29 distinct paths,
  22 ruleIds (`max-lines` 5, `max-lines-per-function` 17).
- **Measured**: every `file` key is an **absolute** path rooted at
  `C:\Users\smallMark\Desktop\peaks-loop\`. `matchBaseline` (`src/services/lint/eslint-runner.ts:256`)
  compares `ruleId` + `file` + `line` by **exact string equality**, `finding.filePath` is ESLint's own
  absolute path (`:409-419`), and `loadBaseline` (`:220`) never normalizes. So on this checkout
  (`D:\peaks-loop`) nothing can ever match.
- **Measured, not inferred**: `peaks lint check --json` on the current tree returns
  **`baselineWaived: 0`**, and its `redLine` hot spots name `C:\Users\smallMark\Desktop\…` paths that do
  not exist here. This is not partial degradation — the waiver is null.
- **Why it stays invisible**: `peaks lint check` is **diff-scoped** (`inDiff`, `:453`), so an untouched
  file never surfaces anything. It bites the moment you edit a file that IS in the baseline — its
  pre-existing violations stop being waived and present as **new** findings. That is precisely the
  false-regression shape
  `.peaks/memory/comparing-counts-across-rounds-guarantees-a-false-regression-report.md` warns about.
- **Also stale**: `generatedAt: 2026-08-07`, `toolVersion: peaks-loop-4.0.16+` (current is 4.0.54).
- **Side effect**: a personal absolute path is committed to the repository.
- **Not fixed, and the fix is a decision**: regenerating is `peaks lint baseline`, but that re-roots the
  file at whichever machine ran it — the **format**, not just the contents, is the portability bug.
  Either normalize to repo-relative keys in `matchBaseline` (source change → RD), or untrack the file
  and keep it per-machine (policy change → you).

### 2.11 `pnpm test:unit` skips the build its own suite requires (found 2026-09-24)

- **Measured, on a fresh setup** (`node_modules` installed 02:36; `dist/` never built), on a host booted
  ten minutes earlier — so neither uptime nor load is in play:
  - `pnpm test:unit` → **166 of 312 files FAILED**, `Tests 13 failed | 1573 passed`. Dominant error:
    `Cannot find package 'peaks-loop-shared/result' imported from src/cli/cli-helpers.ts`.
  - `pnpm build` (exit 0) → `pnpm test:unit` again → **312 passed, 3476 passed / 3 skipped / 0 failed,
    210.85 s.** Identical source. The only difference is a built `dist/`.
- **Mechanism**: `package.json#scripts.pretest` exists and runs
  `sync-version.mjs && pnpm --filter peaks-loop-shared build && check-build-integrity.mjs`. That hook fires
  for **`test`** — not for **`test:unit`**, whose npm/pnpm pre-hook would have to be named `pretest:unit`,
  and no such script exists. So the one command everyone runs (and the one the handoff quotes as the
  full-suite record) is exactly the one that skips the build.
- **Why it matters — this is a SECOND, deterministic cause of a red full suite.** The handoff's
  "a red full-suite run here is NOT evidence of a regression" section names the host (uptime) as the cause
  and tells the reader to check wall clock first. This failure is the opposite: reproducible, fast (105 s),
  and deterministic — while wearing the same signal, a red test. An agent reaching for the uptime
  explanation here would be exactly as wrong as the three misattributions §6 records.
- **It is also the class the handoff declared closed.** That section states the principled fix: a test
  should **state its prerequisite** when the prerequisite is absent. Here the prerequisite (a built
  workspace) is absent and 166 files report it as a red test instead. The handoff found **one** surviving
  instance by reading source; this one is 166 files and was found by running the command the doc recommends.
- **FIXED 2026-09-24** (rid `rid-muf2sasw`). The decision the paragraph above called for was made by the
  user — a vitest `globalSetup` that **builds what is missing** and **refuses on what is stale** — and the
  tradeoff turned out smaller than the framing implied: `pnpm -r --filter "./packages/*" run build` costs
  **2170 ms** against a 177–210 s `test:unit`, ~1.1 %. Not a real tradeoff; the framing had assumed it was.
- **The defect was larger than this item recorded: `pretest` was broken TWICE.** Besides building 1 of the
  4 required packages, its `check-build-integrity.mjs` step **requires all four already built**, so on a
  clean checkout it failed outright. Measured, one unit file, three states: no `dist/` → fail (does not
  even collect); **`peaks-loop-shared` built only — i.e. exactly what `pretest` did — still fails**; all
  four built → passes. The error it produces blames the wrong thing:
  `Failed to resolve entry for package "peaks-loop-internal-runtime" … may have incorrect main/module/exports`.
  It is not configuration; it is an absent artifact.
- **What shipped**: `tests/_global-setup/packages-build.ts` (the `globalSetup`, wired into `vitest.config.ts`
  and `vitest.config.integration.ts`), `scripts/packages-build-prerequisite.mjs` (verdict + lock + build +
  refusal), `scripts/write-package-dist-stamps.mjs`; `pretest` now builds 4 of 4.
- **Staleness is content-derived, and on this axis that is forced, not preferred.** It reuses the existing
  `computeSourceDigest` — **no mtime comparison anywhere**, because `sync-version.mjs` rewrites
  `peaks-loop-shared/src/version.ts` on every `pretest`, so an mtime rule would report that package stale
  on every run. Stamps live in `packages/.dist-stamps.json`: **measured with `npm pack`**, a stamp placed
  inside a package's `dist/` **ships** (the three curated packages declare `files:["dist/**"]`), and
  `peaks-loop-internal-runtime` has no `files` field at all (70 files in its tarball, its whole `src/`).
- **The first implementation was WRONG, and independent QA caught it — recorded here because it is this
  document's own shape.** The guard digested `src/` only and never checked the **emit** was complete.
  `sync-version.mjs` **unlinks** `packages/peaks-loop-shared/dist/version.js` on every run, and `predev`
  runs it with **no following build**. So `pnpm dev` → guard reports **`fresh ×4`** → the next `test:unit`
  fails with `Cannot find package 'peaks-loop-shared/version' imported from src/cli/program.ts` — **a
  missing artifact read as a module-resolution error**, the exact shape this item exists to remove.
  Reproduced by the orchestrator on the real repo with the repo's own script, then fixed by adding an
  `emitIsComplete` conjunct (the rule `check-build-integrity.mjs` already encodes). The incomplete case is
  bucketed **`stale`, not `missing`**: QA's proposed alternative was measured, on the same input, to
  silently *rebuild* — which would also swallow a package whose content had moved on.
- **Reproduce**: on an unbuilt tree, `pnpm test:unit`; then `pnpm build`; then `pnpm test:unit`. For the
  false-fresh: `node scripts/sync-version.mjs` then `node -e "import('./scripts/packages-build-prerequisite.mjs')\
  .then(m=>console.log(m.evaluatePackages(process.cwd())))"` — it must report `stale`, not `fresh`.
- **Behaviour change worth a CHANGELOG line**: on a tree whose `dist/` predates the stamp step, the first
  test run **refuses once** and names the packages plus `pnpm build`. Deliberate: unstamped is reported
  stale rather than guessed fresh.
- **Related and confirmed clean — do not re-open**: `pretest` also runs `sync-version.mjs`, and S5a's fix
  (§6.2) holds. `git status` is unchanged after a full `pnpm build` **and** after a full `pnpm test:unit`:
  neither dirties a tracked file. Verified twice, in that order.

### 2.12 The emit check walks only the **top level** of `src/` — 19 of 37 sources it cannot see (found 2026-09-24)

- **Where**: `scripts/check-build-integrity.mjs` (the gate) **and** the emit conjunct of
  `scripts/packages-build-prerequisite.mjs` (the §2.11 guard). Both `readdirSync` the top level of each
  package's `src/`; **neither recurses**. Measured: of **37** `src/*.ts` across the four packages,
  **18 are top-level and 19 are nested** — 2 of 4 packages have nested `src/` (`internal-runtime` 9,
  `mut` 10) — so **51 % of the surface is invisible to the check**.
- **The honest statement of the defect.** It is **not** "19 sources have no emit" — that count is
  **0**, because `tsc` emits recursively and the digest walk is recursive too (a nested *source* edit
  does produce `stale`). It is: **the check cannot see 19 nested sources**, so a nested emit can vanish
  with both guards green. Both readings were live in this session's own notes; only the second is true.
- **Pre-existing, and proven rather than assumed.** The gate is unmodified against `HEAD`; the
  top-level `readdirSync(srcDir)` was already there when the walk was added in **`bef907a4`
  (2026-07-30)**, and `git log -S listFiles` shows it was never recursive. This is **not** a regression
  of §2.11 and must not be attributed to that slice.
- **Measured consequence.** Delete the nested emit
  `packages/peaks-loop-mut/dist/services/mut/report-loader.js` → the §2.11 guard reports **`fresh`**,
  and the gate prints **`build-integrity: OK`** (exit 0). Two green gates over a tree missing an
  artifact.
- **It outranks §2.13 — for the reason §2.11 itself exists.** A nested emit **is imported**, so this is
  the §2.11 shape one directory down: a missing artifact that surfaces as a module-resolution error.
  §2.13's root-`dist/` axis is the weaker case.
- **Not fixed here, deliberately.** §2.11's guard states its scope as the gate's own top-level rule, and
  changing the walk touches the gate that every build consumer shares. **A recursive walk is the fix**;
  it belongs in its own slice.
- **And the doc defect that hid it**: the §2.11 module header calls its check "complete" without ever
  sizing what it excludes. It glosses "complete" as the gate's top-level rule at `:73-75` and *does*
  record the nested case at `:102-109` — so it **bounds** the claim rather than falsifying it — but the
  isolated sentence at `:58-60` is false as written, and **51 %** is the number it should have carried.

### 2.13 A second prerequisite on the **root** `dist/` axis — two unit files, one of them misleading (found 2026-09-24)

- **Where**: the repo-root `dist/`, **not** `packages/*/dist`. `src/` is tested as TS through the vitest
  alias, but the root `dist/cli/index.js` is spawned by exactly one unit file
  (`tests/unit/cli/_statusline-rpc-helper.mjs` → `../../../dist/cli/program.js`).
- **Measured** with the root `dist/` moved aside: **`Test Files 2 failed (2)`**,
  `Tests 1 failed | 2 passed (3)`.
  - `tests/unit/cli/statusline-cli-integration.test.ts` — **loud and directed**; it throws
    `Run "pnpm build" in the repo root before running this test`.
  - `tests/unit/cli/verify-codegraph-tarball.test.ts:87` — **`AssertionError: expected 1 to be +0`
    with no remediation text at all.** That is the *misleading* shape, not the loud one.
- **Deliberately NOT covered by the §2.11 fix, and the reason is cost.** Covering it means an implicit
  root `tsc` on every test run — full `pnpm build` at **≈9–14 s** (see the next bullet), against the
  2170 ms the package axis costs. The earlier justification for leaving it out — "exactly **one** file
  fails, and it fails loudly, so it is not this defect's shape" — was **falsified**: it is two files, and
  the second one *is* the misleading shape. The scope call survives; the reason given for it did not.
- **A number four measurements disagreed about — recorded because it is this document's own disease.**
  Three agents measured the same command and got **8.89 s → 11 153 ms → 13 731 / 14 178 ms → 9277 /
  8909 / 8946 ms**. Three quiet runs at ≈8.9 s reproduce the *first* figure, and no `tsbuildinfo` exists
  (and `clean-dist` wipes `dist/`), so all four measurements did the same work: this is **host variance
  of ~60 %, not error**. Two consequences. Quote a **range (≈9–14 s, load-dependent)**, never a single
  figure — and note that the intermediate "≈11–14 s" range was itself wrong, because it *excluded* a
  value that reproduces 3 times out of 3. A single measurement of a host-sensitive command is not a
  fact about the command.
- **Open, two ways out**: accept the ~9–14 s, or give `verify-codegraph-tarball.test.ts` a stated
  prerequisite so its failure is directed rather than a bare `-0 +1` assertion diff. The second is
  cheaper and matches the pattern the handoff already ruled correct.

### 2.14 Three more places the build guard returns green without establishing anything (rescued 2026-09-25)

- **Where**: `scripts/packages-build-prerequisite.mjs` (the §2.11 guard) and
  `scripts/write-package-dist-stamps.mjs` (its writer-side twin).
- **Source of record**: `rd/rid-muf2sasw-repair-5-handoff.md` §4 — a **gitignored** artifact from
  session `2026-09-24-session-b714c7`. Rescued 2026-09-25 because its home does not survive the
  session; **not re-measured**, so every claim below is that report's.
- **The three**, examined by that repair and deliberately left:

1. **`listPackageRoots`'s per-package drop criterion.** A package whose `src/` is empty — or
   unreadable, via the same `catch { return false }` — is dropped from the guard entirely: never
   `missing`, never `stale`, never vouched for either. **No live instance**: two existing cases pin
   the walk against git's index and against the `node_modules` links, and both agree on the real
   tree. The filter is now **load-bearing in the other direction** — without it a package with an
   empty `src/` would be `missing` forever (tsc emits nothing for it), so F1's post-build assertion
   would refuse a tree that `REBUILD_COMMAND` can never repair. The drop is what makes the assertion
   assertable; it is named here because it is the same "an entry can disappear from the guard
   silently" shape.
2. **`emitIsComplete` composed with `computeSourceDigest`.** `emitIsComplete` over an **absent**
   `src/` is `false` (its `catch` covers both `readdirSync`s), but over an **empty** `src/` dir it is
   `true` (`.every()` on no files) — and the digest of nothing is a constant that
   `writePackageDistStamps` would happily record, leaving a package reading `fresh` over a `dist/`
   built from deleted sources. Gated by the same empty-`src/` filter as (1), so no exported entry
   point reaches it. The same "two safe-looking helpers compose into a vouch" shape, **one predicate
   away from reachable**.
3. **`scripts/write-package-dist-stamps.mjs`'s `0 package(s) recorded` exit-0 path.** With
   `packages/` present but holding no src-bearing package it writes `{"packages":{}}`, prints
   `0 package(s) recorded` and exits 0 — the writer's version of F2b. (An *absent* `packages/` fails
   loudly with ENOENT on the stamp path, so only the empty-but-present case is quiet.) Its output
   makes every real package `stale` in the guard, i.e. the safe direction, and the guard now refuses
   the empty case outright — so this is **reported, not fixed**; the repair belongs to whoever next
   owns that script.

- **Examined in the same sweep and judged fine — do not re-sweep**: `hasBuild`'s `.js` filter (a
  stray `.js` in `dist/` reads as "built"; the digest + emit pair then refuses rather than vouches);
  the globalSetup reading only `result.built` (sound *only because the module throws* — the invariant
  is "returned ⇒ established"); and the battery-level lesson that a test pinning a collaborator's
  effect can stand in for the module's own contract and read as an arm that does not exist.
- **Not fixed, deliberately**: repair 5's scope was F1 / F2a / F2b, and no executable line near these
  three was changed.

### 2.15 Four `low` findings on the same guard — F3+F4 fixed, F5+F6 queued (rescued 2026-09-25)

**STATUS 2026-09-25, later the same day.** F3 and F4 were taken as job `pkg-build-guard-lows` slice 1
(rid `rid-30cc31f7`). Both are **fixed**, and a third defect the slice uncovered is fixed with them.
F5 and F6 remain queued as slice 2 of the same job. The paragraph below is the entry as rescued; the
outcome block after it records what changed.

- **Where**: `scripts/packages-build-prerequisite.mjs` (lock + stamp semantics).
- **Source of record**: `qa/security-rid-muf2sasw.md` — also a **gitignored** artifact. Rescued here
  2026-09-25; the numbers are that report's, **not re-measured**.
- **Disposition — decided 2026-09-25: these are work items, not accepted.** The decision was the
  user's, as the previous session left it; the answer is "queue them". They remain `low`, and each
  carries the reachability analysis that explains why — but "no reachable path on this host" is a
  measurement about *this host*, not a verdict that the shape is fine. Fixing any of them touches
  `scripts/`, so each is an RD slice, not an orchestrator edit.

#### Outcome (rid-30cc31f7)

- **F4 — closed.** The lock file now carries its holder's token, written by the same
  `O_CREAT|O_EXCL` create that makes the file, and `releaseLock(lock, token)` unlinks **only** a lock
  whose content is its own token. The `:182` killed-process property survives: a stale lock is still
  broken by a later run. Falsified by mutation, not by assertion — two independently written harnesses
  (RD's and QA's) killed 5/5 and 5/5, including QA's `q4` (token threading dropped) which the RD's
  harness did not contain, and `r4a` (a falsy token treated as ours).
- **F3 — closed, and its reachability corrected while closing it.** The review framed reachability
  around *another local user* planting a lock and showed that on this host one cannot; but the guard's
  **own** process is a lock source, and a run killed between its `open` and its `finally` leaves one.
  That path needs no second user and no permissive platform. The `LOCK_WAIT_MS` / `LOCK_STALE_MS`
  ordering is kept, with the reason now written where the constant is.
- **D1 — a third defect, found by QA cycle 1 and fixed here with the user's explicit approval.**
  `unlinkSync` failing `EPERM` on a **directory** at the lock path was swallowed, and the `continue`
  then fired **before** the deadline check and before the `sleep` — a tight infinite loop. QA measured
  it spinning at 15 s; the orchestrator then found a **live instance on this host**, an empty
  directory at `%TEMP%/peaks-packages-build-a946aeb543aca482.lock` (not this repository's lock path).
  The check now precedes the stale break and the `continue` is gone. The A/B is the point: moving the
  check alone terminates but burns **~969 ms CPU** in the 1000 ms window; removing the `continue` as
  well gives **1025 ms wall / 0 ms CPU**. Pre-existing at `HEAD`, not a repair-0 regression.
- **The `LOCK_WAIT_MS` rider is done, and the number it carried was wrong twice over.** The retired
  sentence quoted "2.94 s … ~20x". Repair 1 first corrected the classification (2.94 s is **below** the
  8.89–14.2 s spread, not a member of it), then found the deeper error: those five values are
  **`pnpm build`** runs — the whole `package.json#scripts.build` chain, which *includes* the packages
  build as one step — while the command this lock actually guards, `PACKAGES_BUILD_COMMAND`, measures
  **2.94 s** on a warm tree. QA then proved the classification harder than the RD had, by noticing each
  log line carries `build-integrity:OK=true`, a `scripts.build`/`pretest` step and not a step of the
  guarded command (`pretest` = 3.12 s). So the range is an **upper proxy** and the quoted margins are
  the conservative ones (6.7× fastest / 4.2× slowest; ~20× against the guarded command itself).
- **Two claims the repair wrote, and then had to make true.** Repair 1's handoff *said* it had narrowed
  the window claim to "cannot be unlinked"; QA read the text and the narrowing was **not there** — two
  sentences still said every pass either acquires, refuses, or sleeps, which is false for the
  `statSync`-failure pass. Repair 2 scoped both and **named the exception beside the claim**. That
  sentence was previously an assertion; it is now a consequence.
- **Residual, disclosed and not fixed**: the `statSync`-failure `continue` still precedes both bounds
  and the sleep. QA could not route it on this host — a dangling symlink's create **succeeds through
  the link**, an absent target parent gives `ENOENT`, and a symlink loop gives `ELOOP`, each a directed
  refusal. The POSIX route is **reasoned, not measured**. This entry owns that routing. Closing it
  would need a refusal for a lock of unknown age, which is a design change, not a repair.
- **A limitation that must not be over-read**: the shipped `unbroke` case reddens the **pre-fix**
  route (unbounded spin) but stays **green** under the half-fix (bound moved, `continue` kept) — a
  bounded-but-busy spin. The test falsifies the defect, not every partial fix; the header ledger says
  so, and the CPU figure is pinned by the A/B probe rather than by a timing assertion in the suite.

**F3 — the pre-created-lock wedge is real but narrower than its header implies, and platform-gated.**
Measured: a lock file this process did not create, with a fresh mtime, is waited out and then refused —

```
THREW after 8111ms
  msg: Another peaks-loop process holds the packages build lock (age 8s), so this run gave up after 8s.
```

— and it is **never broken**, because `LOCK_STALE_MS` (10 min) exceeds `LOCK_WAIT_MS` (60 s), so a
repeated pre-create wedges every clean-checkout run at the full 60 s bound each time. Two corrections
to the header's implication: the lock is taken **only when something is `missing`**, so a `fresh`
tree never touches it (the wedge hits clean checkouts and CI, not warm trees); and on this platform
another local user **cannot** create that file (`icacls %TEMP%` names only SYSTEM, Administrators,
SMALL\small). The wedge *would* be reachable on a POSIX host with a shared `/tmp` (the sticky bit
prevents deleting others' files, not creating one). **Not determinable on this host.** Collision
(`LOCK_KEY_HEX_CHARS = 16` = 64 bits, `peaks-packages-build-…-8.lock` measured) is ~2^64 by accident;
a *deliberate* targeted collision is ~2^32 and needs the same platform gate. Worst reached:
serialization, plus a misleading message.

**F4 — a lock broken as stale lets a non-holder delete the new holder's lock.** `acquireLock` unlinks
a lock older than `LOCK_STALE_MS` and then loops to `openSync(…, 'wx')`; `releaseLock` unconditionally
unlinks inside a `finally`; and there is no owner token (the file is empty). So A holds the lock for
>10 min → B breaks it as stale and acquires → A's `finally` unlinks **B's** lock → C may then acquire
concurrently with B. Same ABA with no collision at all. Reachable only if `PACKAGES_BUILD_COMMAND`
exceeds 10 minutes, and **no reachable path was found on this host** — the repository's own
`qa/cycle3/build-timings.log` records 9277 / 8909 / 8946 ms, all `exit=0`.

**F5 — the stamp write is non-atomic and unlocked; the refusal misdiagnoses an unreadable stamp, and
its named remedy fails.** `writeFileSync` (open-TRUNC + write) is not atomic, and `readStamps` maps
any read or parse failure to `null`, which makes **every** package `stale`. **Recovery is real: this
is NOT a permanent wedge** — both `build` and `pretest` run `write-package-dist-stamps.mjs`, which
rewrites the file (measured: healthy → truncated → recovered by one `writePackageDistStamps`), and
the refusal names `pnpm build`, so a torn stamp costs one refusal and one rebuild. Two things are
still wrong at the edge. **No lock on the writer**: `write-package-dist-stamps.mjs` takes no lock
while `ensurePackagesBuilt` does, so `pretest`'s stamp write can race a concurrent globalSetup write
on the same 215-byte file — reachable with terminal A `pnpm test` and terminal B `pnpm test:unit`;
the interleaved truncate is readable as an empty file, which parses to `null` and produces a spurious
refusal that goes away on re-run. **And the message is false when the stamp path is unreadable as a
file**: with the stamp path a directory and `dist/` present, the verdict is `stale` and the text
blames `dist/` ("not built from their current src/") — which is false, the stamps are unreadable and
the `dist/` is fine — while the remedy it names does not clear it (`Q3a writePackageDistStamps =>
THREW EISDIR`, caught into `… FAILED` + `process.exit(1)`, so the `&&` chain in `build` never reaches
`tsc`; read-only gives `EPERM` the same shape). **No reachable path was found** that puts a directory
or a read-only file at `packages/.dist-stamps.json` — nothing in the repository does — which is why
this is `low` and not the "un-clearable refusal" class cycle 2 found.

**F6 — the stamp is followed out of the repository, and the guard's trust in it is unverifiable.**
`packages/.dist-stamps.json` being a symlink makes `writeFileSync` overwrite the link **target**,
outside the repository (measured: the target is no longer original), so a symlink there is a write
primitive to any path the invoking user can write. **No reachable path was found that crosses a trust
boundary** — the module runs as the developer, and an actor who can plant that symlink already has
write access to `packages/` and can write `packages/*/dist` directly. The read side is read-only. One
asymmetry: `listPackageRoots` uses `readdirSync(…, {withFileTypes:true})` + `entry.isDirectory()`,
which does **not** follow symlinks, so a symlinked package directory is silently invisible to the
guard — the safe direction for the guard, but it means the guard's package set can differ from pnpm's
`--filter "./packages/*"` glob. **Forged staleness**: the stamp is content-derived but
unauthenticated, and nothing links it to the `dist/` it describes (`emitIsComplete` checks existence
only) — a hand-written stamp makes a `dist/` built from **old** `src/` read `fresh`, and the suite
would then test code that is not the current `src/`, which is the exact failure the guard refuses in
the `stale` direction. The stamp is **gitignored**, so a forged or hand-edited stamp is invisible to
`git status` and to review. A repo-write attacker can forge the artifacts outright, so this is a
**guard-integrity observation, not an escalation**: `info`.

**And the comment defect that rides on F4** — the module's own `LOCK_WAIT_MS` comment (`:206`)
justifies the 60 s bound as "measured at 2.94 s on a warm tree … ~20x that". This repository's own
`qa/cycle3/build-timings.log` says **8.9–9.3 s**, and §2.13 records 8.89 s–14.2 s across four
measurements. The bound is still adequate (~6.6× headroom, not 20×), so this is **comment accuracy,
not behaviour** — but the comment presents a low outlier as the fact, inside the module that was
built to stop numbers being carried forward. Untouched by request.

---

## 3. File-size debt

> **Corrected 2026-09-24.** This section used to be a table titled "800-line cap" whose numbers were
> measured before `cf21d188`. Both the title's number and every row were wrong by the time you read
> them. Re-measure rather than carry these forward — this table has already gone stale once, by
> exactly the mechanism §3.3 records.

### 3.1 Which cap is real

Two constants, and they disagree — deliberately, not by accident:

| Constant | Where | Unit / scope |
|---|---|---|
| `max-lines: 400` (error) | `config/eslint/.peaks-rules.cjs:102`, with `skipBlankLines: true, skipComments: true` | **effective** lines (blank + comment lines excluded) — this is the enforced cap |
| `DEFAULT_FILE_SIZE_THRESHOLD = 800` | `src/services/scan/file-size-scan.ts:5` | **raw** lines, and **diff-scoped** only |

`.peaks/docs/lint-gate.md:84` recorded the disagreement (400 effective vs 800 raw) and proposed
unifying them "in ONE place". That proposal was **not** adopted — the ruling at `lint-gate.md:227`
keeps `max-lines` 400 / `max-lines-per-function` 50. The disagreement stands.

**`peaks scan file-size` does not audit the tree.** It checks the git diff against `--base-ref`
(default `HEAD`), so on a clean tree it reports `checkedFiles: 0`. That is correct behaviour, not a
broken gate — and it is why a repo-wide reformat can carry a file past the threshold with no
diff-gate moment that names it.

### 3.2 Measured at `9a375262`

| File | raw | **effective** (the number that counts) | vs 400 |
|---|---|---|---|
| `src/cli/commands/code-runtime-commands.ts` | 947 | **738** | +338 |
| `src/cli/commands/dispatch-commands.ts` | 1076 | **790** | +390 |
| `tests/unit/standards/repo-citation-integrity.test.ts` | 1409 | **557** | +157 |
| `src/services/artifacts/artifact-prerequisites.ts` | 791 | **410** | +10 |

All four are over. The old table called `code-runtime-commands.ts` "**one line from the cap**" — it
was one line from *800 raw*, which is not the cap.

`tests/**` is **not** exempt: the override at `.peaks-rules.cjs:217` turns off `no-magic-numbers`,
`complexity`, `max-lines-per-function` and `no-explicit-any`, but **not** `max-lines`.

Reproduce — `max: 0` makes eslint print its own effective count per file:

    npx eslint --no-eslintrc --no-ignore --parser @typescript-eslint/parser \
      --rule '{"max-lines":["error",{"max":0,"skipBlankLines":true,"skipComments":true}]}' <files>

**They are NOT waived** — an earlier revision of this section claimed they were, and that claim is
false. `.peaks/lint/baseline.json` cannot match them at all; see §2.10. What keeps them quiet in an
ordinary run is that `peaks lint check` is **diff-scoped**, not the waiver.

### 3.3 Why the numbers moved — and it was one commit

At `ae46e118` (where the old table was measured) three of the four reproduce exactly: **799 / 836 /
768**. The fourth reads **1297**, five above the table's 1292 — consistent with the table being
measured slightly earlier in the session that wrote it.

Every one of them then moved in the **same** commit: `cf21d188`, "style: format the repository
(1129 files)". That commit is **pure formatting**, proven rather than asserted — the `ae46e118` blob
of a file, run through the repository's prettier config, equals the `cf21d188` blob **byte-for-byte**
(`diff lines: 0`). So 799 → 947 on `code-runtime-commands.ts` is 148 lines of reflow, zero semantics.

This is the **known, user-adjudicated cost** of `cf21d188`, not a new defect. Its own message records
the plan "format first, then re-derive the line-size caps from the post-format distribution" and
attributes the ceiling movement exactly (`max-lines` 73 → 101, `max-lines-per-function` 423 → 559,
+28 + +136 = +164). What that plan did not include was updating this table.

**Do not read these four rows as a worklist unless someone decides they are one.** The caps were
ruled to stay; what is over is over by decision. The honest description is "known debt, waived by
`baseline.json`", not "about to be split".

---

## 4. Smaller, recorded

- **The ESLint coverage guard has an untracked-pair window** (`tests/unit/lint/eslint-rules-config-coverage.test.ts`
  enumerates **`git ls-files`**). Found 2026-09-24 while adding `scripts/packages-build-prerequisite.mjs`:
  a new `.mjs` shadowed by its own new `.d.mts` sits **outside the lint program**, and the guard is
  **green while the pair is untracked** — it only reddens on the commit that tracks them. Measured: with
  the pre-fix config and the file staged, the guard names exactly
  `['scripts/packages-build-prerequisite.mjs']`; with the shipped config, `[]`. The fix shipped (one path
  added to `config/eslint/tsconfig.lint.json`, program **+1 member / −0**, so no pre-existing file got
  stricter), and all five untracked in-scope files of that commit were driven through to show the fix was
  **complete** — but the **window itself is unfixed**: a contributor whose commit is the first to track
  such a pair sees the guard fail on a commit that already contains its remedy. Recorded here because the
  only earlier copy of this was in a **gitignored** handoff.
- **`handoff-service.ts` is not routed to the `RuntimeRoot` seam** — inline `join('.peaks','_runtime',…)` string
  building. Rationale for not doing it (4.0.49) is recorded: wiring its relative form reintroduces a fragment
  round-trip carrier.
- **The structural seam's 95 unguarded slots across 48 files** — the compiler is the worklist; the property holds
  only where the seam is used.
- **`gateEvidence`'s field set is still unpinned** — `writing-handoff-frontmatter.md:65` remains true even though
  the field is now real end-to-end.
- **The 4.0.8 baseline is frozen** — `peaks baseline audit` reports `consistent` while pointing at a frozen row.
- **`RUNTIME_NPM_VERSION` (0.0.21) and the internal-runtime package version are out of sync** (since 4.0.43). Note
  `sync-version.mjs` writes `RUNTIME_VERSION` in the runtime package's `src/index.ts`, not this constant.
- **`peaks-ide` audit-log assistant** (4.0.53 AC-7) — deferred, still not implemented.
- **superpowers four clauses** — still zero test coverage.
- **`fanout-mandatory.md` wording** — unpinned by any AC, though its three factual claims are currently true.

---

## 5. Method notes (carried forward, not defects)

Three habits from this session that found things nothing else found. They are listed because each one produced a
finding that had survived every test, every CI run, and every prior review.

1. **Try to make it red, then try to make it miss.** A guard proven falsifiable is not yet a guard proven adequate.
   The `package.json#files` gap was found by a THIRD mutation, after two had already reddened the guard.
2. **Recover the deleted test from git before deciding what a module meant.** Twice (`f17aa377^`, and G15's
   `release-state.test.ts`) the author's original assertions contradicted the surviving prose, and in both cases the
   test was right. A module's intent dies with its tests; half of it is recoverable from history.
3. **When a claim cites a past incident, read the incident.** A fix was once declined by citing 4.0.48 — which
   records two slices overwriting the same rid-less `.peaks/_runtime/` artifact path, not two edits to a tracked
   test file. The citation looked rigorous and was never checked.

---

## 6. 开放项:`unidentified reformatter`（2026-09-19，四次）

**现象**：每次切片提交之后，会出现一批"不该脏"的文件，内容恰好是**上一片提交过的文件里
prettier 会重写的那些**，改动**纯格式化**、语义为零。四次发生，四次的受影响集合都符合这条规律。

**已用逐字判据证明四次**：取上一片提交时的 blob，过一遍 prettier（仓库配置），
与磁盘逐字节相等 ⇒ 纯格式化，无语义改动。判据是
`.tmp/reformat-check.mjs`（未提交的临时件）。

**为什么重要**：它污染每一次提交（把不属于本片的改动夹带进去），并**连续三次导致
子代理给出错误归因** —— 有的说"另一个 slice 的"，有的说"parent 的 prettier"。
一次"不是我的"如果没被核对，就会掩盖真实改动。这是本仓库反复出现的形状。

**已经排除的假设（每一条都实测过，不是推理）**：

| 假设 | 排除方式 |
|---|---|
| 编辑时钩子 | 用 Edit 工具插 118 字符长行 → **原样存活** |
| SessionStart 钩子 | 直接跑 `peaks session primer` → 状态前后一致 |
| PreToolUse ×3 | `gate-step-08`/`gate enforce` 由 RD 查；（本会话）`peaks code auto-compact` 实测 0→0 |
| 用户级钩子 | `~/.claude/settings.json` **无 hooks 键内容** |
| ECC 插件钩子 | 只有 `.cursor/` 下的，不在本会话生效 |
| `peaks sub-agent dispatch` | 干净树上跑 → 0→0 |
| lint-staged / git stash | `git stash list` 空；提交后立刻 `git status` 为空 |

**存活的最强假设**（解释力最好，但**未证实**）：某个 agent 在会话早期对
`git diff HEAD~1 --name-only` 的结果跑了一次范围化 `prettier --write`（当作 housekeeping），
**跑完才 `git status`**，于是看见的是自己刚造成的脏，并归因给别的进程。这能同时解释
"受影响集合 = 上一片提交的文件"与"三次都归错因"。

**要最终定位它**需要什么：在某一整片期间挂一个文件系统 watcher（例如
`node --watch` 或 `fs.watch` 记录 `tests/**`、`src/**` 的写入者），或给 `prettier`
装一个 wrapper 记录调用栈。**两者都需要跨一整个子代理会话**，是独立的一片工作。

**现行缓解（已生效四次）**：每次提交前跑那套逐字判据，把重排块**显式标注在提交信息里**，
而不是默默吸收。这至少保证"夹带"是可见的、可审计的。

### 6.1 症状已被结构性压制（2026-09-24 补记）

`cf21d188`（2026-09-19，1129 文件全量格式化）之后，本仓库**每个文件都已是 prettier-clean**，
而这个性质被**棘轮**钉住：`.peaks/lint/gate-baseline.json` 的 `prettierUnformatted: 0`
（2026-09-22 生成；同表还有 `eslintFindings: 2878`、`eslintErrors: 1032`、`tscErrors: 0`）。于是——

> 一个「纯格式化」的改写者，现在**跑完什么都不会改**。

§6 的现象（"出现一批不该脏的文件，内容恰好是 prettier 会重写的那些"）因此**无法再产生脏**：
已经没有剩余的可改写内容。旁证一致：`cf21d188` 之后的 25 个提交里**没有一个**带 §6 要求的那种
重排标注，该现象也未再出现。

**这对"要不要花一整片去定位它"是决定性的**：症状已消失且被棘轮守住，于是那一整片工作的收益
从"止住污染"降级为"好奇心"。

**但两条限制必须写明**：

1. "25 个提交没复发"是**弱证据**——§6 的缓解是人工的（提交前跑判据、显式标注），没人跑就没人记。
   真正的证据是 `prettierUnformatted: 0` 这条**结构性**论证。
2. **责任者仍未定位。** 症状被压制 ≠ 那个 agent 不再做别的事。判据：若某天
   `prettierUnformatted` 从 0 上升到 1，§6 的定位工作**立刻**重新变成高优先级——那一刻正是它
   重新有信号的时刻。

### 6.2 一个已命名、已修的同类机制（不要与 §6 混淆）

`scripts/sync-version.mjs` 曾用 `JSON.stringify` 发射版本字面量（**双引号**），而仓库 prettier 配置
是 `singleQuote: true`（`package.json#prettier`）。该脚本挂在 `build` / `prepublish` / `predev` /
`pretest` / `test:ci` 上，所以**每一次构建都弄脏一个 tracked 文件**——§2.9 与 §6 说的"不该脏"有它一份。

**已修**（slice S5a，2026-09-19）：现在发射单引号字面量，且版本号无法写成单引号字面量时**抛错**
而不是转义（转义等于静默产出坏源码）。见 `cf21d188` 提交信息里的 blocker (i)。

注意它是**两个文件**（`packages/peaks-loop-shared/src/version.ts` 与 internal-runtime 的
`RUNTIME_VERSION`），而 §6 描述的是**一批**文件——所以它是同类机制，不是 §6 的答案。§6 的
批量成因仍未定位，只是已无症状。
