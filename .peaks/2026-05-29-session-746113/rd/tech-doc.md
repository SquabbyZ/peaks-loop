# Tech-doc — RD 2026-06-02-sop-global-reuse-ux-v2

> Generated 2026-06-01. Linked from RD artifact.
> Scope: a single CLI default-value change + one new unit test.

## Architecture decisions

**One-line change, no new abstractions.** The user-facing behavior ("`peaks sop registry` should default `--project` to the current directory so it merges the repo layer by default, matching `sop check` / `sop advance` / `gate enforce`") is purely a default-value change in the existing `.option(...)` declaration. No new helpers, no new services, no new modules.

**Why a single default change rather than a "smart cwd resolver" service.** PRD non-goal N5 explicitly forbids "silently fall back to cwd" — when the user really is in a non-project directory, the right behavior is `MISSING_PROJECT_ROOT` (or, for the registry command, an empty registry view that says "no project layer to merge"). The existing `readRegistry(projectRoot?)` already handles "no project layer" gracefully (returns the global-only view), so the default-cwd change composes without new code.

**Why the implementation cost is one line + one test.** All four PRD goals (G4 `absent`, G5 phase-skip, G6 `nextActions`, G7 cwd default for execution commands) except `sop registry`'s default are already shipped. The pipeline is "complete the only remaining gap, prove it with a test, hand off."

## Component changes

| File | Role | Why |
|------|------|-----|
| `src/cli/commands/sop-commands.ts` (line 188) | modify: add `defaultValue: '.'` to `sop registry --project` | G7 — make `peaks sop registry` merge the project layer by default when run from a repo root. |
| `tests/unit/sop-commands.test.ts` | modify: add one test | G7 AC6 — `sop registry` (no `--project`) in a directory with `<cwd>/.peaks/sops/` returns the merged view; without a project layer returns global-only and is non-fatal. |

**No new files. No deletions. No package.json changes. No OpenSpec change.** Verified with `ls` for every path above (Gate A2).

## Data flow

`peaks sop registry` (no flags) →
  `sop-commands.ts:191` calls `readRegistry(options.project)` →
  with `--project` defaulting to `.`, that becomes `readRegistry(process.cwd() || '.')` →
  `sop-registry-service.ts:73` reads global `<peaksHome>/sops/registry.json` and (if `projectRoot` set) merges `<projectRoot>/.peaks/sops/registry.json` →
  prints merged view as `{ok, command: 'sop.registry', data, warnings, nextActions}`.

For non-project cwd, `readRegistry('.')` still returns the global registry (project file simply doesn't exist). No throw, no false `MISSING_PROJECT_ROOT`. The error path is only relevant for `sop check` / `sop advance`, where a `GateCheckError` already surfaces "no SOP found for id …" if the user's id is missing.

## CSS / style changes

None. CLI only.

## API contract changes

- `peaks sop registry` flag set: `--project [path]` (was optional; now defaults to `.`).
- `peaks sop registry --help`: shows `[default: <cwd>]` suffix on the `--project` line (Commander's standard behavior once a default is supplied).
- No new exit codes, no new error envelopes, no new top-level fields.

## Dependencies

None. No `package.json` changes. No `node_modules` touch.

## File verification (Gate A2 evidence)

```
$ ls src/cli/commands/sop-commands.ts tests/unit/sop-commands.test.ts
src/cli/commands/sop-commands.ts
tests/unit/sop-commands.test.ts
```

Both paths exist. No "No such file" errors.
