# peaks-rd 4-way parallel fan-out (slice 004) + 5-way karpathy-reviewer (slice 005)

The Parallel review fan-out is the canonical RD-side review pattern: at the
end of implementation, RD fires 4 sub-agents in parallel via
`peaks sub-agent dispatch <role>` instead of running them sequentially.

Slice 5/6 adds a 5th sub-agent — `karpathy-reviewer` — and converts it into
a **hard gate** for the `rd:qa-handoff` transition. The full 4-way pattern
is preserved; the 5th is appended at the same parallel stage.

## The 4 sub-agents

> **Karpathy pointer (Slice 1/6):** Each of the 4 sub-agents below operates under the 4 Karpathy guidelines. The canonical reference is `andrej-karpathy-skills:karpathy-guidelines` (full text) and `peaks-rd/SKILL.md` §"Karpathy enforcement". The dispatch primitive also injects the verbatim context block from `rd-sub-agent-dispatch.md` §"Karpathy-guidelines context" into every sub-agent prompt. Sub-agents MUST NOT silently drop the block.

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
- **Sub-agent 5 — karpathy-reviewer** (Slice 5/6 — hard gate) inspects
  the diff + tech-doc against the 4 Karpathy-guidelines and writes
  `rd/karpathy-review.md`. The file MUST contain a `## Karpathy-Gate`
  header and at least one of the 4 guideline section markers; the
  transition CLI gate reads those markers and refuses `rd:qa-handoff`
  when the file is missing or the markers are absent. The sub-agent
  returns a JSON envelope `{ passed, violations, gateAction }` (see
  contract below). Do NOT modify code; the writer's only write target
  is `rd/karpathy-review.md`.

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
drafting the test plan inline at Gate D. The other 4 sub-agents
(code-reviewer, security-reviewer, perf-baseline-reviewer, **karpathy-reviewer**)
are NOT degradeable — their failure blocks qa-handoff. The
`karpathy-reviewer` is a hard gate per karpathy §1 Think Before Coding +
§3 Surgical Changes.

### karpathy-reviewer contract (Slice 5/6)

**Inputs**:
- The verbatim 4-section Karpathy-guidelines block (injected by
  `rd-sub-agent-dispatch.md` §"Karpathy-guidelines context").
- The current slice's diff (changed files + their content).
- The current slice's `rd/tech-doc.md` (architecture summary).
- The current slice's PRD body (acceptance criteria).

**Outputs** (compact JSON envelope returned to the parent RD loop):
- `passed: boolean` — true when all 4 guideline sections pass.
- `violations: KarpathyViolation[]` — each `{ kind, line, snippet, hint }`
  with `kind` ∈ {`think-before-coding`, `simplicity-first`,
  `surgical-changes`, `goal-driven-execution`}.
- `gateAction: 'pass' | 'block' | 'warn'` — when the file is missing
  or all 4 section markers are absent, `gateAction` is `block`. When
  any violation is detected, `gateAction` is `warn`. When clean,
  `gateAction` is `pass`.

**File write**: the sub-agent writes ONLY `rd/karpathy-review.md`,
formatted as:

```md
# Karpathy review — <rid>

## Karpathy-Gate

gateAction: <pass|block|warn>
generatedAt: <ISO 8601>

## 1. Think Before Coding

<bullet-list of evidence>

## 2. Simplicity First

<bullet-list of evidence>

## 3. Surgical Changes

<bullet-list of evidence>

## 4. Goal-Driven Execution

<bullet-list of evidence>
```

The transition CLI gate reads `mustContain: ['## Karpathy-Gate',
'think-before-coding']` and `mustContainAny: ['simplicity-first',
'surgical-changes', 'goal-driven-execution']` from
`KARPATHY_REVIEW` in `src/services/artifacts/artifact-prerequisites.ts`.

**Hard prohibitions** (in addition to the 4-sub-agent block above):
- MUST NOT write code, modify the request artifact, or call
  `peaks request transition`.
- MUST NOT install hooks, agents, MCP, or settings.
- MUST NOT touch Slice 1+2+3+4 products (zero regression).
- MUST NOT skip the `## Karpathy-Gate` header. The CLI gate
  enforces its presence; absence blocks the transition.

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
