---
name: peaks-release-4-0-2-published
description: "2026-07-22 publish run — git tag v4.0.1 but npm landed 4.0.2 because publish.yml ran `pnpm changeset version` which overrode the committed pin"
metadata:
  type: feedback
---

<!-- peaks-feedback-promoted: layer=A -->

# peaks-loop 4.0.2 — accidental publish (2026-07-22)

2026-07-22 published `peaks-loop@4.0.2` + 8 subpackages. The git tag I
pushed was `v4.0.1`, but npm ended up with `4.0.2` — `.github/workflows/publish.yml`
runs `pnpm exec changeset version` conditionally before publish, and
that step apparently re-derived the next semver bump (`4.0.2`) from
the manifest history rather than honoring the literal pin in
package.json. Concretely:

| source                         | version  |
| ------------------------------ | -------- |
| git tag `v4.0.1`                | 4.0.1   |
| package.json on disk (pinned)   | 4.0.1   |
| npm after publish workflow     | 4.0.2   |

Root cause hypotheses (not yet verified inside the workflow log):

1. `pnpm exec changeset version` sees no `.changeset/*.md` (the user
   had run it earlier and consumed the only one), but `changeset
   status` may still report a pending bump because the package.json
   was bumped by hand from `4.0.0` to `4.0.1` without a changeset
   to anchor the bump — so version bumps to a derived "next"
   version, then publishes it.
2. The "registry-repair" carve-out in publish.yml (when no `.changeset`
   files exist, skip the bump and use committed manifests) may have
   silently been defeated by a hidden `.changeset/*.md` file (e.g.
   a leftover from a prior release) that the workflow detected.

Either way: when manually bumping to a registry-repair pin, the
operator MUST either (a) add a no-op `.changeset/*.md` so the bump
path is honored, or (b) use the `workflow_dispatch` input with
`--i-have-reviewed` to bypass the changeset step entirely. The
plain `git push tag` path is **not** guaranteed to publish the
literal pinned version.

**Why:** Future releases must decide explicitly: want "publish
whatever is in package.json" → use a `/workflow_dispatch` run with
the manual bump path; want "let changesets drive the version" →
land a `.changeset/*.md` first and never hand-pin package.json.
The two paths are mutually exclusive.

**How to apply:** When you see `peaks -v` showing a different
version from the git tag you just pushed, suspect changesets first
— read `.github/workflows/publish.yml` lines around
`pnpm exec changeset version` for the conditional.

Verified npm-published versions (2026-07-22):
- peaks-loop@4.0.2
- peaks-loop-shared@0.0.10
- peaks-loop-audit-independent@0.0.6
- peaks-loop-crystallization@0.0.7
- peaks-loop-doctor@0.0.6
- peaks-loop-final-review@0.0.6
- peaks-loop-mut@0.1.0
- peaks-loop-shared-channel@0.0.5
- peaks-loop-job-snapshot@0.0.5

## Surfaced automatically by sub-agent memory preflight (since 4.1.0)

For future sessions: peaks-code orchestrator's
`MemoryPreflightService` surfaces the feedback/layer-A entries (this
one is layer A) automatically into the sub-agent's system prompt on
every dispatch, with a hard 1.2k-token ceiling enforced by headroom-ai.
You do not need to navigate into this memory manually anymore — the
dispatch brief will carry the relevant lessons ahead of your next
publish.
