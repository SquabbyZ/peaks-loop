# Peaks-Loop Job Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a `Job` construct as an outer wrapper around the existing single-rid runbook so peaks-solo can drive long multi-slice work (e.g. add UT for every `app/` subdirectory) without stopping after the first slice.

**Architecture:** A new `peaks job *` CLI family (9 subcommands) + new `src/services/job/*` modules (state machine + state store + subagent wrapper + rotation + resource snapshot). Wraps the existing peaks-solo runbook Step 2-7 in an outer loop (new Step 0.8 / 0.81 / 0.85 / 0.86 / 0.87). Foreground-only, real-time visible (3-layer visibility: transcript / `--watch` / statusline). Main-session context safety via `--main-loop-strategy single|rotating` (rotating hard-default for ≥3 slices). Sub-agent resource safety via a Job-aware wrapper that mandates `--budget-mb` and a cleanup gate.

**Tech Stack:** TypeScript ≥ 5.7 strict ESM, Commander (CLI), Zod (schema), vitest, pnpm 10. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-07-03-peaks-loop-job-design.md` (v3, 4 commits `6581f6c` `9de94b0` `fdbea13` `3192154`).

---

## Global Constraints

Copy these to every task's scope checklist:

- TypeScript ≥ 5.7 strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (per `tsconfig.json`)
- ESM / `module: "NodeNext"`
- File ≤ 800 lines (Karpathy #2 Simplicity First)
- Zod for ALL CLI-input schemas and on-disk state schema (per §4.2 of spec)
- pnpm 10.11+ (per `package.json` packageManager)
- vitest for tests; mirror existing `tests/unit/<domain>/<file>.test.ts` layout
- Code follows existing patterns: `src/cli/commands/<domain>-commands.ts` + `src/services/<domain>/*` + `tests/unit/<domain>/*`
- PR forbids `Co-Authored-By: Claude / Anthropic` trailer (CLAUDE.md red rule); SquabbyZ sole author
- No new runtime dependencies unless an existing dep does not provide the primitive

---

## Milestones

| M | Plan file | Scope | Output |
|---|---|---|---|
| **M1** | `M1-spec-types.md` | Spec final types + Zod schemas + CLI help snapshot | `src/services/job/job-types.ts`, snapshot test |
| **M2** | `M2-state-machine.md` | Job orchestrator + state store + transition tests (single mode, basic ops) | `src/services/job/job-orchestrator.ts`, `job-state-store.ts`, transition tests |
| **M3** | `M3-cli-family.md` | 9 `peaks job *` subcommands wired (init / status / checkpoint / continue / resume / block / handoff / rotate-now / subagent-cleanup) | `src/cli/commands/job-commands.ts`, CLI tests |
| **M4** | `M4-solo-rotating.md` | Solo SKILL.md Step 0.8/0.81/0.85/0.86/0.87 + `job-rotation.ts` + runbook + visibility prose | `src/services/job/job-rotation.ts`, SKILL.md patches, runbook patch |
| **M5** | `M5-subagent-resource.md` | `subagent-job-wrapper.ts` (budget-mb + cleanup gate) + `job-resource-snapshot.ts` + statusline event hook | Wrapper, snapshot, statusline |
| **M6** | `M6-e2e-fault-inject.md` | 8-slice E2E + context-explosion noise injection + sub-agent budget breach | `tests/integration/job-e2e.test.ts` |
| **M7** | `M7-regression-release.md` | Run existing solo runbook (no regression) + spec re-commit + memory sediment | Release notes, memory |

Total effort: **~7.5 working days, single dev, full-auto.**

---

## Execution Order

The 7 milestones MUST be executed **in order**. Each milestone produces an independently testable + releasable deliverable. M1-M3 may ship together as a Job v0.1 alpha. M4 adds the Solo integration. M5 + M6 are safety-critical and gate the v1.0 release.

---

## Acceptance

All 14 ACs from spec §7 must pass before M7 sign-off. See `tests/unit/job/` and `tests/integration/job-e2e.test.ts` for verification.

---

## Risks (inherited from spec §8.3)

1. LLM fuzzer strength for 9 red lines — needs PoC in M2
2. Job state vs session state boundary — refine in M4 after first rotation
3. Multi-job concurrency — out of scope for v1
4. Rotating-mode becomes hot path (per Q4 round 3) — M4 + M6 testing is heavy
5. Statusline integration per-IDE — only Claude Code MVP; others wait
