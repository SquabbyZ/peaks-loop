---
name: validate-metadata-with-the-readers-own-rule
description: validate-metadata-with-the-readers-own-rule
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lint.md
---

The lint's new `- type:` check uses `isRequestType`, and its `- state:` check uses
`allowedStatesForRole(role)` — the same functions the readers use. It does not restate the six types
or the per-role states as a second literal.

**Why:** a second vocabulary drifts. The reader trims lines, takes everything after `type:`, and
accepts only exact lowercase tokens; a lint regex with `/i` or a copied list would disagree on a value
and produce a green lint over an artifact the reader defaults.

**How to apply:** when validating a field a reader parses, import the reader's predicate. If the
predicate lives behind a boundary the lint cannot cross, arm the pair with a parity corpus instead of
copying.
