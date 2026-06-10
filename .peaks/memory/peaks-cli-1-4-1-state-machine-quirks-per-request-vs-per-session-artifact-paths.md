---
name: peaks-cli-1-4-1-state-machine-quirks-per-request-vs-per-session-artifact-paths
description: peaks-cli 1.4.1 state-machine quirks (per-request vs per-session artifact paths)
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-10-session-6bcac7/txt/handoff-001-r003.md
---

peaks-cli 1.4.0+ state machine: `peaks request transition` for `rd` and `qa` roles expects artifacts at TWO path roots, not one. Per-request artifacts (e.g. `rd/requests/001-r003.md`, `qa/requests/001-r003.md`) live at `.peaks/_runtime/<sid>/<role>/...`. Per-session artifacts (e.g. `rd/tech-doc.md`, `rd/code-review.md`, `rd/security-review.md`, `rd/perf-baseline.md`, `rd/bug-analysis.md`, `qa/test-cases/r003.md`, `qa/test-reports/r003.md`, `qa/security-findings.md`, `qa/performance-findings.md`) live at `.peaks/<sid>/<role>/...` (without `_runtime/`). The `verify-pipeline` command checks the per-session paths. The slice.check command checks BOTH (retrospective/<rid>/ for code-review + legacy; per-request for tech-doc + request). When writing the same artifact to both paths (or copying with cp), the transition succeeds. When missing either, the transition fails with PREREQUISITES_MISSING + a clear list of which path is empty. The `state: "pass"` field on the QA artifact body is NOT the same as `state: "verdict-issued"` for the verify-pipeline check; update the field directly after the transition (or use a transition that sets the state field as a side effect). Affected skills: peaks-rd, peaks-qa, peaks-solo. Stable for memory: yes.
