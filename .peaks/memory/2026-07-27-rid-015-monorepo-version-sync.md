---
name: 2026-07-27-rid-015-monorepo-version-sync
description: rid-015 widens scripts/bump-version.mjs from shared-only to every publishable workspace subpackage; resolves the "8 npm packages, 1 version knob" defect class where 7 frozen subpackages shipped stale `workspace:*` pins on every publish.
kind: project
---

# rid-015 — monorepo-wide subpackage version sync (2026-07-27)

## What changed
- `scripts/bump-version.mjs` now scans `packages/*` (8 publishable directories today), and patch-bumps every subpackage whose `package.json` carries a clean `x.y.z` SemVer in lockstep with the root bump.
- Private packages, versionless packages, and packages carrying a non-clean `x.y.z` (e.g. `9.9.9-oldsub` fixtures) are skipped with a `console.log` line so the audit trail stays attributable to a specific package.
- Registry idempotency, root bump semantics (`--to` / `PEAKS_NEXT_MAJOR` / default patch), and the exit-1 invalid-target gate are unchanged.
- Added `tests/unit/release/bump-version-monorepo-sync.test.ts` with 12 cases (integration + a11y) covering all subpackages, non-semver skip, private skip, idempotency, root bump semantics, and three consecutive lockstep bumps.
- Widened `tests/unit/release/publish-stale-fix.test.ts` restore set to every workspace manifest (the shared-only restore leaked 7 manifests into the worktree once the script started writing them).
- Repointed `tests/unit/release/publish-stale-fix.test.ts` `AC3/AC7` to read the current root at run time — the hard-coded `4.0.0-beta.34` baseline became stale once the working root advanced to `4.0.0-beta.37`.
- `tests/unit/qa/screenshot-archive-service.test.ts` regression: `env.targetContentsAfter` is `readonly string[]`; needed `[...arr].sort()` to satisfy `tsc --noEmit`.

## Why
- Maintainer observation (2026-07-27): the publish flow shipped 9 npm versions per release but only 1 (`peaks-loop-shared`) was kept current by `bump-version.mjs`. Every other subpackage kept a frozen version, so `pnpm pack` rewrote their `workspace:*` dependencies to stale pins — the same defect class as the 4.0.0-beta.35 → CLI_VERSION lag, but spread across 7 additional tarballs.
- `release-pack.mjs` already discovers packages dynamically (rid-014); `bump-version.mjs` was the lone hold-out with a hard-coded shared-package path.

## Validation
- Focused suite green: `pnpm exec vitest run tests/unit/release/bump-version-monorepo-sync.test.ts` — 12/12 PASS (~16s).
- Release suite green: `pnpm exec vitest run tests/unit/release/` — 76/76 PASS (~87s, includes the pre-existing `AC3/AC7` baseline-pin fix).
- Adjacent regression: `tests/unit/qa/screenshot-archive-service.test.ts` — 8/8 PASS.
- `pnpm exec tsc --noEmit -p tsconfig.json` — clean.
- `node --check scripts/bump-version.mjs` — clean.

## Sediment lesson
- When a script touches only one of N workspace manifests today, but the publish pipeline touches all N, the gap is a latent defect. The fix is to make the script's manifest set match the pipeline's manifest set (here, dynamic `readdirSync(packages/)`).
- Tests that hit the REAL project root must restore every manifest the helper can now write. A test that snapshots two manifests while the helper writes eight will silently leak six — caught only by `git status` mid-run.
- Pre-existing hard-coded version baselines (`'4.0.0-beta.34'`) rot the moment the root version advances one notch. The fix is to read the current root at test setup and assert against that, not against a literal.

## Commits
- `720a7e82 fix(release): synchronize every workspace subpackage version in bump-version (rid-015)`

## Outstanding follow-up (separate sessions)
- rid-016 C: 删除 5 个纯内部子包（peaks-loop-job-snapshot / peaks-loop-mut / peaks-loop-doctor / peaks-loop-crystallization / peaks-loop-final-review / peaks-loop-audit-independent 中真正的 5 个）。
- rid-017 A: publish.yml 顺序（changelog / README / GitHub Release / tag 在 `release-pack.mjs` 之前）。
- rid-018: 4.0.0 发版（独立 session，在 17 之后）。
