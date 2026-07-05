# Reading handoff frontmatter (peaks-rd → peaks-qa)

QA reads the RD handoff's YAML frontmatter **before** reading the body prose. The frontmatter is the mechanical contract; the body is narrative. Cross-check fields mechanically; flag mismatches as Gate C failures.

## Required frontmatter fields (mirror RD writer)

`requestId`, `scope`, `files`, `decisions[]`, `risks[]`, `nextActions[]`, `gateEvidence`, `schemaVersion: '1.0'`. Field schema: `../peaks-rd/references/writing-handoff-frontmatter.md`.

## Mechanical cross-checks (run before body read)

1. **Decisions ↔ tests** — every `decisions[].id` (e.g. `D1`) implies a test under `tests/unit/`. Grep `tests/unit/` for the decision id (or its summary keywords). Missing test → Gate B2 partial.
2. **Risks ↔ security tests** — every `risks[].id` with `description` mentioning auth / input / boundary / path / external / crypto / payment MUST have a matching case under `tests/unit/security/`. Missing → Gate A3 partial.
3. **Files ↔ diff** — `files[]` must equal `git diff --name-only` against the parent commit. Any file in the diff not in `files[]` (or vice versa) → Gate B8 fail (out-of-scope or missing scope).
4. **`gateEvidence` ↔ on-disk** — every path in `gateEvidence` MUST `ls` successfully. Missing → Gate C fail (the gate table is enforced by `peaks request transition`).
5. **`nextActions` ↔ this skill** — first `nextActions[]` entry should match what peaks-qa is about to do. Mismatch (e.g. "RD to fix" still queued) → loop back to RD, do not run QA.

## Test plan derivation (body prose)

After the frontmatter passes, read the body prose to derive the test plan:

- Walk `## Red-line scope` to know what NOT to test.
- Walk the implementation narrative for new code paths → one test case per path.
- Cross-link each test case back to a PRD acceptance ID via `**Acceptance:**`.
- Honor `nextActions[]` ordering.

## Verifiable success

- All 5 mechanical cross-checks above pass (or are explicitly waived via `--allow-incomplete --confirm`).
- Test plan covers every new code path mentioned in body prose.
- Frontmatter YAML parses cleanly (vitest guard: `tests/unit/artifacts/handoff-frontmatter-shape.test.ts`).
