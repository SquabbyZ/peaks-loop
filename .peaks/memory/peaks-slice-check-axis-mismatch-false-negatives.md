---
name: peaks-slice-check-axis-mismatch-false-negatives
description: peaks slice check looks for review-fanout at change-id axis but artefacts live at session-id axis; report false negatives on review-fanout and gate-verify-pipeline stages
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-07-session-84feb7/txt/handoff-012-2026-06-07-fix-5th-session-runtime-writer.md
---

`peaks slice check` looks for review-fanout artefacts at the **change-id axis** (`.peaks/<changeId>/rd/{code-review,security-review,perf-baseline}.md`) but the actual artefacts live at the **session-id axis** (`.peaks/_runtime/<sessionId>/rd/...`) — same axis-mismatch root cause as the 5th session-runtime writer bug. On slice #012, the tool reported "Missing or empty: code-review, security-review, perf-baseline" and "RD evidence missing: Technical design doc (tech-doc.md)" (the latter is also a false positive for `type: bugfix` where `bug-analysis.md` is the correct artefact, not `tech-doc.md`).

**Why:** This produces false `boundaryReady: false` verdicts on the `review-fanout` and `gate-verify-pipeline` stages even when the slice is healthy. The `typecheck` and `unit-tests` stages have separate Windows-specific `npx.cmd` shell-resolution issues (see `peaks-slice-check-windows-typecheck-bug`) and the `--allow-pre-existing-failures` flag works around the unit-tests stage, but review-fanout + gate-verify-pipeline have no current workaround. The QA verdict=pass is the authoritative gate per the peaks-solo SKILL.md workflow, but the false negatives still show up in the report and confuse the user.

**How to apply:** Do NOT let `peaks slice check` red lights on the `review-fanout` or `gate-verify-pipeline` stages block handoff decisions. The QA sub-agent's `verdict-issued` transition (via `peaks request show --role qa`) is the authoritative gate. The `typecheck` and `unit-tests` stages on Windows have the additional `npx.cmd` shell-resolution bug — run `npx tsc -p tsconfig.json --noEmit` directly and trust the exit code; use `--allow-pre-existing-failures` for the unit-tests stage. Only the `review-fanout` (artefact presence) and `gate-verify-pipeline` (prerequisites check) stages are the axis-mismatch affected.

**Future fix:** Two parallel upstream changes needed:
1. The slice-check-service `runCommand` helper should pass `shell: true` (or invoke `npx.cmd` directly) on Windows to fix the typecheck/unit-tests stage.
2. The slice-check-service review-fanout + gate-verify-pipeline path resolution should use `getSessionDir()` (or a session-id-aware resolver) instead of the change-id axis it currently checks. This is the same fix class as the 5th writer.

**Worth a separate slice** (slice #013 or later) — out of scope for #012. Track alongside the `skills/peaks-solo` 14+ legacy paths allow-listed in slice #012.
