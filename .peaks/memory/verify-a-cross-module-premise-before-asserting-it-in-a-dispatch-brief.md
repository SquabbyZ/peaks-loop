---
name: verify-a-cross-module-premise-before-asserting-it-in-a-dispatch-brief
description: Verify a cross-module premise before asserting it in a dispatch brief
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff.md
---

Six times in one session I wrote a premise into a dispatch brief that I had taken from a report
rather than from the file, and an implementer then had to discover it was false. Examples: a
"guard test" cited in a tech-doc that had been deleted 500 commits earlier; "48/48 tests green"
read as "the feature works" when an untested module made all six commands fail on first use;
`windowsHide` recorded as fixed from a summary rather than from the file; RES-2's claim that
`playwright-loader.ts` "already resolves the pinned package" when it needed +92/−17 lines.

**Why:** a sub-agent's report is a claim about the past, and the artifact it describes may have
changed — or the report may be a rationalisation. The cost lands on whoever acts on it, and they
usually cannot see it was never verified.

**How to apply:** before writing any "X already does Y" premise into a brief, open the file. If you
cannot, label it explicitly as unverified and ask the implementer to confirm it first. When an
implementer reports a change, verify it at the source before relaying it as fact — especially when
relaying it to the user.
