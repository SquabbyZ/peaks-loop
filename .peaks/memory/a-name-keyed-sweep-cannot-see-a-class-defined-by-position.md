---
name: a-name-keyed-sweep-cannot-see-a-class-defined-by-position
description: A name-keyed sweep cannot see a class defined by position
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-14-session-2f9323/txt/handoff.md
---

Two repairs to the same defect were each reviewed by their own instance and each left the class open. The
property was *"a bare prerequisite path presented as a current write target"*. The first repair swept four
patterns, all keyed on the artifact **name** or the token **`rid`**; the file that mattered,
`skills/bee/peaks-rd/references/v2-12-fanout-collapse.md:12,15`, presents `audit/security.md` and
`audit/perf.md` as current write targets and contains **zero** occurrences of `rid` — structurally invisible
to every pattern used.

**Why:** the search key was derived from the instances the reviewers happened to find, not from the property
being defended. A sweep can only find what its key can express.

**How to apply:** derive the subjects from the code that owns them (here, every `<rid>`-bearing
`relativePath` in `artifact-prerequisites.ts`), not from the names the instances carry; then key the check on
the property (here, write direction read off one line). Take the red run on the **real pre-repair text**
before editing anything, and confirm the failures are exactly the aimed sites with the other arms green. A
check that cites no reported site, rid or session id, and fires on a tree it never saw, is the difference
between closing a class and re-sweeping it next session.
