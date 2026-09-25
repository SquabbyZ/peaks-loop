---
name: a-self-check-whose-file-set-comes-from-the-diff-covers-neither-agent-s-window
description: A self-check scoped to the diff rather than the commit can fall in neither agent's window when the slice's files are uncommitted
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-25-session-0cf437/rd/rid-4134eb10-repair-2.md
---

An RD reported "eslint + prettier --check clean **on the new test file**" — singular. The commit was then
**refused by the pre-commit ratchet**, which requires a new file to be clean outright:

```
✗ NEW file tests/unit/scripts/write-package-dist-stamps-cli.test.ts has 3 lint finding(s).
  First: @typescript-eslint/no-unsafe-assignment at 134:11 — Unsafe assignment of an `any` value.
```

**The slice had produced TWO new files**, both with **zero commits** — `git log` is empty for each, because
the slice was not committed yet. So:

- the RD's check enumerated the files it had **just added** (its diff), not the files the slice **owns**;
- the second file was already present when that repair began, so it was in **neither** the repair's window
  nor the reviewing agent's.

**The mechanism, stated once:** a self-check whose file set comes from the **diff** is answering "what did
I just change?" — while the gate is answering "what does this commit contain?". When the slice's files are
**uncommitted**, those two sets differ, and a file that arrived in an earlier sub-task of the same slice
belongs to neither.

**How to apply.**

- Enumerate from **`git status`** (the slice's actual touched set), not from your own diff, and report the
  list. "I ran it on the file I changed" does not answer "is this slice clean".
- The same trap applies to **reviewers**: a QA agent that reads the claim instead of enumerating the files
  will repeat it. (In this case QA had made no such claim — `grep -ci eslint` over both its reports was
  **0** — and the RD was right to check rather than agree when told otherwise.)
- A **new** file is held to the strictest standard ("clean outright"), so the one you did not enumerate is
  the one most likely to be refused.

**Related, and this session hit it three times in one day:** the failure is always a claim about a
**whole** supported by a check over a **part**. See
[[calling-a-finding-pre-existing-without-consulting-a-prior-is-recognition-not-measurement]] (a prior
never consulted) and
[[a-count-of-new-tests-is-meaningless-until-both-sides-of-the-subtraction-cover-the-same-file-set]] (two
sides of a subtraction covering different file sets).

**And the corollary the same slice demonstrated twice:** an OK is only meaningful if you showed the gate
can **refuse**. The repair's own control put the untyped line back and confirmed the ratchet refuses with
the identical three findings; a separate arm proved a test really **spawns** the gate by moving the gate
away and watching exactly the gate-spawning cases fail.
