# v2.12.0 fan-out collapse (Group A — Tier 1+2+3+4+5)

The v2.12.0 release collapses the peaks-rd parallel review fan-out from
**5 sub-agents** (slice 002 3-way + slice 004 qa-test-cases + slice 5/6
karpathy-reviewer) to **3 sub-agents** by moving
`security-reviewer` + `perf-baseline-reviewer` out of the RD fan-out
into two new standalone audit skills.

## Removed sub-agent slots

- `security-reviewer` — moved to standalone `peaks-security-audit` skill.
  Output: `.peaks/_runtime/<sessionId>/audit/security.md`.
  Required RD-side prereq: `AUDIT_SECURITY`.
- `perf-baseline-reviewer` — moved to standalone `peaks-perf-audit` skill.
  Output: `.peaks/_runtime/<sessionId>/audit/perf.md`.
  Required RD-side prereq: `AUDIT_PERF`.

Both audit skills consume the immutable peaks-prd handoff
(`.peaks/_runtime/<sessionId>/prd/handoff.md`) and the project-scoped
audit templates under
`.peaks/project-scan/{security-template, perf-template, audit-output-schema}.md`.
The handoff presence is enforced by the `AUDIT_REQUIRES_HANDOFF` prereq.

## CLI surface

- `peaks security-audit run` — dispatches `peaks-security-audit` skill.
- `peaks perf-audit run` — dispatches `peaks-perf-audit` skill.

Both produce output as side-effects on the standard paths above. They
are runnable before RD (as a pre-RD audit pass) or in parallel with
RD's 3-way fan-out.

## Back-compat window

The 1-minor-release back-compat window (`v2.12.0`) keeps the legacy
paths readable via `mustContainAny` on the new prereqs:

- Legacy `rd/security-review.md` → accepted via `AUDIT_SECURITY.mustContainAny`.
- Legacy `rd/perf-baseline.md` → accepted via `AUDIT_PERF.mustContainAny`.
- Legacy `RD_FANOUT_REVIEWERS`-slot dispatch records → routed via
  `isDeprecatedReviewer(name)` to the new audit skill.

v2.13.0 hard-deletes the legacy paths.

## Pinning

- `tests/unit/rd/karpathy-skip-on-config-docs-chore.test.ts` — 6 cases pinning the 3-element `reviewerListFor('feat')` shape.
- `tests/unit/rd/deprecated-reviewer-back-compat.test.ts` — 8 cases pinning `isDeprecatedReviewer` + the legacy-path acceptance.
- `tests/unit/artifact-prerequisites-typed.test.ts` — back-compat for the prereq forms.
- `tests/unit/parallel-fan-out.test.ts` — 18 cases pinning the 3-way SKILL.md + reference content.
- `tests/unit/skills/karpathy-5way-fanout.test.ts` — 17 cases pinning the v2.12.0 collapse invariants.

## Migration sequence

1. Run the standalone audit skills (`peaks security-audit run` +
   `peaks perf-audit run`) at pre-RD time.
2. RD-side fan-out dispatches only the 3 sub-agents
   (`code-reviewer` + `qa-test-cases-writer` + `karpathy-reviewer`).
3. The `AUDIT_SECURITY` + `AUDIT_PERF` + `AUDIT_REQUIRES_HANDOFF`
   prereqs block the `rd:qa-handoff` transition if the audit outputs
   are missing.
4. The 1-minor-release back-compat window reads the legacy
   `rd/{security-review,perf-baseline}.md` paths via `mustContainAny`
   if the new audit outputs are absent.