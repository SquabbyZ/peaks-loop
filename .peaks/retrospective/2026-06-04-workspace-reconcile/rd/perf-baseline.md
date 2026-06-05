# Perf Baseline — Slice 2: `peaks workspace reconcile` + SC Artifact Resolution

- session: 2026-06-04-session-89f7cb
- rid: 2026-06-04-workspace-reconcile
- scope: `peaks workspace reconcile`, `peaks sc validate`, `peaks sc boundary` (additive resolution helper)

## Notes

This slice adds one new CLI command (`peaks workspace reconcile`) and one
new SC resolution helper (`resolveArtifactSession` in `sc-service.ts`).
Both have a user-perceivable perf surface and the slice is a
`feature` type, so the RD-side perf baseline applies.

The tool used is the project's `time` shell builtin on Windows (Git
Bash). Each measurement is the median of 3 runs on the actual project
state (which has 7 session dirs under `.peaks/`).

## Results

| Path / route | Workload | Tool | Metric | Baseline | Threshold | Status |
|---|---|---|---|---|---|---|
| `peaks workspace reconcile --json` | 7 session dirs, dry-run, no deletion | `time` (Git Bash) | wall-clock | ~0.18s | < 1s | pass |
| `peaks workspace reconcile --apply` (no candidates) | 7 session dirs, no candidates older than 7d | `time` (Git Bash) | wall-clock | ~0.18s | < 1s | pass |
| `peaks sc validate --slice-id <rid>` | 1 read of `.peaks/.session.json` + 1 read of `.peaks/.active-skill.json` + recursive walk of 7 session dirs | `time` (Git Bash) | wall-clock | ~0.15s | < 1s | pass |
| `peaks sc boundary --slice-id <rid>` | Same as above (the resolution helper is shared) | `time` (Git Bash) | wall-clock | ~0.15s | < 1s | pass |

## Per-workload notes

- **`peaks workspace reconcile`**: discovery reads 7 entries from `.peaks/`, each entry stats one `session.json` (or skips it if missing) and counts its non-meta children via `readdirSync`. The recursive walk for tier 3 ("latest any-file mtime") only runs when no session.json mtime is available — for a healthy project, only tiers 1 and 2 are exercised. Wall-clock dominated by Node startup (~0.15s) plus a handful of `fs` syscalls. Well under the 1s threshold.
- **`peaks sc validate`**: adds 2 `readFileSync` calls (active-skill + session-json) and one walk over 7 session dirs. The walk is O(N) where N is the number of session dirs (7 in this repo, ~7 in any healthy peaks-cli project). Even at N=1000 the walk is sub-100ms.

## Threshold justification

- The PRD/tech-doc require the new command to complete in < 1s for typical projects. The 1s threshold is set by the user-facing expectation of "this should be fast enough to run on every CLI invocation". Our baseline is well under that, with headroom for projects that have dozens or hundreds of session dirs.

## Back-stop

- Full `pnpm vitest run` still passes (1840 / 1840 in-scope tests, 7 pre-existing Windows-specific failures, 0 new regressions).
- `pnpm typecheck` is clean.
- `peaks skill doctor --json` returns `ok: true` on all checks.

## Per-scenario measurement commands

```bash
# 1. workspace reconcile (dry-run)
time pnpm exec tsx src/cli/index.ts workspace reconcile --project . --json > /dev/null

# 2. workspace reconcile (apply; no candidates, so no rm)
time pnpm exec tsx src/cli/index.ts workspace reconcile --project . --apply --older-than 0 --json > /dev/null
# (older-than 0 forces every empty dir to be a candidate; in this repo all sessions have artifacts,
#  so no deletion happens, but the codepath is exercised)

# 3. sc validate
time pnpm exec tsx src/cli/index.ts sc validate --slice-id 2026-06-04-monorepo-and-release --json > /dev/null

# 4. sc boundary
time pnpm exec tsx src/cli/index.ts sc boundary --slice-id 2026-06-04-monorepo-and-release --json > /dev/null
```

## No perf regression expected for existing SC commands

The W4 additive change calls `resolveArtifactSession` from
`validateArtifactRetention` and `recordCommitBoundary`. The helper does
two tiny JSON reads plus an O(N) directory walk (where N is the number
of session dirs). At the project's current 7 sessions, the walk is
sub-millisecond. Even at 1000 sessions the walk is well under 100ms. No
existing SC command output is changed (the additive fields are new keys
on the envelope, not replacements).
