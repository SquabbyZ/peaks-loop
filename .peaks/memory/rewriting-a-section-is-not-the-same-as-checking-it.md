---
name: rewriting-a-section-is-not-the-same-as-checking-it
description: Rewriting a section is not the same as checking it
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-f-group.md
---

A reference file was rewritten to correct a mechanism name (`mustContainAny` → `legacyRelativePaths`).
Four occurrences survived — and one of them was **inside the section that was rewritten**. The author
had, in the same commit, corrected the identical error in the source file, then rewritten the doc
section, and the rewrite propagated the old name forward because it was working from that section's
existing text.

**Why:** "I went through this file" feels like completion, and rewriting is the most thorough-feeling
of the edits. But a rewrite reproduces whatever the source text said unless something forces a
comparison — and the very act of rewriting makes the area feel audited.

**How to apply:** when a fact changes, change it by **searching for the fact**, not by editing where it
was noticed. Grep the old and new forms across the whole tree and reconcile the counts, then have the
doc's own text read back against the source it summarises. A rewritten section needs a second pass
precisely because it looks finished.
