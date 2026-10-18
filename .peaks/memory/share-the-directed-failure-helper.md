---
name: share-the-directed-failure-helper
description: share-the-directed-failure-helper
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-rootdist.md
---

The remediation sentence lives in one helper (`tests/unit/_setup/root-dist-prerequisite.ts`) and the
two consumers use it; the approximate build cost is stated in the helper's header, not re-explained
in each test.

**Why:** the statusline suite had the sentence inline; the tarball suite had nothing. A shared helper
makes the next root-`dist/` consumer inherit both the message and the cost rationale.

**How to apply:** when two tests share a prerequisite, extract the existence check plus the
remediation sentence; keep the cost decision in the helper's docblock.
