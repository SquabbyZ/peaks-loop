# ReviewerEnvelope schema (v2.14.0 G4 AC-4.2)

`peaks-reviewer` MUST emit a JSON object that validates against
`schemas/reviewer-envelope.schema.json`. Free-form LLM JSON is rejected.

## Field reference

| Field        | Type    | Required | Notes |
| ------------ | ------- | -------- | ----- |
| `reviewerId` | string  | yes      | Stable id (`third-party-reviewer-v2.14.0`). |
| `modelId`    | string  | yes      | Concrete model id (overwritten server-side from the provider we called). |
| `modelFamily`| string  | yes      | Family bucket (overwritten server-side via `deriveModelFamily(modelId)`). |
| `passed`     | bool    | yes      | True only when a review RAN and found no blocking violations. False on every skip path. |
| `violations` | array   | yes      | `[{kind, file, line, hint}]`. Empty when none. |
| `gateAction` | enum    | yes      | `block` | `allow` | `warn`. A skip is `warn`, never `allow`. |
| `reason`     | string  | yes      | One-sentence rationale. |

## Violation kinds (closed enum)

- `karpathy-violation` — karpathy 4-guidelines breach
- `code-smell` — generic code smell
- `security` — security issue
- `perf` — performance issue
- `surgical-changes` — touched more than the request requires
- `simplicity-first` — overengineered
- `goal-driven-execution` — weak / unverifiable success criteria
- `think-before-coding` — hidden assumptions

## Distinctness gate (AC-4.4)

`third-party-review-<rid>.json.modelFamily` MUST differ from `karpathy-review.json.modelFamily`. Equality fails the build. The reviewer service stamps `modelFamily` from the actual `modelId` (the LLM cannot self-report a different family).

## Skipped envelope

When `~/.peaks/config.json` lacks the `reviewer` section (or has fewer than
two usable providers), the reviewer returns:

```json
{
  "reviewerId": "third-party-reviewer-v2.14.0",
  "modelId": "skipped",
  "modelFamily": "skipped",
  "passed": false,
  "violations": [],
  "gateAction": "warn",
  "reason": "skipped: no-reviewer-config (fallbackOnError=skip)"
}
```

A skip is not a pass: `passed` is `false` and `gateAction` is `warn`, so no
consumer reading those two fields sees green. `peaks reviewer run --write`
refuses to write `rd/third-party-review-<rid>.md` / `.json` from a skipped
envelope — the artifact exists only when a review actually ran. The
THIRD_PARTY_REVIEW prereq records the skip in `prerequisites.warnings`.
