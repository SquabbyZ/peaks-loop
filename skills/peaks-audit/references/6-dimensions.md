# The 6 audit dimensions

The `auditGoal()` primitive (`src/services/audit/audit-goal-service.ts`) rejects any LLM response that does not cover all six dimensions below. Each dimension is one entry in the `audit` array of `AuditGoalOutput`, shaped as `{ dimension, finding, severity }`. Severity is one of `info`, `concern`, `blocker`.

## Severity recap (applies to every dimension)

| Severity | Meaning | Caller action |
|---|---|---|
| `info` | Dimension is healthy. The audit is just recording a fact, not flagging risk. | None. Note it and move on. |
| `concern` | Dimension is suspicious. The human should weigh in before the work starts. | Surface in the rationale; humans accept or amend the proposed goal. |
| `blocker` | Dimension is fatal. The work MUST NOT proceed in its current shape. | Refuse to start; require the human to re-scope the need. |

`blocker` is the only severity that hard-stops the workflow. `concern` is advisory. `info` is bookkeeping.

---

## 1. correctness

**Definition.** Does the proposed work actually solve the problem the user described, or is it solving a different problem? Checks whether the LLM's restatement matches the human's intent and whether the goal's success criteria measure the right thing.

| Severity | When it applies |
|---|---|
| `blocker` | The proposed goal solves a different problem than the need. Audit restates the need incorrectly. |
| `concern` | Goal is plausible but the success criteria measure a proxy, not the actual outcome. |
| `info` | Goal aligns with need; criteria measure the right thing. |

**Example.**

```text
{ dimension: 'correctness',
  finding: 'Need says "speed up the doctor report"; goal adds a new check that does not affect report latency.',
  severity: 'blocker' }
```

---

## 2. completeness

**Definition.** Is anything obviously missing from the proposed goal — implicit requirements, edge cases, or "while you're at it" work the user almost certainly meant? Checks whether the goal captures the full surface of the need or only part of it.

| Severity | When it applies |
|---|---|
| `blocker` | Goal ignores a stated part of the need. (e.g. need says "test + ship" and goal only covers test.) |
| `concern` | Goal covers the literal need but skips an obvious adjacent surface (migration, rollback, telemetry). |
| `info` | Goal captures the full need. |

**Example.**

```text
{ dimension: 'completeness',
  finding: 'Need mentions "migrate the old config"; goal covers the migration but not the rollback path.',
  severity: 'concern' }
```

---

## 3. scope

**Definition.** Is the proposed goal sized appropriately for the change? Too big = `epic` masquerading as `medium`; too small = goal that ships nothing useful. Checks whether the LLM respected the implied boundary of the need.

| Severity | When it applies |
|---|---|
| `blocker` | Goal swallows a much larger refactor than the need implies. (e.g. user asked for a flag, goal is to rewrite the module.) |
| `concern` | Goal is a bit larger than the need warrants, or `roughEffort` understates what the success criteria imply. |
| `info` | Scope matches the need; `roughEffort` is honest. |

**Example.**

```text
{ dimension: 'scope',
  finding: 'Need: "add a --json flag". Goal: refactor the entire output layer. roughEffort: small.',
  severity: 'blocker' }
```

---

## 4. risks

**Definition.** What can go wrong, both during the work and after it ships? Includes data loss, regression, performance, security, operability, and human-process risks. Checks whether the LLM surfaced the things a senior engineer would have flagged.

| Severity | When it applies |
|---|---|
| `blocker` | A known irreversible risk is unaddressed (data loss, security regression, breaking public API). |
| `concern` | A real risk that the goal does not mitigate (no rollback plan, no migration safety, no perf baseline). |
| `info` | Risks are surfaced and either mitigated or explicitly accepted. |

**Example.**

```text
{ dimension: 'risks',
  finding: 'Goal rewrites the public API without a deprecation window. Consumers break on upgrade.',
  severity: 'blocker' }
```

---

## 5. alternatives

**Definition.** Did the LLM consider other ways to solve the need, and is the chosen approach actually the best one? Checks whether the goal is the result of a real choice, not the only path the LLM thought of. A "no alternatives considered" finding is a `concern` because the human has nothing to compare against.

| Severity | When it applies |
|---|---|
| `blocker` | The chosen approach has a known fatal flaw that an obvious alternative avoids. (e.g. "writes a custom parser" when a battle-tested library exists.) |
| `concern` | No alternatives were considered, or the rationale does not explain why the chosen approach beats them. |
| `info` | One or more alternatives are noted, with a clear reason the chosen approach wins. |

**Example.**

```text
{ dimension: 'alternatives',
  finding: 'Goal hand-rolls a JSON schema validator. `zod` is already a project dep.',
  severity: 'concern' }
```

---

## 6. constraints

**Definition.** What non-negotiable boundaries does the work have to respect? Includes public APIs that must not change, dependencies that cannot be added, performance budgets, security policies, regulatory constraints, deployment windows, and human-time constraints. Checks whether the goal acknowledges the walls around the work.

| Severity | When it applies |
|---|---|
| `blocker` | The goal violates a known constraint (e.g. "add a new dep" when the project is dep-free; "rewrite the auth path" when security review is locked). |
| `concern` | A real constraint is unaddressed (no migration window, no review gate, no perf budget). |
| `info` | Constraints are acknowledged and respected. |

**Example.**

```text
{ dimension: 'constraints',
  finding: 'Project is pinned to Node 18. Goal uses `node:test` snapshot matchers added in Node 22.',
  severity: 'blocker' }
```

---

## Putting it together

A complete audit has all six entries, each with a non-empty `finding` and an honest `severity`. The human reads `summary` first, scans the `blocker` lines (if any), then reads the `concern` lines to decide whether to amend the `proposedGoal`. The `info` lines are the floor — they exist so the human trusts that the dimension was actually checked.

If any dimension is missing, the `auditGoal()` service throws `IncompleteAuditError` (`code: 'INCOMPLETE_AUDIT'`). The error is a hard gate: autonomous work does not proceed. The fix is to re-prompt the LLM with the original need, not to patch the audit by hand.
