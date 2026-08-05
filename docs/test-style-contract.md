# Test-Style Contract for LLM-Written Unit Tests

> **Effective**: rid-2026-08-05-bdd-test-style, peaks-loop v4.0.11+
> **Audience**: LLM agents (peaks-rd / peaks-qa / downstream consumers) that
> write new unit tests in projects adopting this contract.
> **Status**: soft contract — enforced at peaks-qa verification time, not
> at compile time.

This document is the opt-in LLM-facing counterpart to the AAA→BDD
rewrite that the rid-2026-08-05-bdd-test-style slices ship inside
peaks-loop. Downstream projects can adopt the same contract by
importing this file:

```ts
import contract from 'peaks-loop/test-style';
```

The runtime export is the markdown string below; the contract lives
in the prose, not in code. LLM agents are expected to read this file
on every test-writing turn.

---

## 1. The Contract

Every new or modified `it()` / `test()` block in `tests/unit/**`
MUST follow the given-when-then shape.

### 1.1 Description (the `it()` / `test()` string-literal)

- **Form**: `when X, should Y` — state the precondition in the `when`
  clause and the observable outcome in the `should` clause.
- **Required word**: must include at least one of `when` or `should`.
  (`when` alone is the precondition; `should` alone is the outcome;
  the natural-language form combines both.)
- **Anti-pattern**: do NOT use legacy `// arrange:` / `// act:` /
  `// assert:` markers anywhere in the test body.

### 1.2 Body (the callback)

The first three statements of the callback (after the opening brace,
before any executable code) MUST be exactly three leading comments:

```ts
// given: <precondition — system / user state>
// when: <action — what is invoked>
// then: <expected outcome — what is asserted>
```

The `then:` line corresponds to the assertion(s) that follow.

### 1.3 Behavior preservation

The migration must be idempotent. A second pass over a test file
already in BDD form must produce the same output (no duplicate
comment blocks, no double-tagged descriptions).

---

## 2. 5-Item Pre-Write Checklist

LLM agents writing a new test should run this checklist before
declaring the test complete:

1. **Does the description include `when` or `should`?**
   If no, rewrite the description before writing the body.
2. **Does the body start with the `// given:` / `// when:` / `// then:`
   triple in that exact order?**
   If no, prepend the missing lines.
3. **Are there any `// arrange:` / `// act:` / `// assert:` lines?**
   If yes, replace them with the BDD triple.
4. **Will the test still pass with the BDD rewrite?**
   Run the test, do not just trust the diff. Anti-fake-green rule:
   vitest green is necessary but not sufficient.
5. **Does the description read as business behavior, not as
   implementation detail?**
   If the description reads like code (e.g. "calls foo with x"),
   rewrite it as observable behavior ("when x is passed, should
   return y").

---

## 3. Opt-In Adoption (downstream projects)

Downstream consumers can adopt the same contract without depending
on peaks-loop at runtime — this file is the contract. To opt in:

```jsonc
// package.json
{
  "devDependencies": {
    "peaks-loop": "^4.0.11"
  }
}
```

```ts
// In a vitest setup or in a pre-commit hook:
import contract from 'peaks-loop/test-style';
// `contract` is the markdown string of this document; surface it to
// your LLM agent on every test-writing turn via system prompt or
// tool description.
```

The contract is intentionally **not** a code-level dependency — it
is a document that LLMs read. Runtime imports are an opt-in
ergonomic aid for surfacing the contract to a downstream prompt.

---

## 4. Why Not Enforce in the Test Runner?

- vitest's `it()` accepts any string; enforcing description shape at
  runtime would require a custom wrapper around every test, which
  defeats vitest's plugin compatibility.
- AST-based verification (the peaks-qa `bdd-test-style-verifier`) is
  the chosen gate because it inspects what the LLM wrote, not what
  vitest sees. False positives from string-internal `when` matches
  are eliminated by walking only the description's `StringLiteral`
  and the body callback's leading comments.
- LLM-authored tests are the primary audience. Humans writing tests
  are not blocked by this contract (peaks-qa is the gate, not vitest).

---

## 5. Author & Change Control

- **Author**: SquabbyZ (`601709253@qq.com`) — sole-author per project
  red rule.
- **Change control**: any edit to this file MUST go through a
  peaks-rd slice with peaks-qa acceptance; treat the contract text as
  load-bearing for downstream LLM behavior.
- **Related**: `.peaks/_runtime/2026-08-04-session-3fe1be/sc/2026-08-05-bdd-test-style-rid-design.md`
  (the design doc), `scripts/migrate-to-bdd.mjs` (the AST migrator),
  `src/services/qa/bdd-test-style-verifier.ts` (the verifier).