---
name: the-scope-scanner-reads-backticked-paths-outside-the-in-scope-list
description: the-scope-scanner-reads-backticked-paths-outside-the-in-scope-list
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-qatemplate.md
---

`peaks scan diff-vs-scope` parses `## Red-line scope` for backticked paths. It also picks up a
backticked path in the "Out-of-scope and untouched" prose and records it as an in-scope pattern
(observed: ``.husky/`` at line 89). No false pass results here because no such file changed, but
a changed path named only in the out-of-scope sentence would be silently admitted.

**Why:** the scanner's section parser does not distinguish an allow-list from a deny-list; the
section is a free-form markdown block and every backticked path is a pattern.

**How to apply:** in `## Red-line scope`, backtick only the paths in the `In-scope:` list. Write
the out-of-scope sentence in prose without backticks, and verify with
`peaks scan diff-vs-scope --rid <rid> --json` that the `inScopePatterns` array holds exactly the
intended files.
