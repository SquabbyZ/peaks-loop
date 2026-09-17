---
name: an-exemption-keyed-on-a-name-is-a-hole-one-keyed-on-a-rule-is-a-boundary
description: An exemption keyed on a name is a hole; one keyed on a rule is a boundary
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-e-group.md
---

A new guard asserts that every `package.json#files` entry resolves. Some entries cannot be asserted —
`dist/**` is generated and gitignored, so a fresh checkout legitimately lacks it. The exemption is
keyed on **the rule** (does the entry's literal prefix match the root `.gitignore`?), not on the name
`dist`. The control that proves the difference: the *same* absent path, `dist/never-built/index.js`
versus `src/never-built/index.js`, is silent in the first case and **reported** in the second.

**Why:** an exemption list keyed on names grows by accretion and can never be audited — each entry
looks equally deliberate, and nothing distinguishes "legitimately absent" from "typo a previous
author whitelisted". A rule can be read, quoted, and disagreed with; a name can only be obeyed.

**How to apply:** when a check must skip something, express the skip as a property the skipped thing
**has** (it is gitignored; it is generated; it is a negation) and then test the property on a case
that shares the name but not the property. If no such case exists, the "rule" is a name wearing a
rule's clothes.
