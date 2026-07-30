---
name: 2026-07-30-4-0-1-published-tombstone-resolution
title: 4.0.1 GA published — the 4.0.0 tombstone, and how the pipeline was actually fixed
description: Closure record for the 2026-07-30 GA release. Supersedes both earlier 4.0.0 sediments. peaks-loop@4.0.1 is live with 15/15 steps green and full registry verification. Documents the tombstone proof, the real pipeline root cause, and the diagnostic method that broke a 3-hour deadlock.
kind: project
---

# 4.0.1 GA published — tombstone resolution (locked 2026-07-30)

## Outcome

`peaks-loop@4.0.1` is **live on npm**. Run `30554113818`, commit
`7c386d8b`, tag `v4.0.1`. All 15 steps green.

Registry-verified (not just "the workflow said success" — see hard rule
4 in `peaks-loop-publishing-critical-hard-rules.md`):

```
peaks-loop              dist-tags.latest = 4.0.1
peaks-loop-shared       latest = 0.0.29   CLI_VERSION = "4.0.1"  (no lag)
peaks-loop-mut          latest = 0.1.3
peaks-loop-shared-channel latest = 0.0.8
workspace:* leak in published manifest = none
```

## Part 1 — the pipeline bug (fixed, commit `24b0ddeb`)

`publish.yml` step "Auto-bump version per smallest-semver policy" had
only two branches: `workflow_dispatch` INPUT_TARGET, or default patch+1.
Pushing tag `v4.0.0` with root `package.json#version` already `4.0.0`
fell through to the default and bumped **4.0.0 -> 4.0.1**. Two steps
later: `no CHANGELOG entry for 4.0.1 in root CHANGELOG.md`.

The AC7 idempotency guard did not catch it — that guard only no-ops when
the local version equals `dist-tags.latest`, which was `4.0.0-beta.36`.

This exposed an internal contradiction: the downstream `gate-tag-version`
step already treats the tag as authoritative and would have failed on
`tag=v4.0.0` vs `version=4.0.1`. Auto-bump was disagreeing with a gate
six steps below it.

Three fixes:

1. **publish.yml** — bump target priority is now INPUT_TARGET -> exact
   HEAD tag -> patch+1. A pushed `v<x.y.z>` tag is used verbatim.
2. **bump-version.mjs** — an explicit `--to` equal to the current root
   version is no longer `exit 1`. That is the normal shape of a planned
   GA. Root manifest untouched; subpackages still bumped in lockstep
   (AC6 / rid-015) so no tarball ships a stale `workspace:*` pin.
3. **subpackage baselines** — raised to match what was already on the
   registry, so the CI bump lands on free numbers.

## Part 2 — the 4.0.0 tombstone (unfixable; shipped as 4.0.1)

Even with the pipeline fixed, 4.0.0 could not be published:

```
npm error 400 Bad Request - PUT https://registry.npmjs.org/peaks-loop
  - Cannot publish over previously published version "4.0.0".
```

4.0.0 was published 2026-07-22 and unpublished (see
`peaks-unpublish-4-0-0-and-4-0-2-stuck.md`). npm permanently reserves
unpublished version numbers to prevent supply-chain substitution:
someone who already installed 4.0.0 must never receive different bytes
under the same number. Policy: https://docs.npmjs.com/policies/unpublish

**The npmjs.com UI cannot show this.** Its version list renders only
live versions, so an unpublished version looks identical to one that
never existed. The user reasonably read "4.0.0 not in the list" as "the
number is available". It is not.

### Proving a tombstone (the `time`-entry probe)

The registry metadata is authoritative. A version that was never
published has **no `time` entry**; a tombstoned one keeps its original
publish timestamp:

```bash
curl -s https://registry.npmjs.org/<pkg> -o ./reg-tmp.json
node -e "
const j=JSON.parse(require('fs').readFileSync('./reg-tmp.json','utf8'));
for(const v of process.argv.slice(1))
  console.log(v, j.versions[v]?'PRESENT':'ABSENT', j.time?.[v]||'(no time entry)');
" 4.0.0 4.0.1 4.0.2
rm -f ./reg-tmp.json
```

Observed:

| version | in `versions` | in `time` | verdict |
|---|---|---|---|
| 4.0.0 | ABSENT | `2026-07-22T02:50:41.226Z` | **tombstoned** |
| 4.0.1 | ABSENT | *(none)* | free |
| 4.0.2 | ABSENT | `2026-07-22T01:53:48.127Z` | **tombstoned** |

**Windows gotcha:** do not write the probe file to `/tmp` — Git Bash and
Node disagree on that path (Node resolves it to `C:\tmp\...`). Use `./`.

### The differential that ruled out every config explanation

Run `30551690056` **successfully published all three subpackages** and
was refused only on the root package — same workflow, same OIDC
credential, same `npm publish` code path, same run:

```
[release-pack] publishing peaks-loop-shared@0.0.28    -> OK
[release-pack] publishing peaks-loop-mut@0.1.2        -> OK
[release-pack] publishing peaks-loop-shared-channel@0.0.7 -> OK
[release-pack] publishing peaks-loop@4.0.0            -> 400 Cannot publish over...
```

A token / trusted-publisher / network / workflow-syntax fault would have
failed all four. Reproduced a second time via `workflow_dispatch`
(run `30553156841`) with a byte-identical error.

**This differential is the general technique:** when one item in a batch
fails and its siblings succeed under identical conditions, the cause is
specific to that item, not the environment. Reach for it before
theorising about config.

## Part 3 — the diagnostic lesson (most reusable takeaway)

The prior session burned 8 runs / ~3 hours / ~$130 guessing at root
causes (YAML parse, pnpm/action-setup, Node 20/24). Those were real bugs
and were fixed, but run #101 had already reached **step 14 of 15** — the
prior sediment recorded it as "failed: unknown" and stopped.

That sediment claims "the session LLM does not have a way to read GitHub
Actions step logs" and that the user must paste them manually.
**This is false and cost hours.** `gh` works; it just needs the proxy
from `proxy-127.0.0.1-58309.md`:

```bash
export HTTPS_PROXY=http://127.0.0.1:58309 HTTP_PROXY=http://127.0.0.1:58309
gh run list --workflow=publish.yml --limit 5
gh run view <run-id> --log-failed      # the real ::error:: line
gh run watch <run-id> --exit-status --interval 15
```

Earlier playwright attempts failed because the Actions log viewer renders
client-side; `--log-failed` hits the API and returns plain text. One call
produced the exact error string that three hours of guessing had not.

**Rule: on any CI failure, run `gh run view <id> --log-failed` FIRST.
Never commit a fix before reading the actual error line.**

## Pre-push checklist for the next release

Each item mirrors a CI gate that has failed at least once:

```bash
# 1. target version is not tombstoned (see the time-entry probe above)

# 2. publish.yml parses (4 runs died on YAML parse errors)
node -e "const y=require('yaml');const d=y.parse(require('fs').readFileSync('.github/workflows/publish.yml','utf8'));console.log('OK',d.jobs['trusted-publish'].steps.length,'steps')"

# 3. subpackage target numbers are free — check the NEXT number, since
#    bump-version increments from the local baseline. If a prior run
#    published subpackages before failing, raise the local baselines to
#    match the registry or the next run collides.
npm view peaks-loop-shared@<next> version   # empty output = free

# 4. simulate the bump (back up manifests, restore after)
node ./scripts/bump-version.mjs --to <version>

# 5. release-notes gate returns a non-empty body
awk -v ver="<version>" 'BEGIN{s=0} /^##[[:space:]]+/{if(s)exit; if($0 ~ "^##[[:space:]]+" ver "[[:space:]()]" || $0 ~ "^##[[:space:]]+" ver "—"){s=1;next}} s{print}' CHANGELOG.md | wc -c

# 6. CLI_VERSION parity — regenerate AND rebuild, or tests fail with
#    "Cannot find package 'peaks-loop-shared/version'"
node ./scripts/sync-version.mjs && pnpm --filter peaks-loop-shared build

# 7. after publish, verify the REGISTRY, not the workflow's exit code
npm view peaks-loop dist-tags --json
```

## Cross-references

- `2026-07-30-4-0-0-ga-attempted-not-published-sediment.md` — the 8-run
  attempt. Its "LLM cannot read Actions logs" claim is **superseded**.
- `2026-07-30-4-0-0-publish-root-cause-fixed-blocked-on-tombstone.md` —
  the interim record written before 4.0.1 shipped.
- `peaks-unpublish-4-0-0-and-4-0-2-stuck.md` — the 07-22 unpublish that
  created the tombstone.
- `peaks-loop-publishing-critical-hard-rules.md` — publish hard rules;
  rule 4 (verify the registry, not the workflow) applied here.
- `proxy-127.0.0.1-58309.md` — the proxy that makes `gh` work.
