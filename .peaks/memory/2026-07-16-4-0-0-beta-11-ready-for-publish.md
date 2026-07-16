---
name: 2026-07-16-4-0-0-beta-11-ready-for-publish
description: peaks-loop 4.0.0-beta.11 ready for npm publish. Version bumped from beta.10 (pre-impl contract name) to beta.11 (actual release). All preflight checks green. User must run `npm publish --tag beta --otp=<6位OTP码>`.
metadata:
  type: project
  date: 2026-07-16
  sessionId: 2026-07-16-session-651c20
  targetRelease: 4.0.0-beta.11
  releaseStatus: READY-FOR-PUBLISH
  publishAction: user only (Human-NL-Choice-Only + 2FA OTP)
  newDrift: D-016 version bump rationale (beta.10 = contract; beta.11 = release)
---

# 4.0.0-beta.11 — ready for publish

**Date:** 2026-07-16
**Session:** 2026-07-16-session-651c20
**HEAD:** `40e2962` (chore(version): sync CLI_VERSION 4.0.0-beta.10 → 4.0.0-beta.11)
**Target release:** `4.0.0-beta.11`
**Tarball:** `.pack-cache/peaks-loop-4.0.0-beta.11.tgz` (30MB, 1255 files)

## Version bump rationale (D-016)

`4.0.0-beta.10` was the **pre-implementation contract name** — the
PRD/runbook that documented what the 3 slices would deliver, before
any Slice 1/2/3 code landed. After Slice 1 (commit `cf2fd16`) + Slice 2
(commit `a38a769`) + Slice 3 (commit `4d594cf`) + ice-cola baseline
GREEN (this session), the **actual released version** is `4.0.0-beta.11`.

Per D-016 (this sediment), the convention is:
- `4.0.0-beta.N` = pre-implementation contract (PRD + runbook, no code yet)
- `4.0.0-beta.N+1` = actual release of that contract (code lands)

Runbook filename stays `docs/release/4.0.0-beta.10.md` for cross-
reference stability — the file documents the contract scope, not the
version label.

## Files changed (7 files)

```
M  package.json                            # version: 4.0.0-beta.10 → 4.0.0-beta.11
M  src/shared/version.ts                   # CLI_VERSION regenerated via sync-version.mjs
M  src/cli/commands/dispatch-commands.ts  # code comment 4.0.0-beta.10 → 4.0.0-beta.11
M  src/cli/commands/ecc-commands.ts       # code comment
M  src/services/agent/ecc-cache-service.ts # code comment
M  src/services/audit/static-service.ts    # code comment
M  CHANGELOG.md                            # 4.0.0-beta.10 section header → 4.0.0-beta.11
                                          # + Status: PRE-IMPLEMENTATION → RELEASED
                                          # + Ship path narrative
```

**Commit:** `40e2962 chore(version): sync CLI_VERSION 4.0.0-beta.10 → 4.0.0-beta.11 (release of beta.10 contract)`
Author = SquabbyZ only (CLAUDE.md red rule preserved; zero AI trailers).

## Pre-publish sanity checklist (ALL PASS)

| Check | Result |
|---|---|
| `git status --short` | clean (only `40e2962` ahead of origin) |
| `git log --oneline -5` | `40e2962` (version bump), `2aca14a` (sediment), `958142d` (sediment), `4d594cf` (Slice 3), `2f177e1` (RD COMPLETE) |
| `grep '"version"' package.json` | `"4.0.0-beta.11"` |
| `pnpm build` | exit 0; sync-version + clean-dist + tsc + copy-templates all green |
| `dist/cli/index.js` exists | yes |
| `dist/src/cli/index.js` exists | no (correct; flat `dist/` layout) |
| `peaks --version` | `4.0.0-beta.11` |
| `npm pack --pack-destination .pack-cache` | success; `peaks-loop-4.0.0-beta.11.tgz` (30MB) |
| Tarball contents | `bin/peaks.js`, `dist/cli/index.js`, `dist/cli/commands/ecc-commands.js`, `dist/services/agent/ecc-cache-service.js` all present |
| Tarball package.json | `"version": "4.0.0-beta.11"` |

## User's final action — publish

```bash
cd "C:/Users/smallMark/Desktop/peaks-loop"

# (Optional) re-verify
peaks --version                       # expected: 4.0.0-beta.11
git status --short                    # expected: clean

# 2FA-OTP required — only the user can run this
npm publish --tag beta --otp=<6位OTP码>

# Verify on npm registry
npm view peaks-loop@beta version       # expected: 4.0.0-beta.11
```

**Per CLAUDE.md Human-NL-Choice-Only:** the LLM cannot type CLI verbs
on the user's behalf, and `npm publish --otp=<6位>` requires the
user's 2FA. The publish action is **the user's responsibility**.

## Ice-cola integration (D-015 follow-up)

After publish, ice-cola user must run `pnpm approve-builds` once to
whitelist peaks-loop's postinstall script (pnpm 10+ security default).
After that, `pnpm peaks <verb>` works in ice-cola.

## What's NOT changing

- `docs/release/4.0.0-beta.10.md` filename stays (cross-reference stability).
- Runbook §6 publish instructions already document the exact commands.
- No new feature; pure version label update.

## Hard rules carried forward (15 total)

- Author = SquabbyZ only; zero AI trailers.
- D-002: session title positional.
- D-005: job checkpoint via `--reason`.
- D-007: Commander 12 — `{ hidden: true }`.
- D-008: prompt ceiling ≤6KB OR split.
- D-009: parseFrontmatter throws — try/catch.
- D-010: ecc.tar.gz missing — tarball fallback.
- D-011: test path is sub-agent-commands.test.ts.
- D-012: --help short-circuit; test action path.
- D-013: wrapper exit-code deferred follow-up.
- D-014: Slice 3 RD 9KB prompt takes ~25 min; poll mtime, not dispatch status.
- D-015: ice-cola `pnpm peaks <verb>` requires `pnpm approve-builds`.
- **D-016 (NEW): Version bump convention** — `beta.N` = contract, `beta.N+1` = release of contract. Runbook filename preserved.

## Why this matters

The 3-slice job is COMPLETE + version-bumped + preflight green. The
final gate is the user's `npm publish` action (2FA + Human-NL-Choice-Only).
After publish, peaks-loop 4.0.0-beta.11 will be the first official
release of the CLI surface cleanup + on-demand ECC story.

How to apply: any new session reading this file should NOT re-run
the publish action — that requires the user's 2FA OTP. The session
should confirm HEAD = `40e2962` and the tarball exists at
`.pack-cache/peaks-loop-4.0.0-beta.11.tgz`, then prompt the user
to run `npm publish --tag beta --otp=<6位>`.