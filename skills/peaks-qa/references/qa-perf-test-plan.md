# Performance test plan (project-level, slice 025)

> Body of `## Performance test plan`. Slice 025 introduces a
> project-level performance baseline that is **stable across slices
> within a session** and is refreshed only when a slice's diff matches
> the trigger table. The per-slice
> `qa/performance-findings-<rid>.md` references this baseline by path +
> hash.

## File location

`.peaks/_runtime/<sessionId>/qa/perf-baseline.md`. The CLI is
`peaks workflow plan read perf --project <repo> --json` /
`peaks workflow plan refresh perf --project <repo> --apply` /
`peaks workflow plan detect-trigger --project <repo> --rid <rid> --json`.

## Perf generation workflow

1. `peaks workflow plan read perf --project <repo> --json` — return the
   existing baseline envelope. When missing, proceed to step 2.
2. `peaks workflow plan detect-trigger --rid <rid> --project <repo> --json`
   — return `{ triggered, reason }`. The perf baseline is refreshed on
   the same triggers as the security plan: new dep, new route/hook
   registration, or `--refresh`.
3. If `triggered: true`, run
   `peaks workflow plan refresh perf --project <repo> --apply --json`.
4. The slice's `qa/performance-findings-<rid>.md` opens with the
   `## Plan reference` block referencing the baseline hash + path.
5. The slice result records the diff vs the baseline threshold
   (lighthouse / k6 / autocannon output) — see peaks-rd's
   `mandatory-perf-baseline.md` for the RD-side measurement workflow.

## Perf content schema (deterministic)

- `## CLI Command Inventory` — auto-enumerated from
  `src/cli/commands/*-commands.ts`. Sorted alphabetically.
- `## Routes / Hooks` — fixed narrative. CLI is a CLI tool, no HTTP.
- `## Baseline Measurements` — placeholder table; the RD fills the
  actual numbers (CLI does not call measurement tools).
- `## Thresholds` — placeholder; RD fills per-route thresholds.

## Perf refresh trigger table (shared with security plan)

| Signal | Reason string | Re-generates the baseline? |
|---|---|---|
| New dep in `dependencies` / `optionalDependencies` | `new-dependency` | yes |
| New file under `src/services/{auth,security,secrets,payments,filesystem}/` | `auth-surface-added` | yes |
| New `*auth*.ts` file anywhere in `src/` | `auth-surface-added` | yes |
| New route / command registration (`router.ts`, `commands/*-commands.ts`) | `hot-path-added` | yes |
| `--refresh` on the slice workflow | `manual-override` | yes |
| devDependencies change only | (none) | no — locked Q1 default |
| Pure text edits to `rd/*` or `qa/test-cases/*` | (none) | no |

## Perf back-compat (1 minor release)

The pre-slice-025 non-suffixed `qa/performance-findings.md` is still
accepted by `peaks workflow verify-pipeline` Gate C during the
1-minor-release window. The path resolver
(`src/services/workflow/artifact-paths.ts`) handles the fallback and
emits a `legacy-redirect` warning.

## Perf CLI surface recap

| Command | Returns | JSON shape |
|---|---|---|
| `peaks workflow plan read perf --project <repo>` | `exists`, `path`, `hash`, `refreshedAt`, `source` | `{ ok, command, data: { ... } }` |
| `peaks workflow plan refresh perf --project <repo> [--apply]` | `writtenFiles`, `wouldWrite`, `hash`, `refreshedAt`, `dryRun` | `{ ok, command, data: { ... } }` |
