---
name: 2026-07-27-rid-016-monorepo-delete-5-subpackages
description: rid-016 collapses 5 pure-internal sub-packages (peaks-loop-{job-snapshot,doctor,crystallization,final-review,audit-independent}) into src/services/*; surfaces worktree-only artifact fragility, Zod-narrowed negative-test cast pattern, peaks-job-checkpoint sliceId convention.
kind: project
---

# rid-016 — monorepo delete 5 sub-packages + fold into src/services/* (2026-07-27)

## What changed
- Deleted 5 pure-internal sub-packages from the workspace: `packages/peaks-loop-job-snapshot/`, `packages/peaks-loop-doctor/`, `packages/peaks-loop-crystallization/`, `packages/peaks-loop-final-review/`, `packages/peaks-loop-audit-independent/`. Each subpackage contributed `package.json` + `tsconfig.json` + `vitest.config.ts` + `CHANGELOG.md` + an `src/index.ts` re-export barrel.
- Folded each subpackage's `src/services/<name>/<service>.ts` body into the matching `src/services/<name>/<service>.ts` location in the root package. The 5 service barrels now live under `src/services/{audit-independent,crystallization,doctor,final-review,job-snapshot}/index.ts`.
- Repointed every cross-package import site (CLI commands under `src/cli/commands/{asset,perf-audit,security-audit,openspec,core/{doctor,skill}}-commands.ts`) from `@peaks-loop-<name>/services/<x>` (workspace alias) to `../services/<name>/<x>.js` (relative within the root package).
- Removed the corresponding entries from `pnpm-lock.yaml` `packages/peaks-loop-*` block and from `scripts/sync-global-peaks.mjs`'s package discovery list.
- Workspace is now reduced to **3 publishable sub-packages**: `peaks-loop-shared`, `peaks-loop-shared-channel`, `peaks-loop-mut`. Everything else is inlined into the root package and is no longer a separate npm artifact.
- 96 files touched, +188/-1677 net (most of the negative line count came from deleted subpackage boilerplate: 5× `package.json`, 5× `tsconfig.json`, 5× `vitest.config.ts`, 5× `CHANGELOG.md`, plus re-export barrel bodies).
- Single atomic commit `c56fdf32` — SquabbyZ sole-author, no `Co-Authored-By` trailer (per project red rule).

## Why
- 5 of the 8 workspace sub-packages were purely internal: they had no public npm consumers, their only consumer was the root `peaks-loop` package, and they existed only because of historical package-per-domain authoring convention.
- Each internal subpackage added maintenance tax: 5× `package.json` version drift, 5× `tsconfig` extends chains, 5× `vitest` config files in `pnpm -r test`, 5× `CHANGELOG.md` ceremony, and a per-subpackage `npm pack` entry the release flow had to skip. `bump-version.mjs` (rid-015) had just been widened to keep all 8 in lockstep, but the underlying defect — that 7 of the 8 were never independently released — was structural, not scriptable.
- The follow-up note recorded against [[2026-07-27-rid-015-monorepo-version-sync]] called this out explicitly: "5 个纯内部子包…删除". This slice closes that follow-up.

## Validation
- AC-1..AC-8 PASS. The full QA log lives at `.peaks/_runtime/2026-07-27-session-507e95/qa/requests/rid-016.md`; the re-verify log (cycle 2) at `rid-016-reverify-cycle-2.md`.
- All cross-package import sites re-resolve via `pnpm exec tsc --noEmit -p tsconfig.json` (clean).
- Targeted unit suite: `pnpm exec vitest run tests/unit/services/{audit-independent,crystallization,doctor,final-review,job-snapshot}/` — all 5 service barrels green.
- Full release suite: `pnpm exec vitest run tests/unit/release/` — 76/76 PASS (no regression from rid-015 baseline).
- Adjacent regression: `tests/unit/qa/screenshot-archive-service.test.ts` — 8/8 PASS (same fix as rid-015).
- `peaks skill presence --json` returns the same skill set as before the refactor (the 5 deleted subpackages were not registered as skills; only the CLI entry points registered against them).
- 0 changes to `publish.yml`; the publish flow's `pnpm -r --filter './packages/*' publish` now walks 3 manifests instead of 8.

## Sediment lessons

### Lesson 1 — Worktree-only artifact fragility

The biggest operational lesson of rid-016: when a sub-agent dispatch uses `--project .claude/worktrees/...`, the artifacts it writes (PRD/RD/QA/SC markdown) land in the **worktree's** `.peaks/_runtime/.../<role>/requests/`, NOT in `main`'s `.peaks/_runtime/...`. The main CLI registry therefore cannot see the artifact; `peaks request show` returns `REQUEST_NOT_FOUND`; `peaks request transition` may fail with `PREREQUISITES_MISSING`.

In this slice, the worktree `agent-rid-016-rebuild` was pruned between turns (unknown external trigger; possibly a peaks-hooks install on a different session, or `git worktree prune` driven by an unattended hook). All worktree-only artifacts were lost. Main's `.peaks/_runtime/...` had its own copies from the prior orchestrator step (a `cp` had landed the RD body into `002-rid-016.md`), which is why the slice could continue.

**Mitigation**: every sub-agent dispatch that intends the artifact to be QA/SC-visible MUST use `--project .` (the main workdir) OR explicitly copy the artifact to `main`'s `.peaks/_runtime/...` after writing. The dispatch contract should document this; until then, the orchestrator must post-verify each artifact's location.

### Lesson 2 — Zod-narrowed negative tests need `as unknown as <Type>`

`CrystallizationTaskState` is `z.infer` over `z.literal("completed")` / `z.literal(true)` / `z.literal(true)`. A test that intentionally feeds the service `task_status: "running"` / `has_evidence: false` / `evidence_collected: false` to assert the negative path is **runtime-correct** (Zod parse catches the bad input) but `tsc --noEmit` rejects it with TS2322.

**Fix:** cast at the object-literal construction site:
```ts
{
  task_status: 'running',
  gates_passed: false,
  evidence_collected: false,
} as unknown as CrystallizationTaskState;
```

This matches the existing negative-test convention used elsewhere in the repo for Zod-narrowed types. **Do NOT** widen the type itself (Option B) — that weakens the contract for downstream callers and may silently bypass the runtime Zod check. **Do NOT** drop the test (Option C) — the gate is the entire point of the negative test.

### Lesson 3 — `peaks job checkpoint --slice-id` takes the sliceId, not the rid label

The `state.json` `slices[].sliceId` field is what the CLI expects (e.g. `slice-001`, `slice-002`), NOT the user-facing rid (`rid-015`, `rid-016`). Calling `peaks job checkpoint --slice-id rid-015` would be rejected (or matched against a nonexistent sliceId). The convention is established by `peaks job init`; the runbook should record it explicitly.

### Lesson 4 — Single-commit, file-level DAG collapse

The 96-file refactor was already implemented in a single stash commit (`bd92cce74ebae34e333b50540c49f157f6d3b9f3`). That collapsed the slice DAG from 4 topological levels (worktree → rename → re-point → validate → commit) to a 2-level validation flow (Level 0 pop, Level 1 AC sweep, Level 2 commit). This is the Karpathy "Simplicity First" win: when the WIP is already shaped, the plan reduces to verify-then-land.

### Lesson 5 — PR-flow single sub-agent dispatch chain

The PR/QA/repair cycle for this slice took 6 sub-agent dispatches (prd → rd → lint-fix → qa-cycle-1 → rd-patch → qa-cycle-2 → sc) and 1 checkpoint call. The slice had no openspec proposal and no `.openspec/` validation (refactor-mode slices skip OpenSpec per `peaks-rd/references/refactor-workflow.md`).

## Commits
- `57304006 docs(memory): index rid-016 forward reference under rid-015 outstanding follow-up`
- `c56fdf32 refactor(monorepo): delete 5 pure-internal sub-packages — fold into src/services/* (rid-016)`

## Outstanding follow-up
- rid-017: publish.yml sequencing (changelog / README / GitHub Release / tag BEFORE `release-pack.mjs`).
- rid-018: 4.0.0 release as an independent session after rid-017.
- The dispatch contract should document Lesson 1 (worktree-only artifact fragility) so future sub-agent slices don't lose artifacts to worktree pruning.

<!-- peaks-memory:start -->
Related memories: [[2026-07-27-rid-015-monorepo-version-sync]] (forward reference for rid-016), [[2026-07-27-worktree-user-auth-hard-gate]] (worktree auth hard gate — companion rule that complements Lesson 1 by requiring explicit user authorization for worktree sub-agent dispatch).
<!-- peaks-memory:end -->