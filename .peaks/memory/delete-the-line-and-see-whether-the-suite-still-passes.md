---
name: delete-the-line-and-see-whether-the-suite-still-passes
description: Delete the line and see whether the suite still passes
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff.md
---

AC6's linchpin — `await browser.close()` — had **zero coverage**: deleting it left all 129 tests
green. It was found by a reviewer mutating one line, not by reading coverage.

**Why:** a green suite says the assertions hold, not that they assert what the acceptance criterion
needs. The gap is invisible from the test output.

**How to apply:** for each acceptance criterion, identify the one line that makes it true and
actually delete it — the test suite must fail. If it does not, the criterion is unguarded no matter
how many tests pass.
