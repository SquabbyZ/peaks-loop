# RD Tech-Doc: 2026-06-04-workflow-resilience / Slice 1 (W2)

- session: 2026-06-04-session-ec7f95
- rid: 2026-06-04-workflow-resilience
- slice: 1 (chore, type-corrected retroactively to "config" per `peaks scan request-type-sanity`)
- author: peaks-rd (sub-agent)
- date: 2026-06-04

## Goals

Make `peaks --version` (and any code importing `CLI_VERSION` from `src/shared/version.ts`) always in sync with `package.json` `version` by promoting `scripts/sync-version.mjs` to a `pre*` hook that fires before `dev`, `test`, and `publish` invocations.

## Non-goals

- No source-code change to `scripts/sync-version.mjs` itself.
- No new top-level dependency.
- No new CLI command.
- No version bump in this slice (the prior slice bumped 1.2.8 → 1.2.9).
- No change to `prepack` (already chains through `npm run build` which already runs sync-version).

## Red-line scope

**In-scope (only these):**
- `package.json` — add 3 new keys to `scripts`: `predev`, `pretest`, `prepublish`. Each body: `"node ./scripts/sync-version.mjs"`.

**Out-of-scope:**
- `package.json` `version`, `dependencies`, `devDependencies`, `bin`, `files`, `engines`, `name`, all other `scripts` keys.
- Slice 2 (W3 + W4) — separate slice.

## Implementation plan

1. Read `package.json` to confirm current `scripts` block.
2. Insert 3 new keys: `predev`, `pretest`, `prepublish` at their alphabetically-conventional positions inside the `scripts` object. Each body: `"node ./scripts/sync-version.mjs"`.
3. Do not modify any other field.

## Test plan

- `pnpm test` must pass with no new failures vs the documented pre-existing baseline (7 Windows-specific failures in `tests/unit/config-safety-canonical-root.test.ts` and `tests/unit/statusline-settings-service.test.ts`).
- `pnpm typecheck` must remain clean.
- `cat src/shared/version.ts` after any `pre*` hook fires must show `export const CLI_VERSION = "1.2.9";` (the current `package.json` `version`).
- Idempotence: running `node ./scripts/sync-version.mjs` twice produces no diff on the second invocation (already true; back-stop).

## Rollback

Single commit. `git revert 5f30353` removes the 3 hooks. No data loss.

## Commit boundary

One commit, scoped to `package.json`. Commit: `5f30353 chore(build): auto-sync CLI version in predev/pretest/prepublish hooks`.

## Implementation evidence

### Diff (1 file, +3 / -0)

```
$ git show 5f30353 --stat
 package.json | 3 +++
 1 file changed, 3 insertions(+)
```

### Validation

- `pnpm test` → 1809 pass / 7 pre-existing Windows-specific failures / 9 skip. **No new failures introduced.**
- `pnpm typecheck` → clean.
- `cat src/shared/version.ts` after `pnpm test` → `export const CLI_VERSION = "1.2.9";` (already correct because the prior slice's commit `69cc1f7` amended-in the regenerated file).

### Back-stops

- `peaks scan request-type-sanity --type chore --json` returned `consistent: false` (scanner classified the diff as `config`, not `chore` — see security-review.md for the type-classification lesson).
- `peaks skill runbook peaks-solo --json` still reports `peaksCommandCount: 31` (no new command added in this slice).

### Commit

- `5f30353 chore(build): auto-sync CLI version in predev/pretest/prepublish hooks`
