---
name: peaks-evidence-generate-overwrites-the-real-evidence-with-a-scaffold
description: peaks evidence generate overwrites the real evidence with a scaffold
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-29-session-b7cf21/txt/handoff.md
---

`peaks evidence generate --rid <rid> --files … --line-counts …` writes the ~11 rd/qa/audit/prd
evidence artifacts **over existing files, without warning**. Measured on
`2026-09-29-session-b7cf21`, 2026-10-01: four sub-agents had produced genuine envelopes totalling
53 KB for one rid — security 18,563 B, test-reports 12,673 B, perf 13,923 B, code-review 11,135 B.
One generator run replaced them with 239 B, 350 B, 226 B and 1,962 B stubs, and rewrote the PRD
capsule so its `goals: []` was empty. Nothing in the envelope reported the destruction; the
`nextActions` line read "Wrote 12 evidence files", which is true of a demolition.

The trap is that the pipeline gate then goes green, because the prereq checks are substring checks
(`mustContain: ['schemaVersion: 2', 'sha256:']`, `'## Findings'`, `'CRITICAL'`) and the scaffold
carries the markers. So the artifact that exists to prove a review happened can be replaced by a
file whose only property is that it mentions review.

**How to apply:** back up `.peaks/_runtime/<sessionId>/{prd,rd,qa,audit}` before any
`evidence generate`, and compare byte sizes after — a 20 KB envelope that becomes 239 B is the
finding, not the gate result. Prefer `peaks prd handoff init --body @<file>` for the capsule (it
computes the sha256 over the body you gave it instead of writing an empty one), and add the
required markers to the real artifacts by hand when the prose is already better than the scaffold.
A sha256 in a handoff frontmatter is worth exactly what its verifier checks: the security and perf
services hash the body and refuse on mismatch, so confirm the lock validates
(`createHash('sha256').update(body).digest('hex')`) rather than assuming a written field is a lock.
