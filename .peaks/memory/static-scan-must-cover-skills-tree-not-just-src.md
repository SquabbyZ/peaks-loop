---
name: static-scan-must-cover-skills-tree-not-just-src
description: Path-construction static scans must cover every markdown file under skills/ (walked recursively, including SKILL.md), not just src/**/*.ts — slice 005's src/-only scan missed the 5th writer, and slice 012's one-level walker missed the skills/bee/ two-level tree that owned it
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-07-session-84feb7/txt/handoff-012-2026-06-07-fix-5th-session-runtime-writer.md
---

The path-construction static scan in `tests/unit/services/session/session-dir-canonical.test.ts` was originally written to cover only `src/**/*.ts` (slice 005's defense-in-depth). It missed the **markdown contract** that turned out to be the 5th session-runtime writer: `skills/bee/peaks-qa/references/qa-fanout-contract.md` (path as of 2026-09-10; originally `skills/peaks-qa/references/qa-fanout-contract.md`, before the bee skills moved under `skills/bee/`) documented the legacy `.peaks/<sid>/qa/...` path as the QA 3-way fan-out's write target. Every QA sub-agent dispatched in slice #011 and prior leaked 4 files (`security-findings-<rid>.md`, `performance-findings-<rid>.md`, `test-cases/<rid>.md`, `test-reports/<rid>.md`) to the root-level session dir while the canonical `.peaks/_runtime/<sid>/qa/...` tree held only an empty `.initiated` marker.

**Why:** Markdown contracts in `skills/<skill>/references/*.md` are the de-facto source of truth for sub-agent behaviour — they tell the sub-agents WHERE to write their outputs, HOW to format them, and WHAT paths to expect. A static scan that only inspects TypeScript misses this entirely, because the markdown is the prompt the sub-agents act on. The result is "the code is correct but the prompt is wrong, so the agents bypass the code-level fix".

**How to apply:** When adding or extending a path-construction static scan, cover BOTH surfaces:
- `src/**/*.ts` — catches code-level path-literal regressions
- every markdown file under `skills/` (walk it recursively) — catches prompt-level path-literal regressions that the sub-agents will follow verbatim

**Corrected (2026-09-10, S5 rebuild).** The slice #012 fix described here did not actually do what it claimed. It walked `skills/<skill>/references/*.md` — exactly one level — so it saw 60 files and **could not see any of `skills/bee/<skill>/references/*.md`**, the two-level tree that owns the QA fan-out contract this lesson is about. The 5th writer stayed invisible to the guard written for it. The rebuilt scan walks `skills/` recursively (161 markdown files) and matches the `<sid>`, `<session-id>` and `<sessionId>` placeholder shapes. The `ALLOWED_LEGACY_SKILL_PATHS` allow-list is now empty: later slices canonicalized both historical entries, so they were exempting clean files from the scan.

This lesson also had a second, quieter instance of the same class of defect. The deleted test was **deliberately removed in `f17aa377`** (2026-07-30) and not rebuilt until 2026-09-10, so for six weeks there was no `src/` *or* `skills/` scan at all — while this memory (and four others) still described it as live. Check that a guard still exists before citing it as enforcement. New static scans for path construction in other axes (change-id, sub-agent) should follow the same dual-surface pattern.

**Related:** `session-dir-canonical-resolver-must-route-all-writes` (the original slice 005 lesson), `peaks-slice-check-axis-mismatch-false-negatives` (the downstream consumer of these paths that ALSO has the same axis-blindness).
