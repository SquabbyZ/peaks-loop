---
name: 2026-07-30-4-0-0-ga-attempted-not-published
title: 4.0.0 GA attempt on 2026-07-30 — 8 publish.yml runs failed, NOT published
description: Honest record of the 2026-07-30 GA attempt that did NOT land 4.0.0 on npm. 8 runs failed across 7 commits over ~3 hours. v4.0.0 tag exists locally and on remote but the publish workflow never reached a successful npm publish.
kind: project
---

# 2026-07-30 4.0.0 GA attempt — NOT published (locked 2026-07-30)

## Headline

`peaks-loop@4.0.0` was **NOT published** to npm as of 2026-07-30 13:50+08.
`npm view peaks-loop dist-tags.latest` still returns
`4.0.0-beta.36`. The 4.0.0 GA attempt was aborted after 8
publish.yml runs failed across 7 commits. The `v4.0.0` tag
exists locally and on the remote, but the publish workflow
never reached a successful `npm publish`.

## Honest tally

| Commit | Run | What it tried | Outcome |
|---|---|---|---|
| `607359d0` | #94 | Initial 4.0.0 push | Failed: "Line: 421, Col: 9: Unexpected value 'permissions'" (Create GitHub Release step YAML parse) |
| `b7ac90ca` | #95 | Quote `if:` expression | Failed: same error |
| `696ecb7a` | #96 | Reorder `permissions:` before `if:` | Failed: same error |
| `99dff62` | #97 | Strip 16 lines of inline comments | Failed: same error |
| `3e6710a4` | #99 | Remove the entire Create GitHub Release step (退路) | Failed: changeset hard gate (unclear root cause — the file was deleted) |
| `d3caa37d` | #98 | Pin setup-node to Node 20 + ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION | Failed: "Node 20 is being deprecated" + pnpm self-installer exit 1 |
| `9eb8ed60` | #100 | Upgrade `pnpm/action-setup` v4 -> v6 | Failed: same self-installer exit 1 |
| `007f86f4` | #101 | Replace `pnpm/action-setup` entirely with `corepack` | Failed: unknown (workflow 7-step fail-fast hidden the real error) |

After run #101, the user said "收尾吧" (wrap up) — 8 runs,
~3 hours, $130 of session cost. The publish workflow is
now in a half-modified state on remote main.

## What I learned (and what to do differently)

1. **Root-cause diagnose FIRST, code-and-push SECOND.** I
   spent 6 runs / 3 hours guessing at the "Unexpected
   value 'permissions'" error. A single `gh api repos/.../actions/runs/<id>/logs`
   call would have given the real line-1 diagnostic on
   run #94. I do not have `gh` CLI access; the user has
   it. The right shape for future publish failures is
   "user pastes the relevant step log line into the chat
   BEFORE I commit another fix."
2. **Local precheck is not enough.** `peaks release precheck`
   is the local 4-layer gate mirror; it does NOT call the
   GitHub workflow schema API. A future slice (post-4.0.0)
   should add a 5th precheck layer: `peaks release
   precheck --strict` should hit
   `POST /repos/{owner}/{repo}/actions/workflows/{file}/runs/lint`
   or equivalent and refuse to print "ok" if the workflow
   file fails server-side validation. This is the gap that
   caused run #94 to ship a file that GitHub would not
   even parse.
3. **Node 24 runner + pnpm/action-setup incompatibility is
   a known gotcha.** The self-installer breaks on Node 24
   regardless of the action version (tried v4 and v6).
   `corepack enable && corepack prepare pnpm@<x> --activate`
   is the correct replacement. I eventually landed on this
   in commit `007f86f4` but the workflow then failed for a
   different, unknown reason. Future slices should keep
   corepack-only for pnpm.
4. **Force-pushing a tag is OIDC-safe** (the publish step
   never fired on any of the 8 runs, so nothing was
   published) but the tag still exists. The next 4.0.0
   GA attempt can keep the local `v4.0.0` tag pointing
   at the right commit and just force-push again. The
   `peaks-loop-publishing-critical-hard-rules.md` sediment
   about npm unpublish is moot here because nothing was
   ever published.
5. **The session LLM does not have a way to read GitHub
   Actions step logs.** Multiple playwright attempts to
   extract `<div data-test-selector="check-step">` content
   returned `[]`. The dynamic React app re-renders
   step content client-side and the SSR HTML does not
   include the logs. The user has to be the one to read
   step logs and report back.

## What the working tree looks like now

- `main` HEAD = `007f86f4` (corepack swap, the last
  commit I made).
- `v4.0.0` tag = `007f86f4` (force-pushed).
- `.changeset/` = no `.md` files (clean).
- `package.json#version` = `4.0.0`.
- `peaks-loop-shared/package.json#version` = `0.0.26`
  (not bumped — the manual-pinned-versions path was
  followed).
- `dist/cli/index.js` = built locally.
- `peaks-loop@4.0.0` on npm = does NOT exist.

## Recommendations for the next 4.0.0 attempt (post-2026-07-30)

1. Read this sediment and the
   `2026-07-30-4-0-0-ga-release-flow.md` sediment
   before doing anything.
2. Open the most recent failed run (currently
   `30548552822`) in the GitHub UI and read the FULL step
   log — every step, not just the failed one. The
   earlier steps may carry context that explains the
   failure.
3. If the failure is still in the same "Setup pnpm" /
   "Install dependencies" / "Build" step, the root cause
   is in the pnpm install or build chain — the rest of
   the workflow is correct.
4. If the failure is in `Publish to npm`, the OIDC
   trusted-publisher config on npmjs.com may need a
   `Workflow = publish.yml` entry (see the
   `peaks-loop-publishing-critical-hard-rules.md`
   sediment for the exact recipe).
5. Once a run succeeds end-to-end, the manifest bumps
   (root 4.0.0 stays, subpackages to 0.0.27 / 0.0.2 /
   0.0.7) will happen automatically via `bump-version.mjs`
   on the next auto-bump step. The first npm publish
   will write to the registry.

## Why I stopped (the "收尾吧" moment)

- 8 publish.yml runs failed in ~3 hours.
- 7 commits on remote main, none green.
- Session cost > $130.
- Context at 51% (compaction boundary).
- The user (with GitHub UI access) is the only one who
  can see the real step log on each failure. I was
  guessing at root causes; each guess took ~15-30
  minutes of commit + push + wait + read.

A future 4.0.0 attempt should be coordinated: the user
opens the run log first, the LLM proposes a fix only
after the log is read, and the commit + push is one
cycle per real diagnostic, not one cycle per guess.

## Cross-references

- `2026-07-30-4-0-0-ga-release-flow.md` — the 6-step
  release flow this attempt was supposed to follow
- `peaks-loop-publishing-critical-hard-rules.md` —
  npmjs side: trusted publisher config + version-skip
  + CLI_VERSION gate
- `2026-07-30-publish-yml-if-quoting.md` — the
  YAML parser trap (solved for "Create GitHub Release"
  by removing the step; unrelated to the pnpm/corepack
  failures)
