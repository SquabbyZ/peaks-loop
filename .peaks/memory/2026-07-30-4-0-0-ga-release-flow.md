---
name: 2026-07-30-4-0-0-ga-release-flow
title: 4.0.0 GA release flow — exact 6-step sequence (subpackages first, then root)
description: Locked sequence to take peaks-loop from 4.0.0-beta.36 to 4.0.0 GA on npm. Verifies registry state, bumps subpackage first (chicken-egg fix), then root, then publish.
kind: project
---

# 4.0.0 GA release flow (locked 2026-07-30)

> **This sediment is the single source of truth for the 4.0.0
> GA cutover. It locks the exact 6-step sequence so a future
> session (or the user running the same steps manually) does
> not have to re-derive it from the changelog + publish.yml.**

## 0. Pre-flight — verify registry state

```bash
npm view peaks-loop dist-tags
# expected: { latest: '4.0.0-beta.36', ... }
npm view peaks-loop versions --json | tail -20
# expected: last entries are 4.0.0-beta.N; NO 4.0.0 or 4.0.2
# (confirmed 2026-07-30; unpublish 4-0-0-and-4-0-2 workflow
# had no live versions to unpublish — both ghost versions
# were already gone by the time the cleanup workflow ran)
```

If registry state differs (e.g. someone manually published
a 4.0.0-rc.x), STOP. Surface the discrepancy to the user
before proceeding.

## 1. Pre-flight — clean stale workflows

Already done in this session (commit c9860f94 preceded by
the workflow-cleanup commit):

- `.github/workflows/unpublish-4-0-0-and-4-0-2.yml` DELETED
  (npm registry confirms no 4.0.0 / 4.0.2 were ever live)
- `.github/workflows/dist-tag-move.yml` DELETED
  (4.0.0 GA is the first stable 4.0.0; no prior 4.0.0
  needs to be displaced from `latest`)

## 2. Bump `peaks-loop-shared` (chicken-egg)

Why first: publish.yml's `gate-cli-version` step refuses to
publish if `peaks-loop-shared/dist/version.js` lags the
root `package.json#version`. The shared package was at
0.0.26 (the beta line); the root jumps to 4.0.0. Bumping
shared FIRST keeps the gate green.

```bash
# Edit packages/peaks-loop-shared/package.json
# version: 0.0.26  ->  0.1.0

pnpm --filter peaks-loop-shared build
# regenerates packages/peaks-loop-shared/dist/version.js
# with the new 0.1.0

# Verify:
node -e "console.log(require('./packages/peaks-loop-shared/dist/version.js').CLI_VERSION)"
# expected: 0.1.0
```

## 3. Bump root + write release changeset (already done in this session)

- `.changeset/release-4.0.0.md` declares peaks-loop=major
  and peaks-loop-shared=minor
- `package.json#version` is ALREADY 4.0.0 (no change needed;
  the lock has been in place since 2026-07-28)
- `CHANGELOG.md` top entry is `## 4.0.0 — 2026-07-28 (GA release)`;
  no 5.0.0 ghost (commit 1d6233bc removed the misleading
  5.0.0 header)

## 4. Local preflight (MUST be green before any push)

```bash
pnpm -s build
# expected: exit 0; tsc compiles; copy-templates copies;
# check-build-integrity: OK

pnpm test:full
# expected: 4 packages / 219 cases / all green in ~67s
# (shared 0 / mut 22 / shared-channel 20 / root 177)

# peaks release precheck (4-layer gate mirroring publish.yml):
peaks release precheck --project . --json
# expected: all 4 layers pass (CHANGELOG / CHANGESET / VERSION /
# GATE). If any fail, fix locally BEFORE pushing the tag.
```

## 5. Bump subpackage version pin (chicken-egg resolution at publish time)

The peaks-loop-shared bump (step 2) already updated the
version pin in the `workspace:*` references through
`pnpm install` after the build. Verify:

```bash
grep -A 2 'peaks-loop-shared' package.json | head -5
# expected: "peaks-loop-shared": "workspace:*"
# (resolved to 0.1.0 by pnpm install)
```

## 6. Tag + push (USER ACTION REQUIRED)

> ⚠️ **The push step is the only step this sediment
> delegates to the user. publish.yml is OIDC trusted
> publishing — once the tag is pushed, the publish is
> UNDO-ABLE only via npmjs.com web UI (per npm's 72h
> unpublish policy). Do NOT push the tag without
> explicit user authorization.**

```bash
# User runs these (NOT the LLM):
git tag v4.0.0
git push origin v4.0.0
# or:
git push --tags
```

publish.yml triggers:
- install + build (incl. peaks-loop-shared build)
- vitest (4 packages / 219 cases)
- conditional changeset version: this file IS staged, so
  pnpm exec changeset version runs first to confirm bumps
- release-pack.mjs: publishes peaks-loop-shared FIRST, then
  peaks-loop-shared-channel, then peaks-loop-mut, then
  peaks-loop (root, last)
- gate-cli-version: refuses if shared/dist/version.js
  doesn't match root package.json#version

## 7. Post-publish verification

```bash
npm view peaks-loop dist-tags
# expected: { latest: '4.0.0' }
npm view peaks-loop@4.0.0
# expected: non-error; shows the published manifest
git tag -l 'v*'
# expected: v4.0.0
```

If any step diverges from expected output, capture the
workflow run URL and the actual output — the
`peaks-loop-publishing-critical-hard-rules.md` sediment
documents the post-mortem template for these cases.

## Subpackage publish order (auto, from release-pack.mjs)

The release-pack.mjs script derives publish order from
`pnpm-workspace.yaml` and the `workspace:*` dependency
graph. As of 2026-07-30 the order is:

1. `peaks-loop-shared@0.1.0` (no deps; pure fs / paths / version)
2. `peaks-loop-shared-channel@0.0.6` (depends on shared)
3. `peaks-loop-mut@0.0.1` (depends on shared; was 0.0.1 in beta line; the GA bumps this too — verify before push)
4. `peaks-loop@4.0.0` (depends on all three; published last)

This order matters: if peaks-loop-shared is bumped but
peaks-loop-shared-channel is NOT, npm refuses to install
peaks-loop@4.0.0 because the `workspace:*` pin would resolve
to a non-existent 0.1.0 on the registry.

## Why this sediment was written

The user (2026-07-30) was about to push the tag when the
LLM flagged two pre-existing risks:
1. `npm view` confirmed 4.0.0 / 4.0.2 had never been
   published (the previous unpublish-4-0-0-and-4-0-2
   workflow was a ghost — no live versions to clean).
2. publish.yml's gate-cli-version would refuse the tag
   if peaks-loop-shared wasn't bumped first (the beta
   line was 0.0.26, the GA needs 0.1.0).

Without this sediment, a future session would have to
re-derive both facts from the publish.yml comments and
the registry. The sediment makes the gate explicit.

## Cross-references

- `2026-07-30-test-rebuild-epic-sediment.md` — the test
  suite rebuild this 4.0.0 ships with
- `peaks-loop-publishing-critical-hard-rules.md` — the
  npm publish + 4-layer gate history
- `2026-07-30-karpathy-evaluation-cost-self-review-design.md`
  — one of the 3 user-visible features this 4.0.0 ships
- `2026-07-30-windows-parallel-hooktimeout-fix.md` — the
  Windows test flake fix that keeps `pnpm test:full` green
