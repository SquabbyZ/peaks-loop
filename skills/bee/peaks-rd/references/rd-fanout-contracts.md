# peaks-rd 3-way parallel fan-out (v2.12.0 — Group A collapse)

The Parallel review fan-out is the canonical RD-side review pattern: at the
end of implementation, RD fires 3 sub-agents in parallel via
`peaks sub-agent dispatch <role>` instead of running them sequentially.

> **v2.12.0 collapse (Group A — Tier 1+2+3):** the previous 5-way fan-out
> (slice 002 3-way + slice 004 qa-test-cases + slice 5/6 karpathy-reviewer)
> collapsed to **3 sub-agents** in the RD fan-out. The two removed slots
> (`security-reviewer`, `perf-baseline-reviewer`) moved to standalone audit
> skills consumed at pre-RD / pre-QA time:
>
> - `peaks-security-audit` — CLI: `peaks security-audit run`. Output:
>   `audit/security.md`. Required RD-side prereq: `AUDIT_SECURITY`.
> - `peaks-perf-audit` — CLI: `peaks perf-audit run`. Output:
>   `audit/perf.md`. Required RD-side prereq: `AUDIT_PERF`.
>
> Both audit skills consume the immutable peaks-prd handoff
> (`prd/handoff.md`) and the project-scoped audit templates under
> `.peaks/project-scan/{security-template, perf-template, audit-output-schema}.md`.
> The handoff presence is enforced by the `AUDIT_REQUIRES_HANDOFF` prereq.
> The 1-minor-release back-compat window (`v2.12.0`) keeps the old
> `rd/{security-review,perf-baseline}.md` paths readable via `mustContainAny` —
> see `tests/unit/rd/deprecated-reviewer-back-compat.test.ts` (8 cases) and
> `tests/unit/artifact-prerequisites-typed.test.ts`.

## The 3 sub-agents

> **Karpathy pointer (Slice 1/6):** Each of the 3 sub-agents below operates under the 4 Karpathy guidelines. The canonical reference is `andrej-karpathy-skills:karpathy-guidelines` (full text) and `peaks-rd/SKILL.md` §"Karpathy enforcement". The dispatch primitive also injects the verbatim context block from `rd-sub-agent-dispatch.md` §"Karpathy-guidelines context" into every sub-agent prompt. Sub-agents MUST NOT silently drop the block.

- **Sub-agent 1 — code-reviewer** runs `code-review` against the diff and
  writes `rd/code-review.md`. **v2.11.0 Tier 7 (Group D):** the dispatch goes
  through the **ECC bridge** (`src/services/code-review/ecc-bridge.ts`):
  `Agent({ subagent_type: 'everything-claude-code:code-review', ... })` returns
  `{ passed, violations[], gateAction }`; `adaptEccEnvelopeToRdCodeReview`
  renders it to the canonical markdown. On any non-ready `detectEcc` state
  (plugin-missing / agent-missing / dispatch-failed / envelope-malformed) the
  parent RD loop falls back to inline review; the `code-review-ecc-degraded-to-inline`
  TXT note records the fallback.
- **Sub-agent 2 — qa-test-cases-writer** drafts the QA test plan and
  writes `qa/test-cases/<rid>.md`. The test plan is the deliverable —
  these test cases do NOT need to be executed by this sub-agent (the
  QA reviewer executes them in Gate D). Do NOT write to `tests/`; the
  writer's only write target is `qa/test-cases/<rid>.md`.
- **Sub-agent 3 — karpathy-reviewer** (Slice 5/6 — hard gate) inspects
  the diff + handoff against the 4 Karpathy-guidelines and writes
  `rd/karpathy-review.md` (v2.11.0: the immutable peaks-prd handoff
  at `prd/handoff.md` replaces `rd/tech-doc.md`). The file MUST
  contain a `## Karpathy-Gate` header and at least one of the 4
  guideline section markers; the transition CLI gate reads those
  markers and refuses `rd:qa-handoff` when the file is missing or
  the markers are absent. The sub-agent returns a JSON envelope
  `{ passed, violations, gateAction }` (see contract below). Do NOT
  modify code; the writer's only write target is `rd/karpathy-review.md`.

> **Removed from v2.12.0 fan-out (back-compat window only):**
> - ~~Sub-agent — security-reviewer~~ — moved to standalone
>   `peaks-security-audit` skill; output `audit/security.md`. The legacy
>   path `.peaks/_runtime/<sessionId>/rd/security-review.md` remains
>   readable via `mustContainAny` for the v2.12.0 1-minor-release window.
> - ~~Sub-agent — perf-baseline-reviewer~~ — moved to standalone
>   `peaks-perf-audit` skill; output `audit/perf.md`. The legacy path
>   `.peaks/_runtime/<sessionId>/rd/perf-baseline.md` remains readable
>   via `mustContainAny` for the v2.12.0 1-minor-release window.
>
> See `tests/unit/rd/deprecated-reviewer-back-compat.test.ts` (8 cases)
> and `RD_DEPRECATED_REVIEWERS` in
> `src/services/rd/reviewer-dispatch-policy.ts`.

## Hard prohibitions on all 3 sub-agents (single block)

- Sub-agents are spawned via `peaks sub-agent dispatch <role>` and run in their own
  conversation context. They MUST NOT mutate parent settings
  (`peaks skill presence:set`, hooks install, `.claude/settings.json`).
- Sub-agents MUST NOT call `peaks workflow verify-pipeline` — that is
  Code's responsibility.
- Sub-agents MUST NOT modify the request artifact body — they only
  write their respective review artifact.
- Sub-agents MUST NOT install or persist external material (no
  `npm install` of unapproved packages, no Playwright MCP install).
- Sub-agents return a compact JSON envelope
  (`{ ok, artifact, blockers, notes }`) to the parent RD loop; the
  parent aggregates into the final qa-handoff.

## Aggregation

The parent RD loop receives the 3 envelopes, runs `peaks request lint`
on the produced artifacts, and only then attempts
`peaks request transition --state qa-handoff`. The aggregation step
runs 3 ls checks: Gate B3 (code-review file), Gate C2 (qa-test-cases
pre-draft, the 2nd sub-agent's deliverable), and the KARPATHY_REVIEW
prereq (the 3rd sub-agent's `rd/karpathy-review.md`). The audit
prereqs (`AUDIT_SECURITY` + `AUDIT_PERF` + `AUDIT_REQUIRES_HANDOFF`)
are NOT fan-out outputs — they are produced by the standalone audit
skills and consumed by the CLI gate. A failure in any of the 3
fan-out sub-agents → blocked, no auto-downgrade.

## Degradation

When the `qa-test-cases-writer` sub-agent fails, the parent RD loop
records the failure as `qa-test-cases-subagent-degraded-to-inline-qa-draft`
in the request artifact and proceeds; the QA main loop falls back to
drafting the test plan inline at Gate D. The other 2 sub-agents
(`code-reviewer`, **`karpathy-reviewer`**) are NOT degradeable — their
failure blocks qa-handoff. The `karpathy-reviewer` is a hard gate per
karpathy §1 Think Before Coding + §3 Surgical Changes.

### karpathy-reviewer contract (Slice 5/6)

**Inputs**:
- The verbatim 4-section Karpathy-guidelines block (injected by
  `rd-sub-agent-dispatch.md` §"Karpathy-guidelines context").
- The current slice's diff (changed files + their content).
- The current slice's `.peaks/_runtime/<sessionId>/prd/handoff.md`
  (v2.11.0: architecture summary — the immutable peaks-prd handoff
  replaces `rd/tech-doc.md`).
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

**Hard prohibitions** (in addition to the 3-sub-agent block above):
- MUST NOT write code, modify the request artifact, or call
  `peaks request transition`.
- MUST NOT install hooks, agents, MCP, or settings.
- MUST NOT touch Slice 1+2+3+4 products (zero regression).
- MUST NOT skip the `## Karpathy-Gate` header. The CLI gate
  enforces its presence; absence blocks the transition.

## Deprecated reviewer back-compat (v2.12.0)

The 2 removed sub-agent slots (`security-reviewer`, `perf-baseline-reviewer`)
are exposed as `RD_DEPRECATED_REVIEWERS` in
`src/services/rd/reviewer-dispatch-policy.ts`. The
`isDeprecatedReviewer(name)` predicate lets back-compat code detect
a legacy dispatch record and route to the new audit skill instead of
failing the gate.

**Back-compat contract (v2.12.0 1-minor-release window only):**

- **On-disk dispatch records** (`.peaks/_sub_agents/<sessionId>/dispatch/<name>.json`)
  for `security-reviewer` or `perf-baseline-reviewer` are routed to the
  new audit skill by `isDeprecatedReviewer(name)`. No CLI gate failure.
- **Legacy review artifact paths**
  (`.peaks/_runtime/<sessionId>/rd/security-review.md`,
  `.peaks/_runtime/<sessionId>/rd/perf-baseline.md`) are accepted via
  `mustContainAny: [...]` on the `AUDIT_SECURITY` / `AUDIT_PERF` prereqs
  during the back-compat window. v2.13.0 hard-deletes the legacy paths.

**Pinning:** `tests/unit/rd/deprecated-reviewer-back-compat.test.ts`
(8 cases) pins the dispatch routing + the legacy-path acceptance.

## Gate C evidence (RD-side, type-specific)

| Request type | Required RD evidence (under `.peaks/_runtime/<sessionId>/`) |
|---|---|
| feature / refactor | `prd/handoff.md` (immutable) + `audit/security.md` (peaks-security-audit) + `audit/perf.md` (peaks-perf-audit) + `rd/code-review.md` + `rd/karpathy-review.md` + `qa/test-cases/<rid>.md` |
| bugfix | `prd/handoff.md` (immutable) + `audit/security.md` (peaks-security-audit) + `audit/perf.md` (peaks-perf-audit, perf-shaped only) + `rd/code-review.md` + `rd/karpathy-review.md` + `qa/test-cases/<rid>.md` |
| config | `audit/security.md` (peaks-security-audit) |
| docs / chore | (no extra evidence required) |

Always required (in addition to the type-specific row):
`ls .peaks/_runtime/<sessionId>/rd/requests/<rid>.md`. Missing any required file →
DO NOT attempt the qa-handoff transition; CLI will reject with
`PREREQUISITES_MISSING`.

> **v2.11.0 change (Group A):** `rd/tech-doc.md` is removed from the
> required-evidence matrix; the immutable peaks-prd handoff
> (`prd/handoff.md` with sha256 frontmatter) replaces it as the
> per-slice source of truth.
>
> **v2.12.0 change (Group A — Tier 4+5):** `rd/security-review.md` and
> `rd/perf-baseline.md` are removed from the required-evidence matrix;
> `audit/security.md` (peaks-security-audit) + `audit/perf.md`
> (peaks-perf-audit) replace them. The `AUDIT_REQUIRES_HANDOFF` prereq
> enforces the immutable handoff consumption by the audit skills.