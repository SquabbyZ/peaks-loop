---
name: 2026-09-30-a-guard-that-counts-a-directory-silently-blames-the-registry
description: A split placed a hoisted helper INSIDE `src/services/doctor/doctor-service/checks/`, whose file count J11 asserts equals the plugin registry length — the guard then reported "the registry missed a plugin" for two days. Directory membership, not file identity, was the contract. Caught only by `pnpm test:integration`, run for the first time in this campaign.
kind: feedback
---

**What happened.** During the `strict-remediation-abc` line-cap campaign, commit `108ebcea` (2026-09-29)
shortened `src/services/doctor/doctor-service/checks/multi-binary-drift.ts` by hoisting its pure helpers into
a sibling — placed in the **same directory**, which is the natural spot for a file that only that check uses.
`src/services/capability-guard-runner/contracts/J11.ts:56-59` does `readdirSync(checks).filter(f => f.endsWith('.ts'))`
and `:88-91` asserts that count equals `PLUGINS.length`. The move took the census to **23 files / 22 plugins**,
so the guard's detail read "the plugin registry enumerates every check module (22 plugins / 23 checks)" — a
sentence that blames the registry for a missing plugin when the truth is an extra file in a counted dir.

**Why nothing caught it.** The whole-repo lint gate, `tsc`, prettier and the 326-file unit suite all stayed
green, because the assertion lives in the **integration** config (`vitest.config.integration.ts`,
`tests/integration/capability-guard/J11-doctor-cli-snapshot.test.ts`) and the campaign had never run
`pnpm test:integration`. It surfaced on 2026-09-30 when integration ran for the first time: 1 failed /
471 passed. The fix (`5ed275fe`) moved the helper one level UP, byte-identical, and updated the two
specifiers to `../multi-binary-drift-helpers.js`.

**How to apply.**

1. **Before creating a sibling, ask whether its directory is READ, not just referenced.** The campaign had
   catalogued guards keyed by file PATH and by SYMBOL text; a guard keyed by **directory membership / file
   count** is a different shape and none of those greps find it. `grep -rn "readdirSync" src/` for the
   directory's ancestors, and check for an assertion comparing a length. J11's own doc comment now records
   that the checks directory is counted.
2. **A split's review surface is "which lines are not in HEAD", and the cheapest way to get that is a
   line multiset**: strip comments, normalise whitespace, count HEAD's code lines, then report both the
   new-tree orphans (added structure) and the HEAD leftovers (deleted behaviour). It found wave 3's declared
   deviation (`const now = Date.now();` at HEAD:351, provably unread) and, on wave 4's ten files, surfaced
   exactly the shape-changing lines (prettier re-wraps, `continue` → `return null` at a new helper boundary).
   It is a review aid, not a gate: it cannot see a re-ordering that keeps every line.
3. **Integration belongs in the convergence checklist of any slice that moves files**, not just slices that
   change behaviour. `dist/` must be rebuilt for it (its preflight refuses a stale `dist/`), which is why
   it had been skipped; that skip is what let a red guard live for two days.
4. **A leaf's "no findings rise" claim does not cover a neighbour file.** Wave 3B: five leaves each reported
   clean while the repo total went 2871 → 2875 (a shared `types.ts` gained 7 `no-unused-vars` from
   import-for-re-export). The orchestrator's recount at quiescence is the only number that is a verdict.

Related: [[five-leaves-per-file-no-finding-rise-summed-to-a-repo-wide-rise-of-four]],
[[a-guard-keyed-on-a-file-path-shrinks-silently-when-you-split-that-file]],
[[2026-09-30-four-host-bugchecks-from-overlapping-verification-runs]].
