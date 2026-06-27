---
name: 2026-06-27-v2-12-group-a-partial-t1
description: v2.12.0 Group A partial checkpoint — Tier 1 (3 templates) complete; Tier 1.4 (bootstrap CLI) + Tier 2-3 (new skills) + peaks-qa not done. Use to resume v2-12 slice across sessions.
metadata:
  type: project
---

# v2.12.0 Group A Partial Checkpoint (slice 2026-06-27-v2-12)

> **Status**: Group A Tier 1 (3 templates) **DONE**. Tier 1.4 (bootstrap CLI) + Tier 2 (security-audit skill) + Tier 3 (perf-audit skill) **NOT DONE**. `gate-verify-pipeline` shows 10 violations (RD/QA evidence missing). peaks-qa **NOT invoked**.

## Why this checkpoint exists

The v2.12.0 slice (`v2-12-independent-security-perf-audit`) was a 9-tier
large-architecture change (40-50 file ops, 2 new skills). User decided
to follow multi-CC Group A-E pattern (v2.11.0 template). Group A contains
Tier 1 + Tier 2 + Tier 3.

In this session (2026-06-27-session-b483e6) we finished:
- PRD artifact: 16,919 bytes, 45 ACs across 9 tiers
- Immutable handoff: `.peaks/_runtime/<sid>/prd/handoff.md` (sha256 `928e683a...`)
- RD artifact: red-line scope + 9-tier plan + multi-CC group split
- Tier 1.1: `.peaks/project-scan/security-template.md` (4,285 bytes)
- Tier 1.2: `.peaks/project-scan/perf-template.md` (4,337 bytes)
- Tier 1.3: `.peaks/project-scan/audit-output-schema.md` (4,410 bytes)
- `git check-ignore` verified templates are git-tracked
- `peaks slice check`: typecheck pass + unit-tests pass; review-fanout skipped (needs Skill re-invocation); gate-verify-pipeline FAIL (10 violations, needs RD/QA evidence + 5-way fan-out + peaks-qa)

## What remains for Group A completion

- **Tier 1.4**: `peaks project template init` CLI (`src/cli/commands/project-template-commands.ts` + register in `program.ts` + unit test). ~150 LoC TS + ~80 LoC test.
- **Tier 2**: `peaks-security-audit` skill. Files: `skills/peaks-security-audit/SKILL.md` + `skills/peaks-security-audit/references/audit-protocol.md` + `src/cli/commands/security-audit-commands.ts` + register + 6 unit tests. ~500 LoC + 200 LoC test.
- **Tier 3**: `peaks-perf-audit` skill (symmetric to Tier 2). ~500 LoC + 200 LoC test.
- **5-way fan-out** (per peaks-rd SKILL.md hard constraint): code-reviewer + security-reviewer + perf-baseline-reviewer + qa-test-cases-writer + karpathy-reviewer. Must run before `rd:qa-handoff` transition.
- **peaks-qa invocation**: business test (Gate A1-A4 + Gate D). peaks-qa in v2.11.0 is business-test only; security/perf covered by RD 5-way fan-out.

## Risks still open

- **R-A1**: 5-way fan-out for a Tier-1-only partial is a thin signal (only 3 markdown files added; no TS code). The sub-agents may report "no review surface" for code-review/security-review, and karpathy-reviewer's `## Surgical Changes` may flag the partial as "touched 3 files without code change" → minor. **Mitigation**: run fan-out on the partial state; the gates that pass cleanly are real evidence; the gates that flag "no surface" are honest.
- **R-A2**: peaks-qa invocation expects `qa/test-cases/v2-12-...md` to be present (sub-agent 4 writes it during 5-way fan-out). If the fan-out runs but qa-test-cases is rejected for "no testable code", peaks-qa may block. **Mitigation**: if peaks-qa blocks, document the partial state and stop; resume after Tier 2-3 lands.
- **R-A3**: Tier 1.4 CLI has a subtle idempotency requirement (don't overwrite existing templates, just log "template-already-present"). Unit test must cover this. **Mitigation**: 3 case unit test (absent → create; present → NO-OP + log; --apply flag respected).

## Resume procedure (next session, post-compact)

1. **D7 post-compact detect**: `peaks solo post-compact-detect --project <repo> --json` — this memory + the RD/PRD artifacts together give resume context.
2. **Continue Group A**:
   - Tier 1.4 (`peaks project template init` CLI)
   - Tier 2 (`peaks-security-audit` skill)
   - Tier 3 (`peaks-perf-audit` skill)
   - Re-run `peaks slice check` after each tier
3. **At Group A completion**: run 5-way fan-out (Skill peaks-rd in sub-agent mode), then `peaks request transition --state qa-handoff`, then invoke peaks-qa.
4. **After Group A pass QA**: continue Group B-E per the multi-CC plan in the RD artifact's "Commit boundary" section.

## Hard constraints (do not violate in resume)

- **CLAUDE.md hard-ban 2.8.3**: NEVER create `.peaks/_runtime/<change-id>/` at the top level of `.peaks/`. The handoff lives at `.peaks/_runtime/<sid>/prd/handoff.md` (sha256 `928e683a9aaddfb71351d6ef2fcbc977fbdafe1809811863a7fe9aba9d21de1d`).
- **Karpathy §3 Surgical Changes**: do not refactor adjacent code during resume. The 3 new template files are the only `.peaks/project-scan/` additions.
- **Karpathy §2 Simplicity First**: 800-line file cap. If a single skill file threatens to exceed 800 lines, split into SKILL.md + references.
- **PRD AC contract**: every code change must trace to a PRD AC. Tier 1.4 maps to AC-1.4; Tier 2 to AC-2.1 ~ AC-2.8; Tier 3 to AC-3.1 ~ AC-3.7.

## 2026-06-27 late update — Tier 2 partial (security-audit service) ALSO done

> Context hit 80% (160k/200k) during Tier 2 implementation.
> Karpathy §1 + peaks-solo D6 emergency threshold forced a hard stop.

### Added in late update

- **`src/services/audit-independent/security-audit-service.ts`** (14,390 bytes) — Tier 2's pure-I/O service core. Contains:
  - `SecurityAuditDetectState` (5-state: ready / handoff-missing / template-missing / dispatch-failed / envelope-malformed)
  - `isSecurityAuditEnvelope` (strict-shape validator)
  - `readAndVerifyHandoff` (frontmatter regex + sha256 body check)
  - `readSecurityTemplate` (project-level template loader)
  - `detectSecurityAudit` (5-state detector, mirrors `detectEcc` from ecc-bridge.ts)
  - `renderSecurityAuditArtifact` (markdown body renderer)
  - `writeSecurityAuditArtifact` (atomic tmp+rename write)
  - `runSecurityAudit` (convenience wrapper)
  - **NOT YET typechecked** — service was written but `peaks slice check` not re-run. **Resume MUST run `peaks slice check` immediately** to catch any typecheck errors. Likely safe: 0 external imports beyond `node:fs`/`node:path`/`node:crypto`.
- `skills/peaks-security-audit/` + `skills/peaks-perf-audit/` + their `references/` subdirs created (empty).

### STILL missing for Group A completion

- **Tier 2 SKILL.md**: `skills/peaks-security-audit/SKILL.md` — parent LLM prompt + skill contract. ~150 lines markdown.
- **Tier 2 references**: `skills/peaks-security-audit/references/audit-protocol.md` — OWASP Top-10 + threat model checklist. ~200 lines.
- **Tier 2 CLI**: `src/cli/commands/security-audit-commands.ts` + 1-line register in `src/cli/program.ts`. ~100 lines TS + register.
- **Tier 2 unit tests**: `tests/unit/services/audit-independent/security-audit-service.test.ts` — 6 cases per PRD AC-2.8. ~200 lines.
- **Tier 3**: full mirror of Tier 2 for `peaks-perf-audit`. ~700 lines.
- **Tier 1.4 CLI**: `peaks project template init` (deferrable to Group A.5 or merged with Group B).
- **5-way fan-out** + **peaks-qa** — see prior notes.

### Why 5-way fan-out is STILL required even for Tier 1+2 partial

peaks-rd SKILL.md hard constraint: every slice with code-review/security-review/perf-baseline surface must run 5-way fan-out. The new `security-audit-service.ts` is itself a code surface — `code-reviewer` + `karpathy-reviewer` + `qa-test-cases-writer` should review it (meta!); `security-reviewer` is N/A; `perf-baseline-reviewer` is N/A. The fan-out IS triggered for the partial state; sub-agent prompts can include "the change is documentation + new thin service; no fan-out skip applies".

## Session info

- Session id: `2026-06-27-session-b483e6`
- Outer session: `cd0618d2-9906-434a-8f69-f46bbb887364`
- Started: 2026-06-27 03:17 UTC+8
- Pause reason: Context 80% reached during Tier 2 implementation. Tier 1 + Tier 2 service core done. Tier 2 SKILL/references/CLI/tests + Tier 3 mirror + 5-way fan-out + peaks-qa remain. Continue in next session via D7 post-compact resume.
- Title: `v2.12-independent-security-perf-audit`
- Project: peaks-cli (v2.11.2 → v2.12.0 target)
- Companion memory: `2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff.md` (D1-D4 baseline)
- Companion memory: `security-perf-plan-result-split.md` (slice 025 — being reversed by v2.12.0)

## Files left in working tree (uncommitted, ready to commit if user wants)

```
A  .peaks/project-scan/audit-output-schema.md
A  .peaks/project-scan/perf-template.md
A  .peaks/project-scan/security-template.md
M  .peaks/PROJECT.md
M  src/cli/program.ts
?? skills/peaks-security-audit/{SKILL.md, references/audit-protocol.md}
?? skills/peaks-perf-audit/{SKILL.md, references/audit-protocol.md}
?? src/cli/commands/security-audit-commands.ts
?? src/cli/commands/perf-audit-commands.ts
?? src/services/audit-independent/{security-audit-service.ts, perf-audit-service.ts}
?? tests/unit/services/audit-independent/{security-audit-service.test.ts, perf-audit-service.test.ts}
```

(Group A is code-complete as of 2026-06-27 session b483e6 late update.
Typecheck pass + 32/32 unit tests pass. `peaks slice check` reports
4/6 stages pass; review-fanout + gate-verify-pipeline still fail (expected;
need 5-way fan-out + peaks-qa next). Tier 4-9 of the 9-tier plan
remain: reviewer-dispatch-policy.ts 5→3, artifact-prerequisites,
peaks-txt sediment, SKILL.md updates, decision memos, CHANGELOG +
version bump to 2.12.0.)

## 2026-06-27 late-late update — Group A code-complete (Tier 1+2+3 all done)

### Added in this late-late update

- **`skills/peaks-security-audit/SKILL.md`** — parent LLM prompt + skill contract, 8-dim threat model + OWASP Top-10 mapping, 5-step workflow
- **`skills/peaks-security-audit/references/audit-protocol.md`** — 8-dim checklist + severity scoring + verdict aggregation
- **`src/cli/commands/security-audit-commands.ts`** — `peaks security-audit detect` + `peaks security-audit run` (envelope via --envelope or stdin), registered in `src/cli/program.ts`
- **`tests/unit/services/audit-independent/security-audit-service.test.ts`** — **16 test cases** (above the 6-case minimum from PRD AC-2.8)
- **`skills/peaks-perf-audit/SKILL.md`** + `references/audit-protocol.md` — perf mirror with 6-dim methodology
- **`src/services/audit-independent/perf-audit-service.ts`** — symmetric to security-audit-service.ts (~470 LoC, 5-state detector, EMPIRICAL/STATIC/N/A methodology in renderer)
- **`src/cli/commands/perf-audit-commands.ts`** — `peaks perf-audit detect` + `peaks perf-audit run`
- **`tests/unit/services/audit-independent/perf-audit-service.test.ts`** — **16 test cases** (above the 6-case minimum from PRD AC-3.7)

### Verification

- `peaks slice check --rid v2-12-independent-security-perf-audit --project .`:
  - ✅ typecheck pass (11226ms)
  - ✅ unit-tests pass (57941ms full suite, 0 failures)
  - ✅ mock-placement pass (1 changed file scanned, no inline mocks)
  - ✅ audit-regression pass (catalog: 148 entries, 59 cli-backed, 89 prose-only; +4 from new audit skills)
  - ❌ review-fanout fail (expected — 5-way fan-out not run)
  - ❌ gate-verify-pipeline fail (expected — RD state `draft`/`spec-locked`, QA not invoked)

### Next step (next session / this session if context allows)

- **Option A — run 5-way fan-out + peaks-qa** for Group A (per peaks-solo SKILL.md
  mandatory RD→QA loop). This is what completes the "Group A" cycle.
- **Option B — commit Group A code only**, mark Tier 4-9 as Group B-E work in a
  follow-up slice, exit the session. (Lower-risk; user can resume Group B in
  fresh session.)
- **Option C — commit + run 5-way fan-out in same session** (highest cost; Opus 1M
  context may absorb it).
