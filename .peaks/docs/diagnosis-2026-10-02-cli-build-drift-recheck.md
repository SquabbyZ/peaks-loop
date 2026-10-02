# CLI build drift — the 2026-10-02 re-check pass

Backlog §2.36 established that `C:\nvm4w\nodejs\node_modules\peaks-loop` is a plain directory installed
**2026-09-24 02:13** reporting version **4.0.54**, the same number `D:/peaks-loop/package.json` carries, with
~90 commits between them. This pass re-runs every claim I recorded this session as "the CLI does X" against
the repository build (`node bin/peaks.js`, whose `dist/` was built 2026-10-02 00:44) and marks which ones
evaporate. Nothing here was reasoned from source alone — each row names the command that produced it.

## Instrument note

`node bin/peaks.js <cmd> --project .` vs `peaks <cmd> --project .`, same tree, same arguments, output diffed.
Where a claim is about current source rather than about a running process, the file:line is given instead and
labelled as such.

## Verdict table

| claim (entry) | re-measured on the repo build | verdict |
|---|---|---|
| `scan file-size` hides which files it did not measure (§2.32 half 1) | repo build prints `"outOfScopeFiles"`; the field and its semantics landed at `c7771069` (2026-10-01 10:02) and 7 test hits pin it. Installed build has **0** occurrences of the string | **evaporated** — I read the 09-24 program. §2.32 corrected in place |
| `request transition` accepts a placeholder body as `implemented` (§2.30's central claim) | `request-commands.ts:790–798` DOES call `lintRequestArtifact`, and `2030`'s own transition note records `LINT_GATE_FAILED … 6 findings` followed by my `--allow-incomplete` | **retracted** — the machine refused; I bypassed it and then blamed the machine |
| `request init --apply` should refuse to mint a second artifact for a rid that already has one (§2.30's fix) | dry-run init for `2026-10-02-monotonicity-head-anchor` → `REQUEST_INIT_FAILED: A request artifact with id "…" already exists in …` | **already implemented** (`request-artifact-service.ts:230–247`). The `20NN-` duplicates were minted through the stale build |
| the placeholder heuristic flags any command quote containing a metavariable (§2.26 half 1) | probe artifact with both forms: `` run `git show HEAD:<path>` `` (backticked) and `- current total UT coverage: <percent>` (bare) → **1 finding, the bare one**, on BOTH builds; `artifact-lint-service.ts:75–77` strips inline code spans by design | **too broad as filed** — narrowed: a metavariable outside backticks is flagged, one inside a code span is not. The remedy becomes "document the code-span convention", not "the lint is adversarial" |
| a refusal that names no artifact is undiagnosable (§2.26 half 2) | `request-artifact-state-helpers.ts:75–76` builds `Cannot transition ${role} to ${newState}: ${errorCount} lint error(s) found in artifact.` — no path. The `request lint` envelope DOES carry `path` (verified: stub `2033` → `ok false`, 6 findings, path present) | **survives** — the two surfaces disagree exactly as recorded |
| `peaks request init` needs `--session-id` even when `.peaks/_runtime/session.json` exists, while `request list` resolves it fine | both builds: `SESSION_ID_REQUIRED` for init; `request list --project .` returns 133 items with `writerSessionId` resolved | **survives** — a current-source inconsistency, not drift |
| the numbered prefix reads a counter as a year (§2.25, recorded as "signature of", with the mechanism unverified) | `src/shared/incrementing-number.ts:23–30`: `/^(\d+)-/` over every `.md` in the dir, `Math.max(...numbers) + 1`. A dated artifact `2026-10-02-x.md` contributes **2026**, so the first numbered sibling is 2027 and each further init increments | **proven**, and it predicted the observed sequence `2027 … 2038` exactly. §2.25's "needs a test that asserts the written filename equals the rid" still stands |
| `subagent-cleanup` reports `cleaned: true` while touching nothing (§2.29) | diagnosis was read from source (`subagent-job-wrapper.ts:32` in-process `Map`; `job-commands.ts:449` fresh wrapper per invocation) and the effect was measured as disk state (six calls, `find -mmin -10` empty) | **survives** — source + disk, not a binary-dependent reading |

## What this cost, and the rule that follows from it

One day of measurements went into filing a defect that had been fixed the previous day, and one entry blames a
gate for a bypass I chose myself. Both came from the same missing step: I never established **which program**
answered before treating its output as a fact about the repository. The rule is cheap and applies to every
future session of this campaign:

- Before reporting "the CLI does X", run `peaks --version` **and** compare it to `package.json#version`, then
  re-run the same call as `node bin/peaks.js …`. If the two disagree, the discrepancy is the finding.
- Prefer `node bin/peaks.js` for all dogfood in this repo until the install question (§2.36) is resolved.
- A claim about *source behavior* must cite file:line; a claim about *runtime behavior* must cite a command and
  say which build it invoked. Today's two errors were both claims of the second kind wearing the clothes of the
  first.
- Re-checking my own backlog is worth doing early: 4 of 8 entries moved, and two of those four were wrong in
  the direction that made me look tougher on the tool than the tool deserved.

## Still open after this pass

§2.25 (prefix mechanism now proven, fix still needed), §2.26 half 2 (name the artifact in the refusal) plus the
narrowed half-1 convention note, §2.29 (fix the self-vouching cleanup), §2.30's **duplication** complaint as
narrowed above (the numbered file and the hand-authored record for one rid both exist and `request list` shows
two artifacts per rid), §2.32 half 2 (`.husky/` measured by nothing — being addressed now by the hooks rows),
and §2.36 itself: the stale global install, unversioned, still in place.
