# Issue 001: `peaks scan libraries` is monorepo-blind

| Field | Value |
|---|---|
| Issue ID | 001 |
| Discovered | 2026-06-04 |
| Discovered by | dogfood pass against `c:/Users/smallMark/Desktop/peaksclaw/ice-cola` |
| Reporter | peaks-solo (round-2 dogfood report) |
| Severity | HIGH |
| Affected | `peaks scan libraries` (`src/services/scan/libraries-service.ts`) |
| Status | FIXED in slice `2026-06-04-monorepo-and-release` slice A (this issue tracks the deferred upstream wording) |

## Summary

`peaks scan libraries` reads only the root `package.json` of the target project. On pnpm / npm / yarn workspaces (monorepo) projects it silently returns a partial library list — the sub-package `package.json` files are never enumerated, no warning is emitted, and downstream consumers (notably the `peaks-rd` preflight cross-check against `schemas/library-breaking-changes.data.json`) operate on a 1/220-or-worse view of the real dependency surface.

The defect was introduced in commit `ca37ae2` ("chore(service): add peaks scan libraries CLI + library breaking-changes table") on 2026-06-04 at 13:42 (+0800). The service shipped without monorepo handling; the unit tests in `tests/unit/scan-libraries-service.test.ts` cover only single-package scenarios.

## Reproduction (verbatim CLI output, ice-cola, 2026-06-04)

```bash
$ cd "c:/Users/smallMark/Desktop/peaksclaw/ice-cola"
$ find packages -maxdepth 3 -name package.json
packages/admin/package.json
packages/client/package.json
packages/hermes-agent/package.json
packages/hermes-agent/ui-tui/package.json
packages/hermes-agent/web/package.json
packages/hermes-agent/website/package.json
packages/server/package.json
# Total: 7 package.json files (root + 6 in sub-packages)

$ pnpm exec tsx "c:/Users/smallMark/Desktop/peaks-cli/src/cli/index.ts" \
    scan libraries --project "c:/Users/smallMark/Desktop/peaksclaw/ice-cola" --json
{
  "ok": true,
  "command": "scan.libraries",
  "data": {
    "projectRoot": "c:/Users/smallMark/Desktop/peaksclaw/ice-cola",
    "libraries": [
      { "name": "@playwright/test", "version": "^1.59.1", "major": 1, "scope": "devDependencies", "ecosystem": "npm" }
    ],
    "totalCount": 1,
    "byScope": { "dependencies": 0, "devDependencies": 1, "peerDependencies": 0, "optionalDependencies": 0 },
    "scannedAt": "2026-06-04T12:50:20.313Z",
    "warnings": []
  }
}
# Total: 1 library (only the root's @playwright/test).
# Expected: ~220 entries (admin 64, client 80, server 54, hermes-agent 20, plus 3 nested sub-packages).
# `warnings: []` — no signal to the user that the result is partial.
```

`grep -n "pnpm-workspace\|monorepo\|workspaces" src/services/scan/libraries-service.ts` returns zero matches (only one mention of "workspace" appears in a comment explaining why `workspace:*` parses to `null`).

## Impact

- **Direct**: `peaks-rd` preflight cross-checks `diff imports` against `schemas/library-breaking-changes.data.json` using the library list. On monorepos the cross-check is a no-op for 219/220 dependencies. Real breaking-change risks (NestJS 10, React 19, Radix UI major bumps, etc.) are silently invisible.
- **Indirect**: any `peaks-solo` workflow that runs on a monorepo writes a `.peaks/<sid>/rd/project-scan.md` with `## Library versions` containing 1 entry. Future diff-vs-baseline comparisons (planned in `peaks-solo` references) will produce empty useful signal.
- **User-facing**: zero visible error. The user assumes "no breaking changes" when in fact "we never looked at your sub-packages".
- **Cumulative**: 100% of the 23 sessions already recorded under `c:/Users/smallMark/Desktop/peaksclaw/ice-cola/.peaks/PROJECT.md` ran on the partial view. Going back to retroactively re-scan and emit lesson-kind memory is out of scope here but should be queued.

## Affected projects (currently known)

- `c:/Users/smallMark/Desktop/peaksclaw/ice-cola` (pnpm monorepo, 4 packages + 3 nested sub-packages, ~220 deps) — confirmed affected in round-2 dogfood.
- Any project the user works on that uses pnpm/npm/yarn workspaces. Per user's CLAUDE.md (peaks-current-directory-scope memory), the scope rule constrains *peaks-cli's own* changes to the current directory but does not constrain which projects `peaks scan libraries` runs against.

## Proposed fix sketch (for the implementer)

In `src/services/scan/libraries-service.ts`, before reading the root `package.json`:

1. **Discovery** — check (in order):
   - `<root>/pnpm-workspace.yaml` — parse `packages:` list, resolve each glob against the project tree.
   - `<root>/package.json` `workspaces` field — array of globs (npm) or object `{ packages: [...] }` (yarn classic).
   - `<root>/lerna.json` `packages` field.
   - If none: monorepo = false, fall through to today's single-package behavior.
2. **Glob resolution** — use a hand-rolled matcher (no new dependency) that supports the common shapes: `packages/*`, `packages/hermes-agent/*`, `apps/web`, single directory literal. Document non-support for `**` deep globs.
3. **Per-workspace reading** — for each discovered `package.json`, run the existing parse loop; merge into the report under a new `workspaces: { path, count }[]` field.
4. **Output shape** — additive only: new top-level `workspaces` field; existing `libraries[]`, `totalCount`, `byScope` either aggregate across all workspaces (default) or break out per workspace (if `--per-workspace` is added).
5. **Back-compat** — single-package projects: `workspaces: []` or omitted. Existing test fixtures in `tests/unit/scan-libraries-service.test.ts` must continue to pass byte-identical.
6. **Deprecation of the partial-warnings behavior** — when a monorepo is detected but only the root is scanned, emit `warnings: ["monorepo detected but only root package.json scanned — see issue 001"]`. (Removed once the fix lands.)

## Test plan

Unit tests to add (in `tests/unit/scan-libraries-service.test.ts`):

- `discovers and scans sub-packages declared in pnpm-workspace.yaml globs`
- `discovers and scans sub-packages declared in npm workspaces field`
- `discovers and scans sub-packages declared in yarn workspaces field`
- `handles nested workspace globs (e.g. packages/hermes-agent/*)`
- `prefers pnpm-workspace.yaml over npm workspaces field when both present`
- `returns workspaces: [] for single-package projects (byte-identical to today)`
- `aggregates totalCount and byScope across all workspaces by default`

Integration dogfood (the actual acceptance gate per the PRD):

- `pnpm exec tsx src/cli/index.ts scan libraries --project "c:/Users/smallMark/Desktop/peaksclaw/ice-cola" --json` returns `totalCount >= 200` and `workspaces.length >= 6`.
- `peaks skill runbook peaks-solo --json` still reports `peaksCommandCount: 31` (the runbook line count check is the second-level back-stop).

## References

- Discovery commit (where the defect was introduced): `ca37ae2 chore(service): add peaks scan libraries CLI + library breaking-changes table` (2026-06-04 13:42 +0800).
- Service file: `src/services/scan/libraries-service.ts` (145 lines, no monorepo handling).
- Test file: `tests/unit/scan-libraries-service.test.ts` (8 `parseMajorVersion` tests + 6 `scanLibraries` tests, all single-package).
- Schema: `schemas/library-breaking-changes.data.json` (12-library table — see commit `4386ed6`).
- Consumer: `skills/peaks-rd/SKILL.md` consumes the scan in preflight per `4a7b0ad`.
- Round-2 dogfood report (this session): see peaks-solo chat history at 2026-06-04 ~12:50.
