---
name: peaks-cli-version-shared-chicken-egg
description: "peaks-loop's CLI_VERSION is read via import from peaks-loop-shared; that creates a chicken-and-egg publish trap that needs bumps across peaks-loop AND peaks-loop-shared in lockstep"
metadata:
  type: feedback
---

<!-- peaks-feedback-promoted: layer=A -->

# peaks-loop CLI_VERSION shared chicken-egg (2026-07-22)

2026-07-22 04:15Z ice-cola surface check exposed a publish-level
bug in the peaks-loop 4.x monorepo. Root cause was a subtle
chicken-and-egg:

- `src/cli/program.ts` does `import { CLI_VERSION } from
  'peaks-loop-shared/version'`.
- `peaks-loop-shared/src/version.ts` is rewritten by
  `scripts/sync-version.mjs` to mirror root package.json's
  `version` field at build time.
- When `scripts/release-pack.mjs` runs `pnpm pack` for each
  workspace package, it captures the freshly-written
  `peaks-loop-shared/dist/version.js` into the peaks-loop
  tarball.
- But `peaks-loop@<ver>`'s `dependencies.peaks-loop-shared`
  is REWRITTEN to the on-disk peaks-loop-shared version at
  pack time — so peaks-loop@<new> pins peaks-loop-shared@<old>
  where <old> was the CLI_VERSION stamp at the time the FIRST
  peaks-loop-shared@<new> version was published, NOT <new>.
- Therefore after `peaks-loop@4.0.0-beta.N` lands on npm,
  `npm install peaks-loop@4.0.0-beta.N` will resolve
  peaks-loop-shared@<K> for some K ≤ N, and the resolved
  peaks-loop-shared tarball's CLI_VERSION is whatever was
  stamped at the publish time of @K — which may lag @N by
  one or two versions.

## The bootstrap trap

peaks-loop@4.0.0-beta.21 was published, but the actual
peaks-loop-shared tarball it pinned shipped
CLI_VERSION="4.0.0-beta.21" because the SYNC build had
captured "4.0.0" from a prior unrelated build (see
`.peaks/memory/peaks-release-4-0-2-published.md` for a separate
but related bug about tsc incremental cache making
sync-version.mjs's output lazy).

After fixing Bug-04, peaks-loop@4.0.0-beta.22 landed but
pinned peaks-loop-shared@0.0.15 — whose CLI_VERSION was
"4.0.0-beta.22" because that was the root version when
shared@0.0.15 was built.

peaks-loop@4.0.0-beta.23 landed but pinned shared@0.0.16 —
whose CLI_VERSION was "4.0.0-beta.22" because that was the
root version when shared@0.0.16 was built.

Only peaks-loop@4.0.0-beta.24 with peaks-loop-shared@0.0.17
landed the FULL alignment — because the bumped shared version
(0.0.16 → 0.0.17) was the FIRST new release after the root
fix that put CLI_VERSION="4.0.0-beta.24" into the shared
build.

## Why it matters

any consumer running `npm install peaks-loop@latest` will read
peaks-loop-shared's CLI_VERSION, which is always at least one
lag behind the root package's version. Without a CLI-version-
alignment workflow gate, `peaks -v` will always print a lower
number than `peaks-loop`'s own `version`.

## How to apply (fix for v4.1+)

1. Have the publish.yml workflow refuse to publish unless
   the on-disk peaks-loop-shared's CLI_VERSION equals
   package.json#version exactly. Add a pre-publish assertion
   step that does:

   ```bash
   expected=$(jq -r .version package.json)
   actual=$(grep -oE 'CLI_VERSION = "[^"]*"' packages/peaks-loop-shared/dist/version.js | head -1)
   [ "$expected" = "$actual" ] || exit 1
   ```

   This blocks any publish where the shared stamp lags.

2. Alternative: inline the CLI_VERSION into peaks-loop (drop
   the import-from-shared indirection). One fewer package
   edge case; one fewer chicken-and-egg; one fewer
   publish-order trap. Tradeoff: the shared package's "single
   source of CLI_VERSION" semantic becomes a copyright for
   peaks-loop to own the version stamp.

3. Alternative: ALWAYS bump peaks-loop-shared first when
   bumping root. The publish.yml flow already runs `pnpm run
   build` once which builds shared first; but if shared
   cache is warm, tsc will silently skip. The new
   sync-version.mjs invalidation (Bug-04 fix) helps here but
   the lockfile also needs invalidation.

Upstream documentation links (no live URLs, all npmjs.com
policies):
- https://docs.npmjs.com/policies/unpublish ("After a package
  is unpublished, you can never publish a new version at the
  same name and version")
- https://docs.npmjs.com/trusted-publishers/ (Trusted Publishing
  + OIDC scope; the npm OIDC token is publish-only, not
  unpublish)

## See also

- `.peaks/memory/peaks-release-4-0-2-published.md` — the
  Bug-04 root-cause memory that this one follows on from.
- `.peaks/memory/peaks-unpublish-4-0-0-and-4-0-2-stuck.md` —
  the follow-up memory documenting the OIDC unpublish failure
  that motivated the manual publish version dance.

---

## Surfaced automatically by sub-agent memory preflight (since 4.1.0)

For future sessions: peaks-code orchestrator's
`MemoryPreflightService` surfaces the feedback/layer-A entries (this
one is layer A) automatically into the sub-agent's system prompt on
every dispatch, with a hard 1.2k-token ceiling enforced by headroom-ai.
You do not need to navigate into this memory manually anymore — the
dispatch brief will carry the relevant lessons ahead of your next
publish.
