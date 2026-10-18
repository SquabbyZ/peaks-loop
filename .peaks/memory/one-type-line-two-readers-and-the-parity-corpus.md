---
name: one-type-line-two-readers-and-the-parity-corpus
description: one-type-line-two-readers-and-the-parity-corpus
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-parity.md
---

`src/services/artifacts/request-artifact-metadata.ts` is the canonical `- type:` reader (trim;
hyphen bullet; whole value; `isRequestType`; LAST usable line wins). `.husky/pipeline/request-type-line.mjs`
reimplements that rule because the commit leg must load under bare `node` and cannot import `src/**`.
The two are held equal by the 9-case parity corpus in
`tests/unit/hooks/pipeline-verify-type-derivation.test.ts`, which drives BOTH readers over one body.

**Why:** the two used to differ on two `- type:` lines (first vs last), indentation, and `*` bullets —
the same carrier could select two prerequisite tables on one tree.

**How to apply:** change the rule in both places, or the parity arm reds. Do not "simplify" the husky
side by importing `src/**`: that reintroduces the stack trace the bare-node split exists to avoid.
The corpus's expected values are the src reader's, not a third rule.
