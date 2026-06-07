---
name: static-scan-must-cover-skills-tree-not-just-src
description: Path-construction static scans must cover skills/<skill>/references/*.md and skills/<skill>/SKILL.md, not just src/**/*.ts — slice 005's src/-only scan missed the 5th writer
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-07-session-84feb7/txt/handoff-012-2026-06-07-fix-5th-session-runtime-writer.md
---

The path-construction static scan in `tests/unit/services/session/session-dir-canonical.test.ts` was originally written to cover only `src/**/*.ts` (slice 005's defense-in-depth). It missed the **markdown contract** that turned out to be the 5th session-runtime writer: `skills/peaks-qa/references/qa-fanout-contract.md:43,51,55,83,84,85` documented the legacy `.peaks/<sid>/qa/...` path as the QA 3-way fan-out's write target. Every QA sub-agent dispatched in slice #011 and prior leaked 4 files (`security-findings-<rid>.md`, `performance-findings-<rid>.md`, `test-cases/<rid>.md`, `test-reports/<rid>.md`) to the root-level session dir while the canonical `.peaks/_runtime/<sid>/qa/...` tree held only an empty `.initiated` marker.

**Why:** Markdown contracts in `skills/<skill>/references/*.md` are the de-facto source of truth for sub-agent behaviour — they tell the sub-agents WHERE to write their outputs, HOW to format them, and WHAT paths to expect. A static scan that only inspects TypeScript misses this entirely, because the markdown is the prompt the sub-agents act on. The result is "the code is correct but the prompt is wrong, so the agents bypass the code-level fix".

**How to apply:** When adding or extending a path-construction static scan, cover BOTH surfaces:
- `src/**/*.ts` — catches code-level path-literal regressions
- `skills/<skill>/references/*.md` AND `skills/<skill>/SKILL.md` — catches prompt-level path-literal regressions that the sub-agents will follow verbatim

The slice #012 fix extends the scan to `skills/<skill>/references/<file>.md` with an `ALLOWED_LEGACY_SKILL_PATHS` allow-list (4 pre-existing out-of-scope offenders tracked as slice #013). Future markdown contract files in `skills/*/references/*.md` that contain legacy `.peaks/<sid>/...` paths will now fail the static scan at test-time. New static scans for path construction in other axes (change-id, sub-agent) should follow the same dual-surface pattern.

**Related:** `session-dir-canonical-resolver-must-route-all-writes` (the original slice 005 lesson), `peaks-slice-check-axis-mismatch-false-negatives` (the downstream consumer of these paths that ALSO has the same axis-blindness).
