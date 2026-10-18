---
name: a-refusal-must-name-the-artifact-it-refused
description: a-refusal-must-name-the-artifact-it-refused
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lintgate.md
---

`LintGateError` said "6 lint error(s) found in artifact." with no path, while the sibling
`request lint` command's envelope carried `path`. The two commands lint the same artifact; only one
told the reader which one. The refusal path had `lintReport.path` in hand and dropped it.

**Why:** a refusal is the moment a reader needs the target's identity most. "In artifact" is
undiagnosable without grepping the session directory, and it makes the two commands disagree about
what they linted.

**How to apply:** carry the target path/id on the error object and in the CLI `data`, even when the
sibling command already prints it. Test the message and the data.
