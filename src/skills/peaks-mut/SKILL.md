---
name: peaks-mut
description: Mutation testing + assertion validity scan for Peaks. Use when a workflow needs to catch test fake-green (coverage looks fine but tests do not actually exercise behavior). Runs Stryker mutants and a 5-pattern weak-assertion AST scan, then emits a hashable MUT.sig report that chains to TACT.sig.
---

## Two-axis naming convention

> **Read once at the top of this file; the rest of the skill is written against it.**

The `.peaks/` workspace is partitioned by **two orthogonal axes**: **change-id** (reviewable artifacts at `.peaks/_runtime/<changeId>/...`) and **session-id** (ephemeral state at `.peaks/_runtime/<sessionId>/...`), with a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. Use `<changeId>` / `<sessionId>` placeholders (NEVER bare `<sid>`). CLI axis mapping: change-id → `peaks request *` / `peaks scan *`; session-id → `peaks session *`; sub-agent → `peaks sub-agent *`. Regression test `tests/unit/skills/skills-skill-md-naming.test.ts` enforces (a) zero bare `<sid>`, (b) every `.peaks/_runtime/<X>/` has an axis label, (c) this callout is present.

# Peaks-Cli Mut

Catches **test fake-green** — the failure mode where coverage numbers look fine but tests do not actually exercise behavior (PRD §1.1(二) / §4.2 验收审计 / §7 阶段二).

## Skill presence (MANDATORY first action)

Before any analysis or tool call, immediately run:

```bash
peaks skill presence:set peaks-mut --project <repo> --mode <mode> --gate startup
```

**When invoked as a sub-agent (peaks-solo swarm):** do NOT call `peaks skill presence:set` (Solo owns the active-skill marker) and do NOT spawn your own session. Use the parent's sid — read `.peaks/_runtime/session.json` or pass `--session-id <parent-sid>` to any session-creating CLI. The new `peaks session info --active` reads the canonical binding for you.

On the first presence:set in a project, ensure the out-of-band status bar is installed so the user can see at a glance that Peaks is orchestrating — it renders the active skill in Claude Code's terminal status line, independent of model output:

```bash
peaks statusline install --project <repo>   # idempotent; skips if already installed
```

Read persistent project memory via CLI (durable, LLM-authored memories):

```bash
peaks project memories --project <repo> --json
```

This returns durable memories from `.peaks/memory` — decisions, conventions, modules, and rules captured in past sessions. Filter with `--kind <decision|convention|module|rule|reference|project>`. (`.peaks/PROJECT.md` is a human-readable session timeline only.)
Then display: `Peaks-Cli Skill: peaks-mut | Peaks-Cli Gate: startup | Next: <one short action>`. Update with `peaks skill presence:set peaks-mut --project <repo> --mode <mode> --gate <gate>` when gates change. When the role's work ends, run `peaks skill presence:clear --project <repo>`.

## What peaks-mut actually does

Two independent signals feed a single report:

1. **Mutation testing** — Stryker mutates source code under test. Existing tests must KILL each mutant. A low kill rate means tests accept behaviour changes that should fail them. Default tool: `stryker`. Schema reserves `mutmut` and `go-mutesting` for future slices.
2. **Weak-assertion scan** — regex/AST scan over test files for 5 patterns that pass on `null`, `undefined`, `void`, or the receiver itself: `toBeDefined`, `toBeTruthy`, `toEqual-self`, `expect-anything`, `toBe-self`. Each hit is a `WeakExample` (file + line + code).

Both signals are combined into `MutReportJson` (version `1.0`) with MUT.sig = `sha256` of canonicalised content, chained to the upstream TACT.sig via the `inputSig` field. H6 (CLI裁决, not LLM): `thresholds.passed` and `followups[]` are computed by the CLI; the LLM only consumes them.

## When to use

peaks-solo or peaks-rd dispatches peaks-mut after peaks-rd/战术 (TACT.sig exists). The flow:

1. peaks-mut consumes `context.json --audience peaks-mut` (built by peaks-context Phase 1).
2. Stryker mutates test-target source code; existing tests must kill the mutants.
3. AssertScanner finds 5 weak-assertion patterns: `toBeDefined`, `toBeTruthy`, `toEqual-self`, `expect.anything`, `toBe-self`.
4. Outputs `mut-report.json` with `MUT.sig` chained to `TACT.sig` (inputSig field).
5. peaks-qa reads MUT.sig during validation (slice Task 8 wiring).

## Thresholds (default)

| Metric | Default | Severity | Override |
|---|---|---|---|
| `mutationKillRateMin` | `0.80` | soft — AskUserQuestion to override | `peaks-mut.config.json` at project root |
| `weakAssertionRateMax` | `0.05` | hard — refuse by default | same file |

A breach sets `thresholds.passed = false`. Soft breaches still allow override via the question flow; hard breaches block without confirmation. `passed` is the sole gate for `process.exitCode` from `peaks mut run`.

## CLI

```
peaks mut run     # full audit (Stryker + assertion scan + report)
peaks mut mutants # Stryker only; stub-assertions report
peaks mut asserts # AST scan only; empty-mutation report
peaks mut report  # re-read a previously-written mut-report.json
```

All artifact-producing subcommands require `--session-id <sid>` (one-axis envelope: outputs land at `.peaks/_runtime/<sessionId>/mut/...`). `--change-id` is **never** accepted on the parser — plan 1 followup hotfix (commit `81f00ce`) forbids it.

| Subcommand | Required flags | What it writes | Exit code |
|---|---|---|---|
| `run` | `--project <path> --test-files <files...> --input-sig <hex> --session-id <sid> --out <path> [--json]` | full `MutReportJson` (mutation + assertions + followups) | `1` if `thresholds.passed === false` |
| `mutants` | same as `run` | full `MutReportJson` with empty assertions | `1` if `thresholds.passed === false` |
| `asserts` | same as `run` | full `MutReportJson` with empty mutation | `1` if `thresholds.passed === false` |
| `report` | `--in <path> --session-id <sid> [--json]` | nothing on disk — re-emits a one-line summary | `1` if input report's `thresholds.passed === false`; `2` on invalid JSON or schema failure |

`--json` emits `{ ok, sha256, passed, path }` (run/mutants/asserts) or a structured summary object (report). Without `--json`, plain text is written to stdout. Failures from JSON parse / Zod validation go to stderr with `INVALID_JSON` / `INVALID` prefix.

## Report shape (link to types)

`MutReportJson` is the canonical artifact, validated by `MutReportSchema` (Zod). Source of truth: `src/services/mut/types.ts`. Top-level fields:

```ts
interface MutReportJson {
  readonly version: '1.0';
  readonly sha256: string;       // MUT.sig — sha256 of canonicalised content
  readonly generatedAt: string;  // ISO 8601 — excluded from the sha256 digest
  readonly inputSig: string;     // TACT.sig (64-hex) — chain anchor
  readonly mutation: MutationReport;
  readonly assertions: AssertionsReport;
  readonly thresholds: ThresholdsConfig;  // includes `passed: boolean`
  readonly followups: ReadonlyArray<Followup>;
}
```

`MutationReport` carries `tool`, `mutantsTotal`, `mutantsKilled`, `mutantsSurvived`, `mutantsTimeout`, `killRate` (0..1), and `byFile[]` with per-file kill rate + `survived[]` of `{ line, mutation, survivedBecause }`. `AssertionsReport` carries `totalAssertions`, `weakAssertions`, `weakRate` (0..1), and `weakPatterns[]` of `{ pattern, count, examples[] }` (examples are capped at file+line+code per WeakPatternSchema). `Followup` has `{ file, issue, severity, suggestion }` where `issue ∈ {low_kill_rate, high_weak_assertions}` and `severity ∈ {soft, hard}`.

The MUT.sig digest is **deterministic**: object keys are sorted recursively, `generatedAt` and `sha256` are excluded before hashing, so re-running peaks-mut on unchanged inputs always produces the same sig (good for `peaks-qa` regression detection).

## One-axis envelope invariant

peaks-mut writes ONLY to `.peaks/_runtime/<sessionId>/mut/mut-report.json` (or wherever `--out` points inside that prefix). It never reads from `.peaks/_sub_agents/...`, never writes to `.peaks/_runtime/<changeId>/...`, and never accepts `--change-id`. This invariant matches peaks-qa / peaks-context and keeps the chain MUT.sig → TACT.sig → PRD sig auditable in one place.

## Independent context (防合谋)

peaks-mut's `context.json --audience peaks-mut` view **does not include** `strategy.md` / `impl.json` (PRD §4.2 防合谋). It sees only test files + source under test, so peaks-mut cannot be biased by peaks-rd's design intent when judging test quality. peaks-qa applies the same isolation when it consumes MUT.sig.

## Karpathy guidelines

All 4 guidelines injected (same as peaks-rd). The two relevant ones here:

- **Truthfulness about completion** — peaks-mut MUST NOT report `thresholds.passed = true` if the assertion scan was skipped (e.g. `--asserts` not run). The CLI sets the value from real measurements; the LLM only reads it.
- **No silent swallowing** — peaks-mut MUST NOT silently swallow assertion violations. Every `WeakExample` is preserved in the report (capped per pattern), every `Followup.suggestion` is concrete, and the CLI exit code reflects `thresholds.passed`.

## Default runbook

```bash
# 0. Confirm mut's own runbook integrity
peaks skill runbook peaks-mut --json
peaks skill presence:set peaks-mut --project <repo>  # show persistent skill presence every turn

# 1. Get the upstream TACT.sig (the chain anchor for MUT.sig)
peaks tact read --project <repo> --json | jq -r '.sha256'

# 2. Inventory test files (peaks-context --audience peaks-mut view)
peaks context list-test-files --audience peaks-mut --project <repo> --json

# 3. Run the full audit
peaks mut run \
  --project <repo> \
  --test-files <files...> \
  --input-sig <tact.sig> \
  --session-id <sid> \
  --out .peaks/_runtime/<sid>/mut/mut-report.json \
  --json

# 4. Inspect the report (optional, for human readers)
peaks mut report \
  --in .peaks/_runtime/<sid>/mut/mut-report.json \
  --session-id <sid>

# 5. Sub-runs when the slice is small or partial (e.g. CI)
peaks mut mutants --project <repo> --test-files <files...> --input-sig <tact.sig> --session-id <sid> --out <path> --json
peaks mut asserts --project <repo> --test-files <files...> --input-sig <tact.sig> --session-id <sid> --out <path> --json

# 6. Clean up
peaks skill presence:clear --project <repo>
```

### Transition verification gates (MANDATORY — run the command, see the output)

You cannot declare peaks-mut complete from memory. Each gate below is a `ls` command you **MUST run** and whose output you **MUST see** before proceeding.

**Peaks-Cli Gate A — After `peaks mut run`:**
```bash
ls .peaks/_runtime/<session-id>/mut/mut-report.json
# Expected: a single mut-report.json file. Missing → STOP, the CLI failed.
```

**Peaks-Cli Gate B — Before handing off to peaks-qa (MUT.sig chain is valid):**
```bash
# The report's inputSig MUST equal the upstream TACT.sig.
jq -r '.inputSig' .peaks/_runtime/<session-id>/mut/mut-report.json
# Expected: a 64-char lowercase hex string matching peaks tact read's sha256.
# Mismatch → STOP, the chain is broken — re-run peaks mut run with the right --input-sig.

# The report's own sha256 MUST be a 64-char lowercase hex.
jq -r '.sha256' .peaks/_runtime/<session-id>/mut/mut-report.json
# Expected: 64-char hex. Mismatch → STOP, the CLI wrote garbage.
```

**Peaks-Cli Gate C — Threshold verdict (when a human or CI checks `passed`):**
```bash
jq -r '.thresholds.passed' .peaks/_runtime/<session-id>/mut/mut-report.json
# Expected: `true` (pass) or `false` (fail). When false, the CLI exited with code 1.
```

## Boundaries

- Do not write tests, do not modify source under test, do not pick mutation strategies. peaks-mut only **measures** the test suite and **reports** the verdict.
- Do not commit mut-report.json to source control; it is session-scoped ephemeral state.
- Do not bypass thresholds via the LLM: if `peaks mut run` exits `1`, surface the failure to peaks-qa and the user — do not retry with a relaxed config unless they explicitly ask.
- Do not run Stryker outside `peaks mut run | mutants`; the runner requires the injected `invokeStryker` and the config in `stryker.conf.js` at the project root.
- Do not call `peaks mut report` against a report whose `inputSig` does not match the current TACT.sig — that is a stale report, not authoritative.

Reference: `src/services/mut/` for the service-layer code (`types.ts`, `assert-scanner.ts`, `mut-runner.ts`, `thresholds.ts`, `report-builder.ts`).
