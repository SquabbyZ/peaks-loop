---
name: peaks-mut
description: Mutation testing + assertion validity scan for Peaks. Use when a workflow needs to catch test fake-green (coverage looks fine but tests do not actually exercise behavior). Runs Stryker mutants and a 5-pattern weak-assertion AST scan, then emits a hashable MUT.sig report that chains to TACT.sig.
---

<!-- peaks:loop-hygiene — HAND-MAINTAINED block, NOT generated; byte-identical in every SKILL.md, enforced by tests/unit/skills/loop-hygiene-block.test.ts. Edit one, edit all 25. -->

## Loop hygiene (every turn — MANDATORY)

**Skill header.** While this skill is active, open every turn with
`Peaks-Loop Skill: <skill> | Peaks-Loop Role: <role> | Peaks-Loop Gate: <gate> | Peaks-Loop Context: <ratio%> (<zone>) | Next: <one short action>`.
Every turn, not only the first — it is how the user knows which skill is driving.
`Role` and `Context` are machine facts: copy them from `peaks skill presence --json`
(`data.role`, `data.context.ratioPct`, `data.context.action`) — never invent them.

**Context is this skill's own business.** Run `peaks skill presence --json` every turn and
read its `context` block. When `action` is `auto-fire`, `pre-compact`, or `red-line`,
run `peaks code auto-compact --project .` **yourself**, then continue. Tell the user the
ratio in one line if it helps, but never hand them the compaction step: asking the user to
run `/compact` is the regression the zero-pause contract forbids. This holds in **every
mode** — standard *and* 24h. The mode moves the threshold, never the obligation.

**Read before you edit.** Read a file before your first `Edit` / `Write` / `MultiEdit` on
it — the normal way to work here — for every path outside `.peaks/**` (source, tests, docs,
config); `.peaks/**` writes are exempt.

**Expect one denial per file anyway — and do NOT pre-empt it.** A `PreToolUse` gate (ECC's
"Fact-Forcing Gate") denies the FIRST edit a session makes to any given path, once, by
design. Reading does NOT prevent it: the gate keys on the path's first touch, not on whether
you read it. **Do not recite its four questions before every edit** — it asks when it wants
them, and reciting unprompted burns a round-trip per file for nothing. Answer only when a
denial actually arrives.

**When one does arrive:** a denial is not a failure and the tool is not broken — your edit
was NOT applied. State the facts it asks for (importers, affected API, data schemas if any,
the user's verbatim instruction), then retry the SAME operation. The retry is allowed. Do not
switch tools, do not give up, do not retry blindly. One more thing worth knowing: an idle gap
of ~30 minutes clears the gate's "already passed" list, so a file you cleared earlier can be
denied again after a long pause. That is the gate resetting, not you regressing.
<!-- /peaks:loop-hygiene -->

## Single-axis naming convention

> **Read once at the top of this file; the rest of the skill is written against it.**

The `.peaks/` workspace has a **single scope axis** — **session-id** (ephemeral state at `.peaks/_runtime/<sessionId>/...`) — with a nested **sub-agent axis** under `.peaks/_sub_agents/<sessionId>/...`. The peaks-loop change-id axis was removed in slice `2026-06-29-change-id-root-removal`: a date-stamped / change-id-style directory must never sit at the top level of `.peaks/` (it belongs under `.peaks/_runtime/<sessionId>/`), and `tests/unit/workspace/top-level-change-id-guard.test.ts` refuses one. Use `<sessionId>` for runtime paths (NEVER a bare `<sid>` path; the CLI's own help text spells the flag placeholder `<sid>`). CLI axis mapping: session-id → `peaks session *`; sub-agent → `peaks sub-agent *`; request-scoped artifacts → `peaks request *`. Normative by documentation only — the guard that once asserted (a) zero bare `<sid>`, (b) an axis label on every runtime path, and (c) this callout's presence was deleted in `457b9a87`. Comply by convention.

# Peaks-Loop Mut

Catches **test fake-green** — the failure mode where coverage numbers look fine but tests do not actually exercise behavior (PRD §1.1(二) / §4.2 验收审计 / §7 阶段二).

## Skill presence (MANDATORY first action)

Before any analysis or tool call, immediately run:

```bash
peaks skill presence:set peaks-mut --project <repo> --mode <mode> --gate startup
```

**When invoked as a sub-agent (peaks-code swarm):** do NOT call `peaks skill presence:set` (Code owns the active-skill marker) and do NOT spawn your own session. Use the parent's sid — resolve it with `peaks session info --active` (the on-disk `.peaks/_runtime/session.json` path is internal and must NOT be read directly) or pass `--session-id <parent-sid>` to any session-creating CLI.

On the first presence:set in a project, ensure the out-of-band status bar is installed so the user can see at a glance that Peaks is orchestrating — it renders the active skill in Claude Code's terminal status line, independent of model output:

```bash
peaks statusline install --project <repo>   # idempotent; skips if already installed
```

Read persistent project memory via CLI (durable, LLM-authored memories):

```bash
peaks project memories --project <repo> --json
```

This returns durable memories from `.peaks/memory` — decisions, conventions, modules, and rules captured in past sessions. Filter with `--kind <project|decision|convention|rule|reference|feedback|module|lesson|bug|investigation|technical-pattern|project-rule|design|handoff|session-handoff|project-todo|publish-closure|project-closure|slice-closure|slice-pilot-findings|sediment>`. (`.peaks/PROJECT.md` is a human-readable session timeline only.)
Then display: `Peaks-Loop Skill: peaks-mut | Peaks-Loop Role: <role> | Peaks-Loop Gate: startup | Peaks-Loop Context: <ratio%> (<zone>) | Next: <one short action>`. Update with `peaks skill presence:set peaks-mut --project <repo> --mode <mode> --gate <gate>` when gates change. When the role's work ends, run `peaks skill presence:clear --project <repo>`.

## What peaks-mut actually does

Two independent signals feed a single report:

1. **Mutation testing** — Stryker mutates source code under test. Existing tests must KILL each mutant. A low kill rate means tests accept behaviour changes that should fail them. Default tool: `stryker`. Schema reserves `mutmut` and `go-mutesting` for future slices.
2. **Weak-assertion scan** — regex/AST scan over test files for 5 patterns that do not pin a value: `toBeDefined`, `toBeTruthy`, `toEqual-self`, `expect-anything`, `toBe-self`. Each hit is a `WeakExample` (file + line + code).

Both signals are combined into `MutReportJson` (version `1.0`) with MUT.sig = `sha256` of canonicalised content, chained to the upstream TACT.sig via the `inputSig` field. H6 (CLI裁决, not LLM): `thresholds.passed` and `followups[]` are computed by the CLI; the LLM only consumes them.

## When to use

peaks-code or peaks-rd dispatches peaks-mut after peaks-rd/战术 (TACT.sig exists). The flow:

1. peaks-mut takes the test files and the sources under test as explicit inputs (`--test-files`, `--mutate`); there is no `--audience` view to consume.
2. Stryker mutates test-target source code; existing tests must kill the mutants.
3. AssertScanner finds 5 weak-assertion patterns: `toBeDefined`, `toBeTruthy`, `toEqual-self`, `expect-anything`, `toBe-self`.
4. Outputs `mut-report.json` with `MUT.sig` chained to `TACT.sig` (inputSig field).
5. peaks-qa reads the mut report during validation — `peaks verdict aggregate` reads `mut/mut-report.json`, and the contract treats its absence as a warning rather than a gate failure.

## Thresholds (default)

| Metric                 | Default | Severity of the emitted followup                            | Override |
| ---------------------- | ------- | ----------------------------------------------------------- | -------- |
| `mutationKillRateMin`  | `0.80`  | `soft` — the followup carries `issue: low_kill_rate`        | none     |
| `weakAssertionRateMax` | `0.05`  | `hard` — the followup carries `issue: high_weak_assertions` | none     |

A breach sets `thresholds.passed = false`. There is **no** override channel: `buildMutReport` takes the thresholds as an input, falls back to `DEFAULT_THRESHOLDS`, and the CLI never overrides them — so the two defaults above are the only numbers that can apply. `passed` is the sole gate for `process.exitCode` from `peaks mut run` (`1` when it is `false`).

## CLI

```
peaks mut run     # full audit (Stryker + assertion scan + report)
peaks mut mutants # Stryker only; stub-assertions report
peaks mut asserts # AST scan only; empty-mutation report
peaks mut report  # re-read a previously-written mut-report.json
```

All artifact-producing subcommands require `--session-id <sid>` (one-axis envelope: the artifact is keyed by the session id). `--change-id` is **never** accepted on the `peaks mut` parser — plan 1 followup hotfix (commit `81f00ce`) forbids it.

| Subcommand | Flags                                                                                                                          | What it writes                                           | Exit code                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `run`      | `--project <path> --test-files <files...> [--mutate <patterns...>] --input-sig <hex> --session-id <sid> --out <path> [--json]` | full `MutReportJson` (mutation + assertions + followups) | `1` if `thresholds.passed === false`                                                       |
| `mutants`  | `--project <path> --test-files <files...> [--mutate <patterns...>] --input-sig <hex> --session-id <sid> --out <path> [--json]` | full `MutReportJson` with empty assertions               | `1` if `thresholds.passed === false`                                                       |
| `asserts`  | `--project <path> --test-files <files...> --input-sig <hex> --session-id <sid> --out <path> [--json]`                          | full `MutReportJson` with empty mutation                 | `1` if `thresholds.passed === false`                                                       |
| `report`   | `--in <path> --session-id <sid> [--json]`                                                                                      | nothing on disk — re-emits a one-line summary            | `1` if input report's `thresholds.passed === false`; `2` on invalid JSON or schema failure |

In the **Flags** column a bare flag is **required** and a flag in `[...]` is **optional**. `peaks mut asserts` has no `--mutate`: it never runs Stryker.

MEASURED: `peaks mut asserts` writes an **empty** mutation block, so its `mutation.killRate` is `0` — below `mutationKillRateMin` — and `thresholds.passed` is therefore always `false`, i.e. the exit code is `1` even when the assertion scan finds nothing weak. Read `assertions.weakRate` for the assertion verdict, not the exit code.

`--json` emits `{ ok, sha256, passed, path }` (run/mutants/asserts) or a structured summary object (report). Without `--json`, plain text is written to stdout. Failures from JSON parse / Zod validation go to stderr with `INVALID_JSON` / `INVALID` prefix.

### Mutation scope and the Stryker configuration

`--mutate <patterns...>` is the **mutation scope**: source patterns, relative to `--project`. It is optional on the parser but required in practice — without it the runner falls back to a project-root `stryker.conf.js`, and with neither the run is refused with the named code `MUT_MUTATE_PATTERN_REQUIRED`.

The Stryker configuration is **built programmatically** by the CLI (`peaks-loop-mut` → `buildStrykerOptions`): the test runner, the timing, the coverage mode and the mutation scope all come from the flags. A project-root `stryker.conf.js` is **optional** — a backwards-compatible fallback for projects that already ship one. When one exists, the CLI's own options win over it (Stryker deep-merges the CLI options over the config file).

Named error codes the mut family can emit:

| Code                          | Meaning                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `MUT_MUTATE_PATTERN_REQUIRED` | no `--mutate` scope and no project-root `stryker.conf.js` to fall back to     |
| `MUT_NO_MUTANTS`              | the run produced 0 mutants — a configuration error, not a passing measurement |
| `MUT_TOOLCHAIN_UNAVAILABLE`   | the `@stryker-mutator/vitest-runner` plugin could not be resolved             |
| `MUT_FAILED`                  | the fallback for a failure that carries no named code of its own              |

A failure envelope is written to stderr and the exit code is non-zero (`1`).

### The two root scripts

The repository ships two ready-to-run scripts:

| Script          | Command                                                        | Placeholders                                            |
| --------------- | -------------------------------------------------------------- | ------------------------------------------------------- |
| `pnpm mut:run`  | `peaks mut run` over the four `stryker.conf.js` mutate targets | `--input-sig` and `--session-id` are PLACEHOLDER values |
| `pnpm mut:scan` | `peaks mut asserts` — the assertion scan only, no Stryker      | same                                                    |

The `--input-sig` PLACEHOLDER is 64 zeros — it is **not** a real TACT.sig. Take the real one from `peaks tact read --artifact .peaks/_runtime/<sessionId>/rd/impl.json --project <repo> --json | jq -r '.sha256'` and replace it, and replace the `--session-id` PLACEHOLDER with the session id you are working in. The reports land under `.peaks/_runtime/<sessionId>/mut/`, which is gitignored: a `mut-report.json` is session-scoped ephemeral state and must never be committed.

## Report shape (link to types)

`MutReportJson` is the canonical artifact, validated by `MutReportSchema` (Zod). Source of truth: `packages/peaks-loop-mut/src/services/mut/types.ts`. Top-level fields:

```ts
interface MutReportJson {
  readonly version: '1.0';
  readonly sha256: string; // MUT.sig — sha256 of canonicalised content
  readonly generatedAt: string; // ISO 8601 — excluded from the sha256 digest
  readonly inputSig: string; // TACT.sig (64-hex) — chain anchor
  readonly mutation: MutationReport;
  readonly assertions: AssertionsReport;
  readonly thresholds: ThresholdsConfig; // includes `passed: boolean`
  readonly followups: ReadonlyArray<Followup>;
}
```

`MutationReport` carries `tool`, `mutantsTotal`, `mutantsKilled`, `mutantsSurvived`, `mutantsTimeout`, `killRate` (0..1), and `byFile[]` with per-file kill rate + `survived[]` of `{ line, mutation, survivedBecause }`. `AssertionsReport` carries `totalAssertions`, `weakAssertions`, `weakRate` (0..1), and `weakPatterns[]` of `{ pattern, count, examples[] }` (examples are capped at file+line+code per WeakPatternSchema). `Followup` has `{ file, issue, severity, suggestion }` where `issue ∈ {low_kill_rate, high_weak_assertions}` and `severity ∈ {soft, hard}`.

The MUT.sig digest is **deterministic**: object keys are sorted recursively, `generatedAt` and `sha256` are excluded before hashing, so re-running peaks-mut on unchanged inputs always produces the same sig (good for `peaks-qa` regression detection).

## One-axis envelope invariant

peaks-mut writes the report to the path given by `--out` (the CLI creates the parent directory; it does **not** enforce a `.peaks/_runtime/<sessionId>/` prefix — put the report there yourself). It never reads from `.peaks/_sub_agents/...`, and it never accepts `--change-id`. This invariant matches peaks-qa / peaks-context and keeps the chain MUT.sig → TACT.sig → PRD sig auditable in one place.

## Independent context (防合谋)

peaks-mut's inputs are the test files and the sources under test — the CLI takes them as `--test-files` and `--mutate` and reads nothing else (PRD §4.2 防合谋). The strategy / implementation artifacts (`strategy.md`, `impl.json`) are not part of any mut input, so peaks-mut cannot be biased by peaks-rd's design intent when judging test quality. peaks-qa applies the same isolation when it consumes MUT.sig.

## Karpathy guidelines

All 4 guidelines injected (same as peaks-rd). The two relevant ones here:

- **Truthfulness about completion** — peaks-mut MUST NOT report `thresholds.passed = true` if the assertion scan was skipped (e.g. `peaks mut mutants` was run instead of `peaks mut run`). The CLI sets the value from real measurements; the LLM only reads it.
- **No silent swallowing** — peaks-mut MUST NOT silently swallow assertion violations. Every `WeakExample` is preserved in the report (capped per pattern), every `Followup.suggestion` is concrete, and the CLI exit code reflects `thresholds.passed`.

## Default runbook

```bash
# 0. Confirm mut's own runbook integrity
peaks skill runbook peaks-mut --json
peaks skill presence:set peaks-mut --project <repo>  # show persistent skill presence every turn

# 1. Produce the upstream chain (STRAT.sig → TACT.sig) if it does not exist yet.
#    Both write commands are one-axis: --session-id is required and every
#    --out must live under .peaks/_runtime/<sid>/.
peaks strat write \
  --project <repo> \
  --session-id <sid> \
  --out .peaks/_runtime/<sid>/rd/strategy.md \
  --goal <text> \
  --root-cause <text> \
  --impact <paths...> \
  --design <text> \
  --json
#    Writes strategy.md (ending with `STRAT.sig: <64-hex>`) plus its JSON
#    sibling .peaks/_runtime/<sid>/rd/strategy.md.json.

peaks tact write \
  --project <repo> \
  --session-id <sid> \
  --strategy .peaks/_runtime/<sid>/rd/strategy.md.json \
  --out .peaks/_runtime/<sid>/rd/impl.json \
  --changed-files <paths...> \
  --json
#    Verifies the strategy JSON's recomputed sha256, runs the AST gate, then
#    writes impl.json with inputSig = STRAT.sig. An AST violation refuses and
#    writes nothing. `--ast-context '<json>'` supplies { deps, docSummaries };
#    omitted means the documented empty context (no API-name violations).

# 2. Get the upstream TACT.sig (the chain anchor for MUT.sig)
peaks tact read --artifact .peaks/_runtime/<sid>/rd/impl.json --project <repo> --json | jq -r '.sha256'

# 3. Inventory the test files. There is NO CLI command that lists them
#    (`peaks context` has only layer / status / check, and no --audience
#    option), and `--test-files` takes explicit paths relative to --project.
#    List the test files that import the sources under test.

# 4. Run the full audit
peaks mut run \
  --project <repo> \
  --test-files <files...> \
  --mutate <patterns...> \
  --input-sig <tact.sig> \
  --session-id <sid> \
  --out .peaks/_runtime/<sid>/mut/mut-report.json \
  --json

# 5. Inspect the report (optional, for human readers)
peaks mut report \
  --in .peaks/_runtime/<sid>/mut/mut-report.json \
  --session-id <sid>

# 6. Sub-runs when the slice is small or partial (e.g. CI)
peaks mut mutants --project <repo> --test-files <files...> --mutate <patterns...> --input-sig <tact.sig> --session-id <sid> --out <path> --json
peaks mut asserts --project <repo> --test-files <files...> --input-sig <tact.sig> --session-id <sid> --out <path> --json

# 7. Clean up
peaks skill presence:clear --project <repo>
```

### Transition verification gates (MANDATORY — run the command, see the output)

You cannot declare peaks-mut complete from memory. Each gate below is a command you **MUST run** and whose output you **MUST see** before proceeding.

**Peaks-Loop Gate A — After `peaks mut run`:**

```bash
ls .peaks/_runtime/<session-id>/mut/mut-report.json
# Expected: a single mut-report.json file. Missing → STOP, the CLI failed.
```

**Peaks-Loop Gate B — Before handing off to peaks-qa (MUT.sig chain is valid):**

```bash
# The report's inputSig MUST equal the upstream TACT.sig.
jq -r '.inputSig' .peaks/_runtime/<session-id>/mut/mut-report.json
# Expected: a 64-char lowercase hex string matching peaks tact read's sha256.
# Mismatch → STOP, the chain is broken — re-run peaks mut run with the right --input-sig.

# The report's own sha256 MUST be a 64-char lowercase hex.
jq -r '.sha256' .peaks/_runtime/<session-id>/mut/mut-report.json
# Expected: 64-char hex. Mismatch → STOP, the CLI wrote garbage.
```

**Peaks-Loop Gate C — Threshold verdict (when a human or CI checks `passed`):**

```bash
jq -r '.thresholds.passed' .peaks/_runtime/<session-id>/mut/mut-report.json
# Expected: `true` (pass) or `false` (fail). When false, the CLI exited with code 1.
```

## Boundaries

- Do not write tests, do not modify source under test, do not pick mutation strategies. peaks-mut only **measures** the test suite and **reports** the verdict.
- Do not commit mut-report.json to source control; it is session-scoped ephemeral state.
- Do not bypass thresholds via the LLM: if `peaks mut run` exits `1`, surface the failure to peaks-qa and the user — do not retry with a relaxed config unless they explicitly ask.
- Do not run Stryker outside `peaks mut run | mutants`; the runner requires the injected `invokeStryker`, and the Stryker configuration is built programmatically from the flags. A project-root `stryker.conf.js` is an optional backwards-compatible fallback, not a requirement.
- Do not call `peaks mut report` against a report whose `inputSig` does not match the current TACT.sig — that is a stale report, not authoritative.

Reference: `packages/peaks-loop-mut/src/services/mut/` for the service-layer code (`types.ts`, `assert-scanner.ts`, `mut-runner.ts`, `thresholds.ts`, `report-builder.ts`, `stryker-options.ts`, `production-stryker.ts`).
