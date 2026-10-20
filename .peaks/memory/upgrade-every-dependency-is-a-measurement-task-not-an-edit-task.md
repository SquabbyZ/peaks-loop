---
name: upgrade-every-dependency-is-a-measurement-task-not-an-edit-task
description: "upgrade every dependency" is a measurement task, not an edit task
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-20-session-a545d0/txt/handoff.md
---

The instruction was to move every non-internal production dependency to the newest release in its current major. Measured against the registry, three of the eight were already there — `commander ^12.1.0` (12.x latest), `fzf ^0.5.2`, `@colbymchenry/codegraph 1.6.2` — so only five manifests changed. Bumping all eight would have produced a larger diff, a longer review, and no behavioural difference.

Two follow-ons worth keeping. First, an in-major bump does not remove a stale transitive: `picomatch@4.0.4` still resolves in the lockfile because `vitest@4.1.10` pins it, and that package is itself locked by a standing decision. Say so explicitly, or the next audit reads it as a missed bump. Second, the runtime pin can live in source, not only in the manifest — `OCR_18_PACKAGE` hardcodes the npx spec, so a manifest-only bump leaves the actual runtime on the old version while the lockfile and every dashboard report the new one.

The check is `npm view <pkg> versions --json` filtered to the current major, plus a grep for the package name across `src/` for a second hardcoded pin.

Related: [[an-installed-build-whose-version-string-matches-the-worktree-can-still-be-missing-every-new-file]], [[a-count-of-new-tests-is-meaningless-until-both-sides-of-the-subtraction-cover-the-same-file-set]].
