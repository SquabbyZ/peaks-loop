# peaks-rd 4-way parallel fan-out (slice 004)

The Parallel review fan-out is the canonical RD-side review pattern: at the
end of implementation, RD fires 4 sub-agents in parallel via
`peaks sub-agent dispatch <role>` instead of running them sequentially.

## The 4 sub-agents

- **Sub-agent 1 — code-reviewer** runs `code-review` against the diff and
  writes `rd/code-review.md`.
- **Sub-agent 2 — security-reviewer** runs `security-review` against the
  changed surface and writes `rd/security-review.md`.
- **Sub-agent 3 — perf-baseline-reviewer** measures the perf surface
  (slice 025) and writes `rd/perf-baseline.md`. Skipped when the slice
  has no perf surface (e.g. config / docs / chore) or when the bugfix
  is not perf-shaped.
- **Sub-agent 4 — qa-test-cases-writer** drafts the QA test plan and
  writes `qa/test-cases/<rid>.md`. The test plan is the deliverable —
  these test cases do NOT need to be executed by this sub-agent (the
  QA reviewer executes them in Gate D). Do NOT write to `tests/`; the
  writer's only write target is `qa/test-cases/<rid>.md`.

## Hard prohibitions on all 4 sub-agents (single block)

- Sub-agents are spawned via `Skill(skill="...")` and run in their own
  conversation context. They MUST NOT mutate parent settings
  (`peaks skill presence:set`, hooks install, `.claude/settings.json`).
- Sub-agents MUST NOT call `peaks workflow verify-pipeline` — that is
  Solo's responsibility.
- Sub-agents MUST NOT modify the request artifact body — they only
  write their respective review artifact.
- Sub-agents MUST NOT install or persist external material (no
  `npm install` of unapproved packages, no Playwright MCP install).
- Sub-agents return a compact JSON envelope
  (`{ ok, artifact, blockers, notes }`) to the parent RD loop; the
  parent aggregates into the final qa-handoff.

## Aggregation

The parent RD loop receives the 4 envelopes, runs `peaks request lint`
on the produced artifacts, and only then attempts
`peaks request transition --state qa-handoff`. The aggregation step
runs 4 ls checks: Gate B3 (code-review file), Gate B4 (security-review
file), Gate B9 (perf-baseline file, when the slice has a perf
surface), and the `qa-test-cases` pre-draft (the 4th sub-agent's
deliverable). A failure in any of the 4 sub-agents → blocked, no
auto-downgrade.

## Degradation

When the `qa-test-cases-writer` sub-agent fails, the parent RD loop
records the failure as `qa-test-cases-subagent-degraded-to-inline-qa-draft`
in the request artifact and proceeds; the QA main loop falls back to
drafting the test plan inline at Gate D. The other 3 sub-agents
(code-reviewer, security-reviewer, perf-baseline-reviewer) are NOT
degradeable — their failure blocks qa-handoff.

## Gate C evidence (RD-side, type-specific)

| Request type | Required RD evidence (under `.peaks/<id>/`) |
|---|---|
| feature / refactor | `rd/tech-doc.md` + `rd/code-review.md` + `rd/security-review.md` + `rd/perf-baseline.md` + `qa/test-cases/<rid>.md` |
| bugfix | `rd/bug-analysis.md` + `rd/code-review.md` + `rd/security-review.md` + `qa/test-cases/<rid>.md` (rd/perf-baseline.md only when perf-shaped) |
| config | `rd/security-review.md` |
| docs / chore | (no extra evidence required) |

Always required (in addition to the type-specific row):
`ls .peaks/<id>/rd/requests/<rid>.md`. Missing any required file →
DO NOT attempt the qa-handoff transition; CLI will reject with
`PREREQUISITES_MISSING`.
