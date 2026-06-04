# RD Tech-Doc: Monorepo discovery for `peaks scan libraries`

- session: 2026-06-04-session-cda1cd
- rid: 2026-06-04-monorepo-and-release
- slice: A
- type: feature
- author: peaks-rd (sub-agent)
- date: 2026-06-04

## Goals

Make `peaks scan libraries` enumerate dependencies across pnpm / npm / yarn workspaces (monorepo) so that `peaks-rd` preflight and any downstream `## Library versions` consumer see the full surface, not just the root `package.json`.

Single-package projects must produce a byte-identical report (with an additive empty `workspaces: []` field, or — preferred — the field is present and empty so consumers can rely on the shape).

## Non-goals

- No breaking change to the `LibraryReport` JSON envelope (additive fields only).
- No new CLI command (skill-first / CLI-auxiliary rule preserved).
- No npm / yarn / pnpm runtime API calls — pure filesystem reads of `package.json`, `pnpm-workspace.yaml`, `lerna.json`.
- No deep `**` glob support beyond two segments (e.g. `packages/hermes-agent/*` is supported, `packages/**/sub/*` is not).
- No new top-level dependencies (hand-rolled glob matcher).

## Red-line scope

**In-scope (only these):**
- `src/services/scan/libraries-service.ts` — add monorepo detection + per-workspace scanning.
- `src/services/scan/libraries-types.ts` — add additive `workspaces` field to `LibraryReport`.
- `tests/unit/scan-libraries-service.test.ts` — add monorepo test cases.

**Out-of-scope (do not touch):**
- `peaks-solo` SKILL.md or any other skill file.
- `schemas/library-breaking-changes.*` (curated table, hand-maintained).
- `src/cli/index.ts` and the `scan libraries` command wiring (no CLI change).
- `package.json` version field (slice B owns this).
- `README.md` (slice B owns this).
- `.peaks/.active-skill.json`, `.peaks/.session.json`.

## Implementation plan

### 1. Glob matcher (hand-rolled, no new deps)

Implement a small matcher `expandWorkspaceGlobs(root, globs)` that:
- Splits each glob on `/` and treats each segment as either a literal (`packages`) or a single-level wildcard (`*`).
- Resolves the literal parent directories, reads one level of entries from disk, and for `*` accepts any subdirectory whose `package.json` exists.
- Limits recursion to two glob segments (`packages/*` or `packages/hermes-agent/*`); deeper patterns are silently dropped and produce a warning.
- Returns absolute paths to the discovered `package.json` files.
- Deduplicates results (a `package.json` matching two globs is counted once).

### 2. Monorepo detection order

Check in this order; the first hit wins:
1. `<root>/pnpm-workspace.yaml` — parse top-level `packages:` list (a YAML scalar list).
2. `<root>/package.json` — if a `workspaces` field exists:
   - If it's an array, treat each entry as a glob (npm workspaces).
   - If it's an object, treat `.packages` as a glob list (yarn classic).
3. `<root>/lerna.json` — read `packages` field (array of globs).
4. None of the above → single-package mode, behavior unchanged.

Precedence rationale: matches the issue file's discovery order and avoids double-counting when a repo has both `pnpm-workspace.yaml` and a `workspaces` field in `package.json` (pnpm-wins).

### 3. Per-workspace scan

Reuse the existing parse loop (read `package.json` → iterate `SCOPES` → push `LibraryEntry`). Apply the same root scan logic to every discovered workspace `package.json`. Aggregates:
- `libraries[]`, `totalCount`, `byScope` — concatenated across all workspaces.
- `workspaces[]` — new additive field: `{ path: string; count: number; name?: string; version?: string }[]`.
- `warnings[]` — preserve existing semantics; new warnings only on glob-resolution anomalies.

### 4. YAML parsing for pnpm-workspace.yaml

Hand-rolled line-based parser that:
- Strips comments (`#…`) and blank lines.
- Recognizes a top-level `packages:` key followed by indented `- '...'` or `- "..."` or `- bare` items.
- Ignores all other keys (`allowBuilds:`, etc.) — only the `packages:` list is consumed.
- Failure modes (file present but malformed, or `packages:` absent) fall through to the next detection source.

## Test plan

Unit tests added in `tests/unit/scan-libraries-service.test.ts`:

1. `discovers and scans sub-packages declared in pnpm-workspace.yaml globs`
   - Temp dir: `pnpm-workspace.yaml` with `packages: ['packages/*']` + 3 sub-package `package.json` files.
   - Assert: `workspaces.length === 3`, `totalCount` aggregates across them, each `path` field is the absolute `package.json` path, each `count` matches that sub-package's deps count.
2. `discovers and scans sub-packages declared in npm workspaces field`
   - Temp dir: root `package.json` with `workspaces: ['packages/*']` + 2 sub-packages.
3. `discovers and scans sub-packages declared in yarn workspaces field`
   - Temp dir: root `package.json` with `workspaces: { packages: ['packages/*'] }` + 2 sub-packages.
4. `handles nested workspace globs (e.g. packages/hermes-agent/*)`
   - Temp dir: `pnpm-workspace.yaml` with `packages: ['packages/*', 'packages/hermes-agent/*']` — assert nested ones are discovered.
5. `prefers pnpm-workspace.yaml over npm workspaces field when both present`
   - Temp dir: both pnpm-workspace.yaml (2 entries) and `package.json` with `workspaces: ['apps/*']` (1 entry) — assert pnpm-wins.
6. `returns workspaces: [] for single-package projects (byte-identical to today)`
   - Temp dir: only a root `package.json` with deps; assert `workspaces: []`, `libraries[]` unchanged.
7. `aggregates totalCount and byScope across all workspaces by default`
   - 2 sub-packages, each with `dependencies: { foo: 1 }` and `devDependencies: { bar: 1 }`; assert `totalCount: 4`, `byScope` sums to 4.

Integration dogfood (PRD acceptance):
- `pnpm exec tsx src/cli/index.ts scan libraries --project C:/Users/smallMark/Desktop/peaksclaw/ice-cola --json` returns `data.totalCount >= 200` AND `data.workspaces.length >= 6`.

## Rollback

Single slice, single commit. Revert the commit if:
- Tests fail after the change.
- Dogfood returns a lower `totalCount` than the pre-fix baseline.
- A new CRITICAL/HIGH finding is raised during code review.

`git revert <commit>` is sufficient; the additive `workspaces` field is documented as optional, so older consumers ignoring the field still work.

## Commit boundary

One commit, scoped to:
- `src/services/scan/libraries-service.ts`
- `src/services/scan/libraries-types.ts`
- `tests/unit/scan-libraries-service.test.ts`

Commit message: `feat(scan): discover monorepo packages in peaks scan libraries`

The `.peaks/2026-06-04-session-cda1cd/rd/*` artifacts are committed separately by Solo in the qa-handoff phase.

## Implementation evidence

### Diff (3 files, +548 / −41)

- `src/services/scan/libraries-service.ts` — 145 → 388 lines. New: monorepo detection, hand-rolled glob matcher, hand-rolled YAML parser, per-workspace scan loop.
- `src/services/scan/libraries-types.ts` — added `WorkspaceEntry` type and additive `workspaces` field on `LibraryReport`.
- `tests/unit/scan-libraries-service.test.ts` — 145 → 322 lines; 7 new monorepo test cases.

### Test result

```
$ pnpm vitest run tests/unit/scan-libraries-service.test.ts
 Test Files  1 passed (1)
      Tests  22 passed (22)  ← 8 parseMajorVersion + 7 single-package scanLibraries + 7 new monorepo
   Duration  373ms
```

### Typecheck result

```
$ pnpm typecheck
> peaks-cli@1.2.8 typecheck
> tsc -p tsconfig.json --noEmit
(no output — clean)
```

### Dogfood on ice-cola (PRD acceptance)

```
$ pnpm exec tsx src/cli/index.ts scan libraries \
    --project "C:/Users/smallMark/Desktop/peaksclaw/ice-cola" --json

data.totalCount:    202       (was 1 pre-fix; PRD target ≥ 200) ✓
data.workspaces:    7 entries (was 0; PRD target ≥ 6)         ✓
data.byScope:       aggregated across all workspaces
data.warnings:      []
```

The 7 workspaces correspond to: root (playwright only), `packages/admin`, `packages/client`, `packages/hermes-agent`, `packages/hermes-agent/ui-tui`, `packages/hermes-agent/web`, `packages/hermes-agent/website`, `packages/server` — exactly the 7 `package.json` files verified by `find packages -maxdepth 3 -name package.json`.

### Runbook / type-sanity back-stops

```
$ pnpm exec tsx src/cli/index.ts skill runbook peaks-solo --json
peaksCommandCount: 31   (unchanged; the new `peaks scan libraries` line was added by 4a7b0ad)

$ peaks scan request-type-sanity --type feature --json
consistent: true (no uncommitted changes against HEAD)
```

### Code review (full review in rd/code-review.md)

- 1 HIGH (nested-package discovery missing in first pass) → fixed before commit.
- 1 MEDIUM (path separator normalization on Windows) → fixed before commit.
- 6 LOW → documented in `rd/code-review.md`, not blocking.

### Security review (full review in rd/security-review.md)

- 3 LOW — all inherited from the pre-existing read-only service (symlink awareness, no path traversal protection beyond projectRoot). Out of scope for this slice; queued for a future security-hardening pass.

### Commit

```
d3e314c feat(scan): discover monorepo packages in peaks scan libraries
```
