# Red Lines Spec (Slice L2.4 P2-b)

## Purpose

Extend the peaks-cli red-line audit framework with 25 lint-style
enforcers focused on **references/*.md** shape, cross-references,
loadStrategy behavior, and inline-shell hygiene. Plus an
**audit regression stage** wired into `peaks slice check`.

This is the fourth sub-slice of L2: P0 (L2.1), P1 (L2.2), P2-a
(L2.3), P2-b (L2.4). P2-b's job is to push prose-only into the
cli-backed column (per §10.2 L2 acceptance: prose-only < 10%
at L2.4 done).

## Catalog delta (41 → 66 entries)

| Theme | Count | Enforcers | Source file |
|-------|-------|-----------|-------------|
| H — reference structural shape | 3 | `rl-ref-h1-*`, `rl-ref-applicable-*`, `rl-ref-see-also-*` | `enforcers/lint-reference-shape.ts` |
| I — reference cross-references | 3 | `rl-ref-cross-ref-*`, `rl-ref-no-self-*`, `rl-ref-no-orphan-link-*` | `enforcers/lint-reference-shape.ts` |
| J — reference size + structure | 3 | `rl-ref-line-count-*`, `rl-ref-h2-count-*`, `rl-ref-overview-*` | `enforcers/lint-reference-shape.ts` |
| K — loadStrategy behavior | 2 | `rl-ref-loadstrategy-on-demand-*`, `rl-ref-loadstrategy-always-*` | `enforcers/lint-reference-shape.ts` |
| L — audit regression | 4 | `rl-audit-catalog-stability-*`, `rl-audit-no-orphan-enforcer-*`, `rl-audit-no-orphan-catalog-*`, `rl-audit-runtime-budget-*` | `enforcers/lint-audit-regression.ts` |
| M — inline shell patterns | 3 | `rl-ref-no-bash-heredoc-*`, `rl-ref-no-sudo-*`, `rl-ref-no-curl-pipe-bash-*` | `enforcers/lint-reference-shape.ts` |
| N — code blocks | 3 | `rl-ref-code-block-language-*`, `rl-ref-no-fake-prompt-*`, `rl-ref-no-absolute-paths-*` | `enforcers/lint-reference-shape.ts` |
| O — permissions + numbers | 2 | `rl-ref-no-chmod-777-*`, `rl-ref-no-magic-numbers-*` | `enforcers/lint-reference-shape.ts` |
| P — dogfooding | 2 | `rl-ref-skill-cites-*`, `rl-ref-loadstrategy-matches-size-*` | `enforcers/lint-reference-shape.ts` |

## Enforcer contract

Same convention as P2-a: each enforcer is a pure function
returning `readonly LintHit[]`. The audit service walks
`skills/<name>/references/*.md` and calls the enforcers per file.

## Audit regression stage

`peaks slice check` gains a 5th stage. The stage:

1. Runs `peaks audit red-lines --json`.
2. Asserts `totalRedLines >= 60` (lower bound; catalog 66).
3. Asserts no `audit-no-orphan-enforcer` or
   `audit-no-orphan-catalog` findings.
4. Asserts runtime ≤ 2000ms.
5. Emits a `passSummary` envelope.

The stage is **gating**: a failure exits `peaks slice check`
non-zero, blocking the commit (per §10.2 line 1199).

## Out of scope

- L3.1 UA integration (slice #8, parallel critical path)
- L2.5 P2-c per-language rule packs (not in spec)
- Renaming or moving existing P2-a enforcers
