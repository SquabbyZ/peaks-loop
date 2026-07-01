---
name: round-2-test-quality
description: Plan 4 audit — independent auditor prompt for the round 2 test quality dimension. Archived as audit methodology reference for future audits.
metadata:
  type: reference
  artifactType: prompt
  sourceArtifact: peaks audit artifact write --kind prompt
  createdAt: 2026-06-22
---

# round-2-test-quality

# Independent Audit Round 2 — Test Quality Dimension

You have NO prior context. This prompt is your only input.
Do not ask follow-ups. Do not modify code.
DO NOT read Round 1 output — your dimension is test quality, not spec.

## Target

Commit 208fd34 on branch main of repo at C:\Users\smallMark\Desktop\peaks-loop.

Run `git show 208fd34` to read the diff. Files changed:

- src/services/rd/impl.ts (+11 lines)
- tests/unit/services/rd/ast-gate.test.ts (+105 lines)
- tests/unit/services/rd/impl.test.ts (+59 lines)
- tests/unit/services/rd/types.test.ts (+31 lines)

## Your Dimension: Test Quality

Audit ONLY these 5 questions:

1. Assertion strength — is each new expectation strong (sha256 / toBe / toThrow regex / not.toBe / toHaveLength / toMatchObject)? Flag any weak form (toBeDefined / toBeTruthy / toContain self / expect.anything / toBe self).

2. Boundary coverage — for each new test, what boundary does it cover? Are there untested boundaries: empty externalApiCalls vs multi-entry, lying input vs honest input, namespace import vs destructured, nonexistent path vs existing path, 63-char / 64-char / 65-char sha256, non-hex chars in sha256?

3. Test independence — does any new test rely on shared state from another test in the same file? Verify with shuffled run:
   ```
   npx vitest run tests/unit/services/rd/ --shuffle
   ```

4. False green detection — can you construct a buggy implementation that still passes all new tests? If yes, the test suite has a hole. Probe ideas:
   - Comment out defense-in-depth check in impl.ts:36-44
   - Change sha256 regex from {64} to {1,64} in src/services/rd/types.ts
   - Drop array elements in multi-entry test
   - Use a single-element array in "multi-entry" test (does the test still pass?)

5. Test count delta — Round 2 audit recorded 14 RD tests. After this fix the count should be > 14. Is each new test load-bearing, or could any be removed without losing coverage?

## Output (JSON only)

Write to .peaks/_runtime/<sessionId>/audit/round-2-test-quality.json with this exact shape:

```json
{
  "round": 2,
  "dimension": "test_quality",
  "passed": true,
  "violations": [
    {
      "id": "R2-W1",
      "severity": "HIGH",
      "location": "file:line",
      "issue": "concrete failure mode",
      "evidence": "test name + assertion code",
      "mutation_probe": "what mutation would escape?",
      "fix_suggestion": "minimal change"
    }
  ],
  "gateAction": "pass",
  "test_count_before": 14,
  "test_count_after": 28,
  "shuffled_run_result": "N/N pass",
  "notes": "anything future rounds should know"
}
```

Print `cat <output-path>` at the end.

## Hard Rules

- DO NOT modify any source file under src/
- DO NOT modify any test file under tests/
- DO NOT read Round 1 output or any prior round artifacts
- DO NOT skip questions; mark LOW if uncertain
- Output is JSON ONLY

