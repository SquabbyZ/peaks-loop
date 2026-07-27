---
name: 2026-07-27-rid-017-publish-yml-release-ordering
description: rid-017 adds gh release create step + strict exact-match tag/version gate to publish.yml before npm publish; lessons on per-step permissions scope, awk Unicode regex, git describe --exact-match structural gate, and the rid-015 → rid-016 → rid-017 release-prep chain.
kind: project
---

# rid-017 — publish.yml release ordering + tag/version gate (2026-07-27)

## What changed
- Added a GitHub Release creation step using `gh release create` before npm publication in `.github/workflows/publish.yml`.
- Added a strict tag/version parity gate: the exact tag on `HEAD`, after stripping its leading `v`, must byte-equal root `package.json#version`.
- Kept changelog, README, GitHub Release, tag verification, and npm publication in an explicit pre-release order with no bypass for manually dispatched, untagged branches.
- The change was confined to one workflow file: `.github/workflows/publish.yml` grew by 132 lines, from 335 to 467 lines.
- Landed as one atomic commit, `d41828b2`, authored solely by SquabbyZ with no AI co-author trailer.

## Why
- npm publication must not proceed from an untagged commit or from a `v*.*.*` tag that disagrees with the post-bump root version.
- Creating the GitHub Release before npm publication makes the release metadata and source tag structurally available before registry mutation begins.
- The workflow required `contents: write` for release creation, but only that single step needed the expanded repository permission.
- rid-017 closes the publish sequencing follow-up recorded by [[2026-07-27-rid-015-monorepo-version-sync]] and follows the package simplification completed by [[2026-07-27-rid-016-monorepo-delete-5-subpackages]].

## Validation
- All RD §5 acceptance checks C-1 through C-9 passed; C-10 was deferred to peaks-qa by the SC specification.
- The workflow YAML parsed successfully and passed the complete 10-check acceptance matrix used for this mechanical refactor.
- AC-8 passed with write permission scoped only to the release-creation step.
- AC-14 passed: the commit contains 0 `Co-Authored-By:` lines.
- `.github/workflows/publish.yml` is 467 lines, below the 800-line `peaks scan file-size` cap.
- Session `2026-07-27-session-507e95`, job `2026-07-27-monorepo-release-followups`, finished 3/3 slices at gate `memory-sediment`.

## Sediment lessons

### Lesson 1 — `peaks job checkpoint --slice-id` takes the sliceId, not the rid label

The CLI expects the value from `state.json` at `slices[].sliceId`, such as `slice-001`, `slice-002`, or `slice-003`. It does not expect the user-facing request label such as `rid-015`, `rid-016`, or `rid-017`. This convention is established by `peaks job init` and was re-verified when rid-017 checkpointed `slice-003`. The runbook should state this explicitly. This reinforces the same lesson in [[2026-07-27-rid-016-monorepo-delete-5-subpackages]].

### Lesson 2 — Per-step `permissions:` gives release creation the minimum blast radius

`gh release create` requires `contents: write`. Following Karpathy §3 Surgical Changes, rid-017 granted `permissions: { contents: write, id-token: write }` only to the create-release step. The workflow-level permissions remained `contents: read` plus `id-token: write`. This satisfies AC-8 without granting every workflow step write access to repository contents.

### Lesson 3 — Use two alternations for Unicode beside POSIX character classes in awk

The first regex draft, `[[:space:]]|—|--|\(|$`, was malformed because the Unicode em dash, encoded as UTF-8 bytes, interacted badly with character-class parsing and `\(` has no useful escaping role inside `[...]`. The canonical no-PCRE awk pattern is a two-alternation form: keep safe single-byte members in `[[:space:]()]`, and place the literal `—` in a separate alternation outside the class. Do not mix Unicode literals into a POSIX character class when a separate alternation expresses the intent safely.

### Lesson 4 — `git describe --tags --exact-match HEAD` is the structural tag/version gate

A `v*.*.*` tag that disagrees with root `package.json#version` must fail the workflow, not warn. `git describe --tags --exact-match HEAD` exits non-zero when `HEAD` has no exact tag; when it succeeds, the tag with its leading `v` removed must byte-equal the root version. The failure uses the workflow's established `::error title=…::` style, matching the stale-changeset and CLI_VERSION parity gates. A manual `workflow_dispatch` from an untagged branch fails identically, with no bypass path.

### Lesson 5 — A mechanical single-file slice can use a much shorter dispatch chain

The rid-017 chain was PRD (15.7 KB) → RD (22 KB) → SC commit. There was no QA dispatch because no test surface changed, and no RD patch cycle. This is a Karpathy “Simplicity First” outcome for a mechanical refactor whose verification surface is YAML parsing plus a 10-check matrix. By comparison, rid-016 required 6 sub-agent dispatches, 1 patch cycle, and 1 re-verification. The workflow stayed the same while the dispatch depth matched the slice's actual complexity.

### Lesson 6 — Workflow files have an 800-line file-size cap

`peaks scan file-size` caps workflow files at 800 lines. The post-edit `.github/workflows/publish.yml` is 467 lines, so no file-size action was required. RD verified this during planning and correctly avoided adding a new file, top-level action, or job solely for structure.

### Lesson 7 — rid-015 → rid-016 → rid-017 is the complete pre-release preparation path

The three-slice job completed the 4.0.0 release-preparation loop in chronological order on `main`:

- rid-015: monorepo-wide subpackage version sync, commit `720a7e82`.
- rid-016: delete 5 pure-internal subpackages and fold them into `src/services/*`, commit `c56fdf32`.
- rid-017: publish workflow ordering plus exact tag/version gate, commit `d41828b2`.

All three commits are SquabbyZ sole-author and trailer-free. The next independent slice is rid-018: the actual 4.0.0 release tag and publish invocation in a fresh session.

## Commits
- `d41828b2 ci(publish): add GitHub Release step + tag/version gate before npm publish (rid-017)`

## Outstanding follow-ups
- rid-018: perform the actual 4.0.0 release tag and publish invocation in a fresh session.
- Update the job checkpoint runbook to say explicitly that `--slice-id` consumes `state.json`'s `slices[].sliceId`, not the rid label.
- peaks-qa retains C-10 verification responsibility under the SC specification.

<!-- peaks-memory:start -->
Related memories: [[2026-07-27-rid-015-monorepo-version-sync]], [[2026-07-27-rid-016-monorepo-delete-5-subpackages]] (sister sediment for rid-016 — same session, same job).
<!-- peaks-memory:end -->
