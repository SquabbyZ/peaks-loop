---
name: guards-that-enumerate-git-ls-files-have-an-untracked-pair-window
description: Guards that enumerate git ls-files have an untracked-pair window
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-24-session-b714c7/txt/handoff.md
---

A guard whose file list comes from `git ls-files` cannot see an **untracked** file. So for a brand-new file (or a
new `.mjs` + `.d.mts` pair) it is **green on the working tree and red only on the commit that tracks it** — its
green means nothing until the files are staged, and its red arrives too late to be acted on inside that commit.

Measured in `rid-muf2sasw` (`qa/rid-muf2sasw-qa-report-cycle3.md:148-191`, and `sc/commit-msg.txt:60-65`):
`tests/unit/lint/eslint-rules-config-coverage.test.ts:196` is
`execFileSync('git', ['ls-files'])` filtered by `CODE_EXT ∧ SCOPE_DIRS`. Under the pre-fix config it reported
`missing: []` for the tracked set and `missing: ["scripts/packages-build-prerequisite.mjs"]` for the set that
*would be tracked at commit* — the fix was to stage and verify, not to trust the working-tree run. Its assertion
count is not evidence about untracked files either: the same `CODE_EXT ∧ SCOPE_DIRS` predicate leaves
`vitest.config.ts` invisible, so "the coverage test passes" never meant "the config edits were checked".

The remedy the RD proposed and the session could not land — add
`git ls-files --others --exclude-standard` to the enumeration — lives only in
`rd/rid-muf2sasw-repair-2-handoff.md` §6.2 and §8 item 3, and `.peaks/_runtime/` is gitignored, so it dies with
the session.
Any guard you write that uses `git ls-files` needs this sentence next to it.
