# Red Lines Spec (Slice L2.3 P2-a)

## Purpose

Extend the peaks-loop red-line audit framework with 25 lint-style
enforcers (Themes A through G) and integrate the ECC AgentShield
soft-optional layer. This is the third sub-slice of L2: P0 shipped
in L2.1 (5 enforcers, structural gates), P1 shipped in L2.2 (10
enforcers, mid-level gates), and P2-a ships now (25 enforcers,
lint-style gates + ECC integration).

## Catalog delta (15 → 40 entries)

The catalog at `src/services/audit/red-line-catalog.ts` now spreads
`RED_LINE_CATALOG_P2_A` (24 P2-a entries). Total catalog: 40
entries (5 P0 + 10 P1 + 24 P2-a + 1 catalog governance).

| Theme | Count | Enforcer | Source file |
|-------|-------|----------|-------------|
| A — section structure | 5 | rl-section-* | `enforcers/lint-style.ts` |
| B — frontmatter shape | 3 | rl-frontmatter-* | `enforcers/lint-style.ts` |
| C — output style | 3 | rl-output-style-* | `enforcers/lint-output-style.ts` |
| D — CLI-back gaps | 3 | rl-cli-back-* | `enforcers/lint-cli-back.ts` |
| E — reference integrity | 4 | rl-ref-* | `enforcers/lint-reference-integrity.ts` |
| F — workflow shape | 4 | rl-openspec-*, rl-tech-doc-presence-pre-rd, rl-peaks-doctor-skill-acknowledged | `enforcers/lint-workflow-shape.ts` |
| G — catalog governance | 2 | rl-catalog-total, rl-catalog-prose-only-ratio | `enforcers/lint-catalog-governance.ts` |

The CLI-back prose-only-threshold enforcer (rl-cli-back-prose-only-threshold-001)
is cataloged but its enforcer is a thin wrapper over the catalog
size check (it shares the lint-catalog-governance file).

## Enforcer contract

Every P2-a enforcer exports a pure function that takes a typed
input (`SkillFile`, project root, or catalog stats) and returns
`readonly LintHit[]`. The audit service
(`src/services/audit/red-lines-service.ts`) walks `skills/`,
`references/`, `openspec/`, and the catalog itself, calls the
enforcers, and converts `LintHit[]` into `EnforcerFinding[]` for
the audit report.

Severity is `warn` for all P2-a enforcers (lint layer, not
structural gate). P0/P1 enforcers (sub-agent-sid, tech-doc-presence,
pre-rd-scan, design-draft-confirm, prototype-fidelity) keep their
`fail` / `warn` severity.

## ECC AgentShield soft-optional integration

New `peaks audit static` subcommand. The CLI:

1. Detects ECC AgentShield via `npx ecc-agentshield --version`
   (5s timeout, soft-fail on error).
2. If installed: spawns `npx ecc-agentshield scan --json` and
   merges its findings into the audit's `EnforcerFinding` list.
3. If not installed: surfaces the same §5.3 four-option UX as UA
   (a) install, b) skip, c) never, d) learn).
4. Soft-disabled via `agentShieldEnabled` preference (default
   `false`); the audit runs even when disabled, just without the
   external subprocess.

## Acceptance behavior

- `peaks audit red-lines --json`: `totalRedLines` grows from 15 to
  40+; `cliBacked` grows from 12 to 38+; `proseOnly` shrinks
  from 3 to ≤ 5 (per §10.2 L2 acceptance).
- `peaks audit static --json`: new command, ECC-merged findings
  when available.
- `peaks slice check`: existing 4-5 stages unchanged; enforcer
  count badge updates to reflect the new catalog size.
- All 25 new P2-a enforcers ship with at least one TDD unit test
  in `tests/unit/services/audit/enforcers/lint-*.test.ts`.

## Out of scope

- L2.4 P2-b (file-system enforcer integration) is already shipped
  (commit `bb3abe2`); this slice builds on top of it.
- L2.5 P2-c (per-language rule packs) is the next sub-slice.
