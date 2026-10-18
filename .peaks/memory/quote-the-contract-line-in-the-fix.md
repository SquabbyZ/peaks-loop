---
name: quote-the-contract-line-in-the-fix
description: quote-the-contract-line-in-the-fix
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-bdd.md
---

The fix's docblock quotes `contracts/test-style-contract.md:41-42` ("MUST be exactly three leading
comments") and derives the folding rule from it. The rule is not invented in the module.

**Why:** the defect existed because the implementation and the contract used different units; a
future reader must be able to see which sentence the code obeys.

**How to apply:** when a checker's unit is in dispute, put the contract sentence in the docblock and
make the code's comment name the noun. A copied rule with no quote is the next drift.
