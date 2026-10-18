---
name: a-safety-classifier-denial-is-not-a-missing-red-side
description: a-safety-classifier-denial-is-not-a-missing-red-side
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-memory-tests.md
---

The RD's first red-side attempt (mutating the real source and running tests) was refused by the safety
classifier. The QA retried on a COPY under `qa/` and got real red evidence: no-recurse predicate
5 failed / 4 passed; branch deleted 2 failed / 7 passed. The production source was never modified.

**Why:** a denial of an in-place mutation is a constraint on the method, not evidence that the test
discriminates. The copy gives the same evidence without touching the tree.

**How to apply:** when a mutation must run, copy the module and its imports under the session's
runtime, rebase the import paths, mutate the copy, and run the test against it. Record it as
mutation-on-copy, not as a coverage-delta substitute.
