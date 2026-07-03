---
name: skill-external-invocation-pattern-doctoring-is-one-line-surgery
description: skill-external-invocation pattern doctoring is one-line surgery
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-03-session-ee2aba/txt/handoff.md
---

When `tests/unit/skill-external-invocation.test.ts:63` fails, root-cause before bulk-patching.
This session's diagnostic steps:

  1. `pnpm test` shows exit 0 but contains "1 failed" in the test summary — pnpm 10+ swallows vitest exit codes, so the **only reliable signal is vitest's summary line**, not the pnpm exit code.
  2. `expect.soft` aggregating many soft-asserts into one reported failure means a single line-63 fail can mask the true per-skill blast radius. Re-running the failing test in isolation (`npx vitest run tests/unit/skill-external-invocation.test.ts`) is fastest.
  3. **GNU grep on Windows mis-parses `[\w \-/]` as an invalid character range** — to detect content against PEAKS_AUTHORITATIVE_PATTERN reliably, use a Node one-liner instead of `grep -E`. Without this, every skill looks like it fails.

Affected skills: peaks-rd, peaks-qa, peaks-final-review, peaks-txt.
Stable for memory: yes — applies to every skill that has PEAKS_AUTHORITATIVE / NO_EXECUTE / DISCOVERY / REF_ONLY assertions.
