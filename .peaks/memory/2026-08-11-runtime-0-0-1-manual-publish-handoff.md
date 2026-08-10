---
name: runtime-0-0-1-manual-publish-handoff-2026-08-11
description: peaks-loop-internal-runtime@0.0.1 must be published manually to npm BEFORE peaks-loop@4.0.20 publish can succeed (lockstep dep chain)
metadata:
  type: project
  createdAt: 2026-08-11
---

# Manual publish handoff: peaks-loop-internal-runtime@0.0.1

## State (peaks-loop@4.0.20 publish blocked)

- peaks-loop tarball `package.json` has `"peaks-loop-internal-runtime": "workspace:*"` which pnpm pack rewrites to `peaks-loop-internal-runtime@4.0.20` (root version at build time).
- peaks-loop-internal-runtime v4.0.20 was meant to be public, but user direction (2026-08-11) corrected the model: runtime should use INDEPENDENT 0.0.x SemVer (sibling of peaks-loop-shared 0.0.x / shared-channel 0.0.x / mut 0.1.x), NOT lockstep with peaks-loop root.
- New runtime npm version: 0.0.1 (RUNTIME_VERSION string still tracks peaks-loop root 4.0.20 for API contract checks).
- peaks-loop@4.0.20 publish #146 (and earlier #145) FAILED because npm install can't resolve peaks-loop-internal-runtime@0.0.1 in the registry — runtime has never been successfully published (publish #143 failed at runtime@4.0.0 because private:true; #144/#145/#146 all fail at the lockstep gate or at the npm-publish step).

## What needs to happen (user + LLM split)

### Step 1: User manually publishes peaks-loop-internal-runtime@0.0.1

The user must do this step manually because (a) the runtime is now public + needs OIDC npm publish which CI can also do but the lockstep dep chain is broken (peaks-loop tarball depends on runtime@0.0.1 which doesn't exist yet), (b) runtime is a small package independent of the main peaks-loop release flow.

**Command (from monorepo root, on a fresh worktree or locally)**:

```bash
cd /path/to/peaks-loop
# Build runtime first
pnpm --filter peaks-loop-internal-runtime build

# Manually publish runtime@0.0.1 to npm
pnpm --filter peaks-loop-internal-runtime publish --access public --no-git-checks --tag=latest
```

**Verify**:
```bash
npm view peaks-loop-internal-runtime dist-tags.latest
# Expected: 0.0.1

curl -fsS https://registry.npmjs.org/peaks-loop-internal-runtime/0.0.1 | jq .version
# Expected: "0.0.1"
```

### Step 2: After runtime@0.0.1 is on registry, LLM (or user) re-triggers peaks-loop@4.0.20 publish

Force-push v4.0.20 tag again (currently pointing to commit f246d0ad which has the 0.0.1 npm version fix):

```bash
git tag -d v4.0.20
git tag v4.0.20  # re-creates pointing to f246d0ad (or newer)
git push origin v4.0.20 --force
```

This re-triggers GitHub Actions publish workflow. With peaks-loop-internal-runtime@0.0.1 now in registry:
- `pnpm pack` rewrites `peaks-loop-internal-runtime: "workspace:*"` → `0.0.1` in peaks-loop tarball
- `npm publish peaks-loop@4.0.20` succeeds
- Users can `npm install -g peaks-loop@4.0.20` without 404

**Verify**:
```bash
npm view peaks-loop dist-tags.latest
# Expected: 4.0.20

curl -fsS https://registry.npmjs.org/peaks-loop/4.0.20 | jq .dependencies.'peaks-loop-internal-runtime'
# Expected: "0.0.1" (exact version pin)
```

## Spec / plan / sediment trail

- spec: `docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md` (was based on private+lockstep; corrected by user direction 2026-08-11)
- plan: `docs/superpowers/plans/2026-08-10-peaks-detached-sub-agent-plan.md` Task 15 (final form: public + independent 0.0.x SemVer)
- ship-pending: `.peaks/memory/2026-08-11-runtime-detached-4-0-19-ship-pending.md` (renamed to `…shipped.md` for v4.0.19 publish #144 success; v4.0.20 supersedes 4.0.19 because runtime was effectively unpublished in 4.0.19)
- shipped (v4.0.19): `.peaks/memory/2026-08-11-runtime-detached-all-5-phases-shipped.md` (de facto superseded by v4.0.20)

## Why this happened (sediment)

- Plan §6.1 originally wrote "runtime is private" — wrong. A peaks-loop tarball that depends on a private workspace package can't be installed from the registry. Either runtime is public (and the user wants 0.0.x SemVer), or runtime is inlined (no separate package).
- User's clarification: "和其他的子包一样" = same as peaks-loop-shared / shared-channel / mut = public, independent 0.0.x SemVer.
- The npm version 4.0.20 was a wrong detour (I tried to lockstep runtime npm version to root version, but user wanted independent 0.0.x).

## Next session priorities

1. Verify user-published peaks-loop-internal-runtime@0.0.1 is on registry
2. Re-trigger peaks-loop@4.0.20 publish (force-push v4.0.20 tag)
3. Verify peaks-loop@4.0.20 published; peaks-loop tarball's deps have `peaks-loop-internal-runtime: 0.0.1`
4. ci #173 still failing on main branch — independent of publish; fix in follow-up
5. Bump runtime to 0.0.2 + peaks-loop to 4.0.21 if user wants any runtime API changes shipped