---
name: 2026-07-30-4-0-0-publish-root-cause-fixed-blocked-on-tombstone
title: 4.0.0 publish — real root cause found and fixed; now blocked ONLY on the npm 4.0.0 tombstone
description: Supersedes the "8 runs failed, unknown cause" sediment. The publish pipeline is now fixed and reaches step 15/15; the sole remaining blocker is that npm permanently reserves the unpublished 4.0.0 version number. Includes the exact diagnostic commands that found it.
kind: project
---

# 4.0.0 publish — root cause fixed, blocked on npm tombstone (locked 2026-07-30)

## Headline

The publish pipeline is **fixed**. Run `30551690056` (commit `24b0ddeb`)
passed **14 of 15 steps**, including the two gates that killed every
prior attempt. The only remaining blocker is external: npm permanently
reserves version `4.0.0` because it was published on 2026-07-22 and then
unpublished. No code change can bypass this.

## The real root cause (found on attempt 9, after 8 wrong guesses)

`publish.yml` step "Auto-bump version per smallest-semver policy" had
only two branches:

1. `workflow_dispatch` INPUT_TARGET
2. default smallest-semver patch+1

Pushing tag `v4.0.0` with root `package.json#version` already at `4.0.0`
fell through to branch 2 and bumped **4.0.0 -> 4.0.1**. Two steps later
the run died with `no CHANGELOG entry for 4.0.1 in root CHANGELOG.md`.

The AC7 idempotency guard did NOT catch it: that guard only no-ops when
the local root version equals `dist-tags.latest`, which was
`4.0.0-beta.36`, not `4.0.0`.

Note the internal contradiction this exposed: the downstream
`gate-tag-version` step already treats the tag as authoritative and
would have failed on `tag=v4.0.0` vs `version=4.0.1`. The Auto-bump step
was disagreeing with a gate 6 steps below it.

## Why the previous 8 attempts all missed it

Every prior fix targeted the wrong layer — YAML parse errors, then
`pnpm/action-setup`, then Node 20/24. Those were real bugs and they WERE
fixed (by `007f86f4`), but they were never the whole story. Run #101
already reached step 14 of 15 with the first 13 steps green; the prior
session recorded that run as "failed: unknown" and stopped.

**The diagnostic that broke the deadlock — and the lesson:**

The prior sediment claims "the session LLM does not have a way to read
GitHub Actions step logs" and that the user must paste them manually.
**This is false.** `gh` CLI works fine; it just needs the correct proxy
from `proxy-127.0.0.1-58309.md`:

```bash
export HTTPS_PROXY=http://127.0.0.1:58309 HTTP_PROXY=http://127.0.0.1:58309
gh run list --limit 12
gh run view <run-id> --log-failed     # <-- prints the real ::error:: line
gh run watch <run-id> --exit-status --interval 15
```

The earlier session's playwright attempts failed because the Actions log
viewer renders client-side. `gh run view --log-failed` hits the API and
returns plain text. One call gave the exact error string that 3 hours of
guessing had not.

**Rule: on any CI failure, run `gh run view <id> --log-failed` FIRST.
Do not commit a fix before reading the actual error line.**

## The three fixes (commit `24b0ddeb`)

1. **publish.yml Auto-bump — tag is authoritative.** Priority order is
   now INPUT_TARGET -> exact HEAD tag -> patch+1. A pushed `v<x.y.z>`
   tag is used verbatim. This also makes the step agree with
   `gate-tag-version` instead of contradicting it.

2. **bump-version.mjs — explicit `--to` equal to current is not an
   error.** It is the normal shape of a planned GA release. The root
   manifest is left untouched; workspace subpackages are STILL bumped in
   lockstep (AC6 / rid-015) so no tarball ships a stale `workspace:*`
   pin. The default (no `--to`) path still fails loudly on a no-op.

3. **peaks-loop-shared baseline 0.0.26 -> 0.0.27.** The registry already
   carried `0.0.27` (built from the older 4.0.0-beta.36), so bumping
   from 0.0.26 would have collided. From 0.0.27 the bump lands on the
   verified-free 0.0.28. Verify next-number availability BEFORE pushing:

   ```bash
   npm view peaks-loop-shared@0.0.28 version   # empty output = free
   ```

## The remaining blocker: the npm tombstone

```
npm error 400 Bad Request - PUT https://registry.npmjs.org/peaks-loop
  - Cannot publish over previously published version "4.0.0".
```

This fires AFTER the tarball is packed and AFTER provenance is signed
into the sigstore transparency log — the registry rejects at the last
moment.

**How to confirm a tombstone** (the npmjs.com UI will NOT show it — the
version list only renders live versions, so an unpublished version looks
identical to one that never existed):

```bash
curl -s https://registry.npmjs.org/peaks-loop -o ./reg-tmp.json
node -e "
const j=JSON.parse(require('fs').readFileSync('./reg-tmp.json','utf8'));
for(const v of ['4.0.0','4.0.1','4.0.2'])
  console.log(v, j.versions[v]?'PRESENT':'ABSENT', j.time?.[v]||'(no time entry)');
"
rm -f ./reg-tmp.json
```

Observed 2026-07-30:

| version | in `versions` | in `time` | meaning |
|---|---|---|---|
| 4.0.0 | ABSENT | `2026-07-22T02:50:41.226Z` | **tombstoned** (published then unpublished) |
| 4.0.1 | ABSENT | *(no entry)* | never published — **free** |
| 4.0.2 | ABSENT | `2026-07-22T01:53:48.127Z` | **tombstoned** |

The `time` entry is the tell. A version that was never published has no
`time` entry at all. Cross-reference:
`peaks-unpublish-4-0-0-and-4-0-2-stuck.md` records the 07-22 unpublish.

**Windows gotcha:** writing the probe file to `/tmp` fails — Git Bash's
`/tmp` and Node's path resolution disagree (Node reads it as
`C:\tmp\...`). Write to `./` and clean up.

## Current state (as of 2026-07-30 22:35)

- `main` HEAD = `24b0ddeb`, pushed.
- `v4.0.0` tag = `24b0ddeb`, force-pushed.
- Working tree clean. `package.json#version` = `4.0.0`.
- `packages/peaks-loop-shared` = `0.0.27` (bumps to free 0.0.28 in CI).
- vitest: 177 passed / 11 files.
- `peaks-loop@4.0.0` on npm: still does NOT exist.
- **Decision (user, 2026-07-30): open an npm support ticket to try to
  release the 4.0.0 number rather than shipping 4.0.1 or 4.1.0.**

The repo is in a ready-to-publish state. If npm releases the number,
re-push the tag — no code change needed:

```bash
export HTTPS_PROXY=http://127.0.0.1:58309 HTTP_PROXY=http://127.0.0.1:58309
git push origin v4.0.0 --force
gh run watch $(gh run list --workflow=publish.yml --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

If the ticket is declined, the fallback is `4.0.1` (the only clean 4.0.x
number) or `4.1.0`. Either needs exactly three edits: root
`package.json#version`, the `## 4.0.0` heading in `CHANGELOG.md`, and a
re-tag. Nothing in the pipeline needs to change.

## Verification checklist for the next release attempt

Run all of these locally BEFORE pushing a tag — each one mirrors a CI
gate that has failed at least once:

```bash
# 1. publish.yml parses (4 runs died on YAML parse errors)
node -e "const y=require('yaml');const d=y.parse(require('fs').readFileSync('.github/workflows/publish.yml','utf8'));console.log('OK',d.jobs['trusted-publish'].steps.length,'steps')"

# 2. bump resolves as intended (back up manifests first, restore after)
node ./scripts/bump-version.mjs --to <version>

# 3. subpackage target numbers are free on the registry
npm view peaks-loop-shared@<next> version   # empty = free

# 4. release-notes gate finds a non-empty body
awk -v ver="<version>" 'BEGIN{s=0} /^##[[:space:]]+/{if(s)exit; if($0 ~ "^##[[:space:]]+" ver "[[:space:]()]" || $0 ~ "^##[[:space:]]+" ver "—"){s=1;next}} s{print}' CHANGELOG.md | wc -c

# 5. root version is not tombstoned (see the curl probe above)
```

## Cross-references

- `2026-07-30-4-0-0-ga-attempted-not-published-sediment.md` — the prior
  session's honest tally. Its claim that the LLM cannot read Actions
  logs is **superseded**: `gh run view --log-failed` works with the
  58309 proxy.
- `peaks-unpublish-4-0-0-and-4-0-2-stuck.md` — the 07-22 unpublish that
  created the tombstone.
- `peaks-loop-publishing-critical-hard-rules.md` — publish hard rules.
- `proxy-127.0.0.1-58309.md` — the proxy that makes `gh` work.
