---
name: when-the-file-is-at-the-cap-the-comment-is-the-code
description: when-the-file-is-at-the-cap-the-comment-is-the-code
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lintgate.md
---

`request-artifact-state-helpers.ts` is capped at 300 raw lines and the new `path` field pushed it to
302. The fix removed a two-line doc comment, not code, to stay at 299. The field is live and tested;
the comment is gone.

**Why:** the repository's file-size ratchet is a hard gate, and a src file at the cap cannot grow. The
choice between a comment and the field was the field.

**How to apply:** when a change to a capped file needs room, split along an existing seam first. If a
one-line addition is all that remains, state in the handoff which comment was dropped and why the code
is unchanged.
