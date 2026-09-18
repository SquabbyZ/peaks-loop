---
name: verifying-with-a-command-ci-does-not-run-is-not-verification
description: Verifying with a command CI does not run is not verification
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-f-group.md
---

A published contract's path was changed, and the change was "verified" with `npm pack --dry-run`. The
repository's publish workflow does not use `npm pack`: it uses **`pnpm pack`** to build the tarball and
`npm publish <tarball>` to ship it. The two happened to agree here — but that was luck, and the
verification would have reported success either way.

**Why:** the local command and the CI command are usually the same, so substituting one is invisible;
where they differ, they differ in exactly the area under test (packaging, path resolution, workspace
handling). And nobody re-reads the workflow to check, because "I ran the packer" already sounds like
the check.

**How to apply:** for anything whose truth is decided by CI — packaging, publish, release, matrix
behaviour — read the workflow and run **its** command, not the nearest equivalent. If the two are
different, run both and say so. This is the same failure as running a test suite that CI excludes: the
green is real, the coverage is not.
