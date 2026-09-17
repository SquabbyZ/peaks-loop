---
name: a-slice-whose-premise-is-false-should-ship-the-measurement-not-an-implementation
description: A slice whose premise is false should ship the measurement, not an implementation
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-a3.md
---

A3 asked for a widening so that fenced code blocks would stop being invisible to the citation guard.
The measurement said there was nothing to widen: `findDanglingCitations` splits on lines and scans
backtick spans, so it never reads a fence. Backticked paths inside ` ``` ` / `~~~` / four-space-indented
blocks are all reported today, and a single-line control (same path, with and without backticks) reports
only the backticked one. Fences are transparent, not blind.

**Implementing the request as written would have shipped a commit claiming to fix a blind spot that
never existed** — the inverse of this repo's recurring defect, where a guard claims coverage it does
not have. Both are the same failure: a claim about behaviour that was never measured.

**How to apply:** make the first deliverable of a "we should also handle X" slice the measurement, and
say out loud that zero implementation is an acceptable outcome. Then the slice has somewhere to land
when X turns out to be fine. A structured measurement plan (M1: is the backticked case visible? M2: is
it the fence or the backticks that matter? M3: what is the gap's exact, decidable shape, and how many
corpus sites fall in it? M4: reconcile the counts) beats a spec, because each question can come back
"no". Accept a documented negative as a finished slice — otherwise the only way to have produced
something is to have invented the defect.
