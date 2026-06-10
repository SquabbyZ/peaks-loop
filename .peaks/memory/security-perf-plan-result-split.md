# Security + Perf plan/result split (slice 025)

> Source: project-local lesson, captured 2026-06-10 from slice 025.
> Scope: applies to any peaks-cli project that uses the QA security +
> perf gates. Future slices / projects that touch the same surface must
> read this first.
> Reading: read this before extending Gate C, the QA fan-out, or any
> CLI command that writes a project-level plan artifact.

## Lesson

The pre-slice-025 workflow regenerated the full security-findings +
performance-findings artifacts every slice. The threat model + perf
baseline are project-level and stable; the per-slice delta is what
actually changes. Regenerating the project-level content every slice
was a pure token waste and a contradiction with `mandatory-perf-baseline.md`
(which says the baseline must be "stable", but the workflow wrote a
fresh one every time).

The fix is a **plan/result split**:

- **Plan** (project-level, one per session, refreshed on trigger):
  `.peaks/_runtime/<sessionId>/qa/security-test-plan.md`,
  `.peaks/_runtime/<sessionId>/qa/perf-baseline.md`. Deterministic
  body (sorted inputs + normalized output → stable hash). Refresh
  triggered by new dep, new file under sensitive service dirs, new
  `*auth*.ts` file, new route/command registration, or `--refresh`.
- **Result** (slice-level, one per rid):
  `qa/security-findings-<rid>.md`, `qa/performance-findings-<rid>.md`.
  Lean — opens with a `## Plan reference` block (plan-hash, plan-path,
  unchanged-since) and only contains the slice diff.

The 3-of-3 token win (per PRD AC8): a 3-slice sequence produces
3 slice-level results + 1 plan each (instead of 3 each). The CLI
primitives that make this work live under `peaks workflow plan *`:

| Command | Justification (dev-preference rule) |
|---|---|
| `peaks workflow plan read <security\|perf>` | (2) JSON-gated — slice workflow reads plan hash |
| `peaks workflow plan refresh <security\|perf> --apply` | (3) destructive write needs explicit `--apply` |
| `peaks workflow plan detect-trigger` | (2) JSON-gated — slice workflow needs the verdict |

No new top-level CLI verb. All under the existing `peaks workflow`
group. Per the dev-preference skill-first / CLI-auxiliary rule, the
plan is the workflow's product, and the CLI primitives are the
machine-enforced gates (the JSON envelope + the `--apply` opt-in).

## Locked decisions (user-confirmed 2026-06-10)

1. **Trigger scope**: `dependencies` + `optionalDependencies` only.
   `devDependencies` are excluded (they don't affect runtime attack
   surface).
2. **Storage scope**: session-scoped. Consistent with all other QA
   artifacts; re-scan cost is bounded.
3. **Token target**: ≥ 40% line-count reduction on a 3-slice sequence.

## Anti-patterns (do NOT do)

- Do not regenerate the project-level plan on every slice. Hash must
  be stable so the result's `unchanged-since` line is honest.
- Do not add devDependencies to the trigger scan. Locked Q1.
- Do not write the new CLI commands under a new top-level verb
  (`peaks plan ...` is wrong). Use `peaks workflow plan ...`.
- Do not modify the legacy non-suffixed form in place. The
  `resolveSecurityFindingsPath` / `resolvePerformanceFindingsPath`
  helpers in `src/services/workflow/artifact-paths.ts` are the
  single source of truth for the 1-minor-release back-compat window.
- Do not bypass the `normalizePlanBody` step before hashing. The
  hash must be independent of cosmetic re-ordering.

## What lives where (post-slice-025)

| File | Purpose |
|---|---|
| `src/services/workflow/plan-reader.ts` | Read envelope + hash + mtime |
| `src/services/workflow/plan-refresher.ts` | Generate deterministic body |
| `src/services/workflow/plan-trigger-detector.ts` | 5-rule trigger table |
| `src/services/workflow/artifact-paths.ts` | `resolveSecurityFindingsPath` / `resolvePerformanceFindingsPath` + lazy migration |
| `src/cli/commands/workflow-plan-commands.ts` | 3 subcommands under `peaks workflow plan` |
| `skills/peaks-qa/references/qa-security-test-plan.md` | Plan content schema + trigger table |
| `skills/peaks-qa/references/qa-perf-test-plan.md` | Same for perf |
| `skills/peaks-qa/references/qa-transition-gates.md` | Gate C accepts both forms during 1-minor-release |
| `skills/peaks-rd/references/mandatory-perf-baseline.md` | "Stable across slices within a session; refreshed on trigger" |

## Risks still open (slice-026+ follow-ups)

- The hash is computed on the normalized body, not on a structured
  fingerprint of the inputs (deps + file list). If two projects
  produce different bodies that normalize to the same string, the
  hash collides. AC1 only requires the deterministic refresh;
  collision-resistance is not in scope for this slice.
- The `peaks workflow plan refresh` body builder is currently a
  hand-rolled walker of `src/services/{auth,security,secrets,payments,filesystem}/`
  + `src/cli/commands/*-commands.ts`. Future cross-cutting additions
  (e.g. `src/services/observability/`) need a follow-up slice.
- AC8's "≥ 40% reduction" target is asserted via the integration test
  suite, not in production. The unit tests cover determinism +
  idempotency only; the line-count comparison is a fixture-based
  check.
