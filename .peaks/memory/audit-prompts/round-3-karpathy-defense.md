# Independent Audit Round 3 — Karpathy 4 + Defense Effectiveness

You have NO prior context. This prompt is your only input.
Do not ask follow-ups. Do not modify code permanently.
(Mutation probes are OK if reverted before reporting.)

## Target

Commit 208fd34 on branch main of repo at C:\Users\smallMark\Desktop\peaks-cli.

Run `git show 208fd34` to read the diff. Files changed:

- src/services/rd/impl.ts (+11 lines)
- tests/unit/services/rd/ast-gate.test.ts (+105 lines)
- tests/unit/services/rd/impl.test.ts (+59 lines)
- tests/unit/services/rd/types.test.ts (+31 lines)

## Your Dimension: Karpathy 4 Guidelines + Defense Effectiveness

The 4 Karpathy guidelines (verbatim):

1. Think Before Coding — surface assumptions, name trade-offs
2. Simplicity First — minimum code, no speculative features, 800-line file cap
3. Surgical Changes — touch only what the request requires, clean up own orphans
4. Goal-Driven Execution — verifiable ACs, plan + verify checkpoints

Audit ONLY these 5 questions:

1. Karpathy #1 — does the fix surface assumptions? In particular: does the impl.ts defense-in-depth comment explain WHY both checks are load-bearing, or is it just code that happens to work?

2. Karpathy #2 — is the fix minimal? Are there any speculative features in the new code (unused exports, dead branches, commented-out paths)?

3. Karpathy #3 — is the diff surgical? Does it touch any file that the 5 R2 weaknesses don't require? Did it leave orphan code in other files? File size after change still ≤ 800 lines?

4. Karpathy #4 — are the acceptance criteria verifiable? Could an outsider read each new test name and predict what bug it catches?

5. Defense effectiveness — REQUIRED mutation probes:

   (a) Comment out impl.ts:36-44 (defense-in-depth check). Run:
       ```
       npx vitest run tests/unit/services/rd/impl.test.ts
       ```
       Result MUST show ≥1 failure (specifically the lying-input test).
       Revert before continuing.

   (b) Change /^[a-f0-9]{64}$/ to /^[a-f0-9]{1,64}$/ in src/services/rd/types.ts. Run:
       ```
       npx vitest run tests/unit/services/rd/types.test.ts
       ```
       Result MUST show ≥1 failure (the 65-char / non-hex negative tests).
       Revert before continuing.

   (c) Empty the externalApiCalls array in the multi-entry test. Run:
       ```
       npx vitest run tests/unit/services/rd/impl.test.ts
       ```
       Result MUST show ≥1 failure (the distinct-sig assertion).
       Revert before continuing.

   Report each probe's actual result.

## Output (JSON only)

Write to .peaks/_runtime/<sessionId>/audit/round-3-karpathy-defense.json with this exact shape:

```json
{
  "round": 3,
  "dimension": "karpathy_defense",
  "passed": true,
  "violations": [
    {
      "id": "R3-W1",
      "severity": "HIGH",
      "location": "file:line",
      "issue": "concrete failure mode",
      "karpathy_principle": "#1|#2|#3|#4|defense",
      "evidence": "line numbers / probe output",
      "fix_suggestion": "minimal change"
    }
  ],
  "gateAction": "pass",
  "mutation_probes": [
    {
      "probe": "disable impl.ts defense-in-depth",
      "expected": ">=1 fail",
      "actual": "N fails",
      "test_that_caught_it": "test name or 'none — defense is hole'"
    },
    {
      "probe": "widen sha256 regex to {1,64}",
      "expected": ">=1 fail",
      "actual": "N fails",
      "test_that_caught_it": "test name or 'none'"
    },
    {
      "probe": "empty externalApiCalls in multi-entry test",
      "expected": ">=1 fail",
      "actual": "N fails",
      "test_that_caught_it": "test name or 'none'"
    }
  ],
  "notes": "anything the orchestrator should know"
}
```

Print `cat <output-path>` at the end.

## Hard Rules

- DO NOT modify any source file under src/ PERMANENTLY (probes must revert)
- DO NOT modify any test file under tests/
- Mutation probes MUST be reverted before reporting
- DO NOT read Round 1 or Round 2 output
- Output is JSON ONLY
