---
name: comments-after-executable-code-are-not-contract-bound
description: comments-after-executable-code-are-not-contract-bound
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-bdd.md
---

The "exactly three leading comments" rule is enforced only BEFORE the first executable line. Comments
after code are permitted, because the contract constrains the leading region and says nothing about
the rest of the body. The verifier stops scanning at the first executable line.

**Why:** enforcing a rule where the contract is silent would refuse legitimate test bodies.

**How to apply:** scope a style rule to the region its contract names. When the contract is silent,
record the scoping decision rather than inventing a stricter rule.
