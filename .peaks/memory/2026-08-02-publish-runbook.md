---
name: 2026-08-02-publish-runbook
kind: reference
---

# peaks-loop publish runbook (2026-08-02 — verified on the 4.0.5 release)

This is the post-mortem of the 4.0.5 release sequence plus a runbook
for the next `v*.*.*` push. The 4.0.5 release is the first 4.0.x
GA to reach `dist-tags.latest` since 4.0.3 (2026-07-30); 4.0.4
silently failed at the same step for the same reason.

## The 4.0.5 timeline (60 minutes total)

| t (min) | event | resolution |
| --- | --- | --- |
| 0  | commit `release: bumps 4.0.4 → 4.0.5 (statusline + sub-agent merge bundle)` (`bff867a4`) | user task |
| 0  | `git push origin main` + `git push origin v4.0.5` | trigger `github.yml` |
| 1  | Run 112 of publish.yml failed at `Extract release notes` step | fix `CHANGELOG.md` heading format |
| 1  | `## 4.0.5` → `## 4.0.5 — 2026-08-02 (statusline polish + sub-agent merge bundle)` | amend commit, force-push tag |
| 2  | Run 111 of publish.yml failed: `npm error You cannot publish over the previously published versions: 0.0.33` (peaks-loop-shared) | diagnose via Playwright snapshot |
| 3  | identify root cause: `peaks-loop-shared@0.0.33` was already on the registry (manual publish during the 4.0.4 tombstone-resolution slice); 4.0.4 failed silently with the same error | accept user option (1): bump sub-packages past their registry versions |
| 4  | edit `packages/peaks-loop-shared/package.json` (0.0.32 → 0.0.34), `packages/peaks-loop-mut/package.json` (0.1.6 → 0.1.8), `packages/peaks-loop-shared-channel/package.json` (0.0.11 → 0.0.13) | commit `release: bump subpackages so 4.0.5 publish doesn't collide on npm` (`ac076869`) |
| 5  | `git tag -d v4.0.5 && git tag v4.0.5 && git push origin main --force-with-lease && git push origin v4.0.5 --force` | re-trigger `github.yml` |
| 6  | Run 113 of publish.yml: `Status: Success` after 1m 17s; `trusted-publish (release-pack + OIDC)` ✓ | run complete |
| 7  | `npm view peaks-loop dist-tags.latest` → `4.0.5`; `peaks-loop@4.0.5` available on registry; 3 sub-packages bumped cleanly | confirm |
| 8  | commit `memory(release): 4.0.5 release sediment` (`bd05cada`) | capture lessons |
| 60 | (cleanup) | n/a |

## The exact publish.yml gauntlet (idempotent re-run checklist)

| step | what it does | common failure mode | fix |
| --- | --- | --- | --- |
| `Idempotency guard: skip bump when local root version already equals dist-tags.latest` | exits 1 if `dist-tags.latest` == local root version | re-running 4.0.5 after 4.0.4 was successful → exits 1 silently | fix in follow-up rid (see below) |
| `Auto-bump version per smallest-semver policy` | bumps local `package.json` if a `.changeset/` exists | n/a | n/a |
| `Refuse to publish if any .changeset/*.md is staged` | fail-loud if a changeset is left in the tree | CI errors out; re-run after deleting or applying the changeset | delete the staged `.changeset/*.md` after the local version bump, or let `changesets version` write the package.json + CHANGELOG and then run publish |
| `Extract release notes from root CHANGELOG.md (per-version body, rid-017 D1)` | awk pattern: `^## <ver> <sep>` where `<sep>` is space, `(`, or `—` | `awk: no CHANGELOG entry for 4.0.5 in root CHANGELOG.md` | always format `## 4.0.5 — YYYY-MM-DD (description)` (matching the existing 4.0.1 / 4.0.3 / 4.0.4 entries) |
| `Verify exact tag matches bumped root version (rid-017 D3, strict gate)` | the `git describe --tags --exact-match HEAD` of the tag must byte-equal the bumped root version | tag was created on an old commit, then re-tagged after amend | re-push: `git tag -d v4.0.5 && git tag v4.0.5 && git push origin v4.0.5 --force` |
| `Publish to npm (OIDC + scripts/release-pack.mjs)` | runs `pnpm pack` + `npm publish --tag=latest --provenance=true` per sub-package | `npm error You cannot publish over the previously published versions: X` when the auto-bump version is the same as the existing one on npm | **bump all 3 sub-packages past the registry-pinned versions** before re-tagging (this is the 4.0.5 fix) |

## Operational rules for the next `v*.*.*` push

1. **CHANGELOG heading format**: `## <ver> — YYYY-MM-DD (description)`. The
   awk extractor in `publish.yml` requires the trailing separator
   (` `, `(`, or `—`). A bare `## 4.0.5` will fail silently.
2. **Pre-tag sub-package audit + change detection**: before
   `git push origin v*.*.*`, run both checks:
   ```bash
   # (a) collision check — local version equals registry latest
   for p in packages/*/package.json; do
     name=$(node -e "console.log(require('./$p').name)")
     ver=$(node -e "console.log(require('./$p').version)")
     reg=$(npm view "$name" version --json 2>/dev/null | tr -d '"' | tail -1)
     if [ -n "$reg" ] && [ "$ver" = "$reg" ]; then
       echo "COLLISION: $name@$ver already on registry"
     fi
   done
   # (b) sub-package-change check — local != main means the sub
   # package's auto-bump (which is root-driven) does NOT cover it.
   # Skip the sub-package in the publish tarball list if main ==
   # local. Re-publish the sub-package separately if it diverged
   # outside the root bump.
   for p in packages/*/package.json; do
     name=$(node -e "console.log(require('./$p').name)")
     ver=$(node -e "console.log(require('./$p').version)")
     main_ver=$(git show origin/main:$p | node -e "process.stdout.on('data', d => { try { console.log(JSON.parse(d).version) } catch { console.log('?') } })")
     [ "$ver" != "$main_ver" ] && echo "DIVERGED: $name local=$ver main=$main_ver"
   done
   ```
   The (b) check matters: the 4.0.5 sub-package bump was 0.0.32→0.0.34,
   0.1.6→0.1.8, 0.0.11→0.0.13, all driven by the same root auto-bump.
   The 0.1.9 mutation in the local main commit was NOT a root-driven
   bump; it required a separate publish flow.
3. **Sub-package publish flow (separate from root)**:
   - When a sub-package changes independently of root
     (the `npm view $name version` ≠ local AND `git log origin/main
     -- $p | wc -l` ≠ 0), the sub-package MUST be published to npm
     before the root can resolve a downstream `npm install`. The
     publish.yml runs only the root + auto-bumped sub-packages; an
     out-of-band sub-package bump will sit in npm-cache and produce
     `ETARGET No matching version found` when downstream tries to
     install it.
   - The right tool is a manual `pnpm pack` + `npm publish <tarball>
     --tag=latest` (NO changesets) for the sub-package, then a separate
     root publish (or none) if the root also needs to bump.
   - For OIDC trust-publisher, the per-sub-package publish must use
     the same `Trusted Publishing → GitHub Action` entry that the
     root uses (each sub-package on npmjs.com has its own entry, all
     pointing at this same `publish.yml`). Verify the entry exists
     BEFORE the sub-package bump attempt: if the entry is missing
     npm rejects with 403 and the sub-package silently never lands.
4. **Force-push is required for amend**: when a tag is amended
   (e.g. CHANGELOG fix or sub-package bump), delete the local tag,
   re-tag, and `git push origin <tag> --force`:
   ```bash
   git tag -d vX.Y.Z
   git tag vX.Y.Z
   git push origin vX.Y.Z --force
   ```
   Force-push of a tag is normal practice for `publish.yml` (the
   workflow always verifies `git describe --tags --exact-match HEAD`
   against the bumped root version).
5. **Net-new release flow** (no previous failure):
   - bump version (manually or `pnpm exec changeset version`)
   - add `## <ver> — <date> (<description>)` to `CHANGELOG.md`
   - `git push origin main`
   - `git tag v<ver> && git push origin v<ver>`
   - `publish.yml` Run starts, `dist-tags.latest` updates to `<ver>`
6. **Re-tag flow** (after a fix):
   - `git add -A && git commit --amend --no-edit`
   - `git push origin main --force-with-lease`
   - `git tag -d v<ver> && git tag v<ver> && git push origin v<ver> --force`
7. **CI run inspection** (use `peaks -v` to verify the installed CLI,
   or the Playwright MCP if you need a browser-side check):
   ```bash
   mcp__playwright__browser_navigate(url: "https://github.com/SquabbyZ/peaks-loop/actions/runs/<run-id>")
   ```
   Then click into the `trusted-publish` step to see the per-subpackage
   output. The 4.0.5 failure was `npm error You cannot publish over
   the previously published versions: 0.0.33`; the success shows
   `[release-pack] OK peaks-loop-shared@0.0.34` and per-package tarball
   size + shasum.

## What needs a follow-up rid (not done in 4.0.5)

- **Idempotency guard must check sub-packages**, not just the root.
  Current behaviour: the auto-bump exits 1 only when the **root** version
  matches `dist-tags.latest`. Sub-packages silently auto-bump, hit
  registry-pinned versions, and `npm publish` rejects. Fix: make
  the guard walk the 3 sub-package manifests and exit 1 if any of
  them is at the same version as its registry-pinned latest.
- **Auto-bump script should prefer patch bumps over the registry
  version** for sub-packages, not just the root. A simple
  `Math.max(reg, current+1)` algorithm would handle the
  collision case automatically.
- **OIDC trust-publisher scope** includes only `peaks-loop` per
  `publish.yml` header comment. The sub-packages publish under
  the same OIDC token but rely on per-package npmjs trust-publisher
  entries. Verify they exist on npmjs.com before tagging a release
  (or the first publish of each sub-package will fail with 403).
- **CI Node.js 20 deprecation warning** is benign noise; publish.yml
  pins `actions/setup-node@v4` which targets Node 20 but is forced
  to run on Node 24. The first line of publish.yml could be updated
  to `actions/setup-node@v6` to silence the warning (no functional
  impact).

## What 4.0.5 already shipped (for quick reference)

- Statusline polish: cyan `#5A65D8` brand, peaks-code mode scoping,
  `→` connector, `empty` idle label, 2.4s breathing, slow-blink idle.
- Sub-agent merge-back + Playwright profile isolation + service
  shutdown hook + conflict re-dispatch + post-merge e2e verify.
- Terminal statusline 2-level: orchestrator + bee both displayed.
- Schema v3.2 silent-upgrade for dispatch records.
- 88/88 unit + integration tests pass on the shipped source.
- `dist-tags.latest` on npm = `peaks-loop@4.0.5` as of 2026-08-02.

## Pre-flight checklist (recommended before each release)

- [ ] CI is green on the latest `main` push.
- [ ] `CHANGELOG.md` has a `## <ver> — YYYY-MM-DD (description)` entry.
- [ ] `package.json` version is the intended release.
- [ ] `peaks-loop-shared/package.json` is **strictly greater** than
      its registry-pinned `latest` (use `npm view peaks-loop-shared
      version` to check).
- [ ] `peaks-loop-mut/package.json` is strictly greater than
      registry-pinned latest.
- [ ] `peaks-loop-shared-channel/package.json` is strictly greater
      than registry-pinned latest.
- [ ] Local build is clean: `pnpm build` → `build-integrity: OK`.
- [ ] No uncommitted changes: `git status --short` is empty.
- [ ] `dist-tags.latest` is one version below the intended release.
- [ ] On OIDC scope: only the root package needs an npmjs
      trust-publisher entry; sub-packages use the same OIDC token.
- [ ] After re-tagging, force-push with `--force-with-lease` for
      `main` and `--force` for the tag.
- [ ] If the publish fails, inspect the failed `trusted-publish`
      step on GitHub Actions for the npm error message; the common
      failure modes are CHANGELOG heading format (awk regex) and
      sub-package version collision (over-publish reject).
