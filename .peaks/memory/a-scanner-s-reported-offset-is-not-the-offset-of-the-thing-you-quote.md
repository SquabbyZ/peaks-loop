---
name: a-scanner-s-reported-offset-is-not-the-offset-of-the-thing-you-quote
description: a scanner's reported offset is not the offset of the thing you quote
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-t1-backlog-2026-10-23.md
---

Measured 2026-10-23 (T1 backlog campaign, `rid-t1-ide-payload-cwd`). The repository's own
`scripts/lint/scan-binary-strings.mjs` prints `true_offset + needle.length + window` — the position of
the END of the needle plus the context window, not the position of the needle. A slice published those
numbers as the byte offsets of the binary strings it quoted. QA tried to resolve each published offset
to the text it was attached to and could not: every number pointed past the text. The correction was to
locate the bytes independently with `Buffer.indexOf` over the whole file, which yields the true offset.
Five of the earlier published numbers did not reproduce at all and were DROPPED rather than adjusted.

**Why.** An offset that does not resolve is worse than no offset. It makes the artifact look
machine-verified when it is not, and a reader who tries to reproduce it concludes the measurement was
fabricated — which is a different and much worse claim than "this was not measured".

**How to apply.** When an artifact publishes a byte offset, publish the TOOL that produced it and
confirm the tool's formula is the offset of the quoted bytes, not a derived number. If the only tool
available prints a derived number, compute the true offset separately and say how. If a number cannot be
reproduced, drop it: a smaller artifact with true numbers beats a larger one with plausible-looking
wrong ones.
