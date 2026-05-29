---
name: coverage-red-line
description: Unit-test coverage must come from meaningful tests, not coverage padding. Targets 100% on testable files but never justifies useless tests.
metadata:
  type: feedback
---
When a coverage gate fails on a new file, do NOT reflexively add tests just to cover the missing line or branch. The 100% target exists to prove behavior is exercised, not as a score to game.

**Why:** The user explicitly called this out after seeing slices with tests like "defaults the clock to wall clock when omitted", "wraps non-Error rejections in an Error", "uses default global path" — they add line count but rarely catch a regression a real-feature test wouldn't already catch.

**How to apply:**
1. If a missing line/branch is a **defensive guard for an unreachable case**, REMOVE the guard rather than test it.
2. If it is **pure IO / platform glue that can't be tested cleanly** (process spawn, real fs default paths, homedir defaults), add the file to `coverage.exclude` in `vitest.config.ts` with a one-line reason (established pattern: mcp-stdio-transport, *-types).
3. If it is **real behavior the caller relies on**, write the test framed around the BEHAVIOR, not the branch.
4. When 100% only comes from a test documenting nothing a user cares about, lower the target via exclusion or simplify away the dead branch.

Cross-references: `vitest.config.ts` `coverage.exclude` shows the existing exclusion pattern.
