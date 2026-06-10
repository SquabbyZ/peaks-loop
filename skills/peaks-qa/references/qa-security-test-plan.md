# Security test plan (project-level, slice 025)

> Body of `## Security test plan`. Slice 025 introduces a project-level
> security test plan that is **stable across slices within a session**
> and is refreshed only when a slice's diff matches the trigger table.
> The per-slice `qa/security-findings-<rid>.md` references this plan by
> path + hash; the plan itself is NOT regenerated per slice.

## Location

`.peaks/_runtime/<sessionId>/qa/security-test-plan.md`. The CLI is
`peaks workflow plan read security --project <repo> --json` /
`peaks workflow plan refresh security --project <repo> --apply` /
`peaks workflow plan detect-trigger --project <repo> --rid <rid> --json`.

## Generation workflow

1. `peaks workflow plan read security --project <repo> --json` — return
   the existing plan envelope (exists, path, hash, refreshedAt). When
   the plan does not exist, the slice workflow proceeds to step 2.
2. `peaks workflow plan detect-trigger --rid <rid> --project <repo> --json`
   — return `{ triggered, reason }` based on the trigger table below.
3. If `triggered: true`, run
   `peaks workflow plan refresh security --project <repo> --apply --json`
   — atomic write; the response carries the new hash + refreshedAt.
4. The slice's `qa/security-findings-<rid>.md` opens with the
   `## Plan reference` block: `plan-hash: <hash>`, `plan-path: <path>`,
   `unchanged-since: <prev-rid> | new`.
5. Re-read with `peaks workflow plan read security` to confirm the
   post-write envelope matches the value embedded in the slice result.

## Content schema (deterministic — body is normalized before hashing)

- `## Threat Model` — fixed narrative. Auth boundary, secret storage,
  external API surface, file system writes.
- `## Sensitive Service Files` — auto-enumerated from
  `src/services/{auth,security,secrets,payments,filesystem}/`. Empty
  buckets render as `- (none)`. Files sorted alphabetically.
- `## Auth Surface (*auth*.ts files repo-wide)` — auto-enumerated.
- `## Runtime Dependencies` — split into `dependencies` and
  `optionalDependencies` (per locked decision 1, `devDependencies` are
  **excluded** from the trigger scan and from the plan body).
- `## Test Matrix` — fixed narrative. Points the slice workflow at
  peaks-qa's per-slice diff scan.

## Refresh trigger table (locked decision 1)

| Signal | Reason string | Re-generates the plan? |
|---|---|---|
| New dep in `dependencies` / `optionalDependencies` | `new-dependency` | yes |
| New file under `src/services/{auth,security,secrets,payments,filesystem}/` | `auth-surface-added` | yes |
| New `*auth*.ts` file anywhere in `src/` | `auth-surface-added` | yes |
| New route / command registration (`router.ts`, `commands/*-commands.ts`) | `hot-path-added` | yes |
| `--refresh` on the slice workflow | `manual-override` | yes |
| devDependencies change only | (none) | no — locked Q1 default |
| Pure text edits to `rd/*` or `qa/test-cases/*` | (none) | no |

## Back-compat (1 minor release)

The pre-slice-025 non-suffixed `qa/security-findings.md` is still
accepted by `peaks workflow verify-pipeline` Gate C during the
1-minor-release window. The path resolver
(`src/services/workflow/artifact-paths.ts`) handles the fallback and
emits a `legacy-redirect` warning in the gate's violation list. The
form is rejected after the next minor bump.

## CLI surface recap

| Command | Returns | JSON shape |
|---|---|---|
| `peaks workflow plan read security --project <repo>` | `exists`, `path`, `hash`, `refreshedAt`, `source` | `{ ok, command, data: { ... } }` |
| `peaks workflow plan refresh security --project <repo> [--apply]` | `writtenFiles`, `wouldWrite`, `hash`, `refreshedAt`, `dryRun` | `{ ok, command, data: { ... } }` |
| `peaks workflow plan detect-trigger --project <repo> --rid <rid> [--refresh]` | `triggered`, `reason` | `{ ok, command, data: { ... } }` |
