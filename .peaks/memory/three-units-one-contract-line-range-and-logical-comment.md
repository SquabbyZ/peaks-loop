---
name: three-units-one-contract-line-range-and-logical-comment
description: three-units-one-contract-line-range-and-logical-comment
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-bdd.md
---

`verifyBddStyle` had three candidate units for "the body must start with exactly these 3 leading
comments": source LINES (what the code counted), TypeScript comment RANGES (4 for a wrapped
`given:`), and logical COMMENTS (what the contract meant). The line reading refused a wrapped
`given:` and accepted five comments; the range reading would also miscount a wrapped comment. The
contract's own noun — "comments" — was the right unit, and a hanging-indented continuation is part of
its keyword comment.

**Why:** a checker can be wrong in both directions when its unit is not the contract's noun. Measured
over 319 files, the old reading refused 57 % of the suite.

**How to apply:** find the contract's noun and implement that. If the contract says "comments", do not
count lines or AST ranges; define what makes two physical pieces one logical comment and state it.
