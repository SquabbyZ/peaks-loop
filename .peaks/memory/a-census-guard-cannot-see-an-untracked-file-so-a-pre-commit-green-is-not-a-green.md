---
name: a-census-guard-cannot-see-an-untracked-file-so-a-pre-commit-green-is-not-a-green
description: this repo's census guards walk `git ls-files`, so a new file is invisible to them until it is committed — a full-suite green taken before the commit is a green about a tree that does not exist yet; observed twice in one session, the second time after the rule had been written down
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-06-session-d0d50d/sediment-backlog.md
---

The lint ratchet's census legs enumerate their subject with `git ls-files`. A file that exists but is
**untracked** is therefore not merely omitted — it is invisible, and every guard that would have
complained stays green.

Observed twice on 2026-10-06, one session, same shape:

1. Slice `23f9d873` added 4 files. Both the RD sub-agent's report and the orchestrator's independent
   re-run of `pnpm test:unit` came back green. The commit made the files tracked; the next run had
   **3 failing guard files** (`file-size-cap.test.ts`, `scope-shadow-coverage.test.ts`,
   `eslint-rules-config-coverage.test.ts`). Remediated in `f8073e1f`.
2. Slice `33fdefdf` added 3 files. The orchestrator's full-suite re-run — taken **before** the commit
   — was green again. The commit made them tracked; the next run had **3 failing guard files**,
   the same class. Remediated in `b88c4056`. These were the same guards that had gone red an hour
   earlier, and the rule had by then been written into this session's own sediment backlog.

The second instance is the interesting one: the rule was known, written down, and restated, and the
practice did not change. Writing a lesson down is not the same as changing what you do, and a
documented-but-unpractised rule is exactly the kind of artifact this repo's diagnosis calls a proxy
that was never checked again.

**The operational rule.** A slice's acceptance run must be taken with its files **committed**, or the
run must state out loud that it was taken in the untracked state. Prefer the former. When a guard
goes red only after a commit, look first at what the commit made visible rather than at what the
commit changed.

**Related, and worth knowing before touching an over-cap file:** `tests/unit/standards/file-size-cap.test.ts`
asserts the published `fileSizeExcessLines` **equals** the live census exactly. Any net line growth in
a file that is over the cap therefore breaks six assertions across four files, in either direction —
which is why a slice editing such a file ends up net-zero and puts its new logic in an under-cap
module.
