---
name: an-ignored-message-is-a-skip-not-a-finding
description: an-ignored-message-is-a-skip-not-a-finding
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lintpop.md
---

The report parser counts a `File ignored` message as an `ignoredFile`, not a finding. A dot-path scope
takes `--no-ignore` so it is actually examined. The default scope never takes that branch.

**Why:** eslint's "ignored" is the tool telling you it did not look. Counting it as a finding would
report a phantom violation; ignoring it silently is the defect §2.41 records.

**How to apply:** separate examined from skipped in the parser and in the envelope. Add `--no-ignore`
only when the caller explicitly named a path eslint would otherwise skip.
