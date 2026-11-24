# peaks design — S4 Implementation Plan (exemplar fidelity)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add G3 to `peaks design check`: a hard same-route visual regression (`designlang fidelity --min 90`) against a recorded baseline, and an advisory archetype rubric scored against `design/exemplars/<archetype>/` — skipping cleanly (never silently) when no baseline or exemplar exists.

**Architecture:** A spike settles the two open seams first: the machine shape of `designlang fidelity` and how a before/after baseline is produced (a served snapshot of the base revision, or recorded screenshots — the spike decides and records why). A new `exemplars.ts` reads the file-convention registry; a new `design-check-g3.ts` runs G3a (fidelity) and G3b (rubric envelope) without growing `design-check.ts`; the CLI gains `--skip-exemplar` and the result gains `checks.g3_exemplar`.

**Tech Stack:** TypeScript ESM, designlang 13.4.1 (`fidelity`), Vitest, the existing `runDesignlang`-style spawning discipline.

**Spec:** `docs/superpowers/specs/2026-11-23-peaks-design-governance-design.md` (§6.4 exemplars, §7.4 G3, §11 U18, §13 AC14)

## Global Constraints

- **Never pass without evidence.** No baseline, no exemplar, no engine, no reachable trusted URLs → `skipped(...)` with a reason or `blocked`; never a silent pass.
- G3a is a **hard** gate at `--min 90`; G3b is **advisory** in S4 (`warn`, never fail). The calibration to 32/40 and no-dimension-<3 is recorded, not enabled, until a calibration run exists.
- Baselines and runtime screenshots live under `.peaks/_runtime/<sessionId>/design/baseline/` and are never committed. Only redacted or synthetic screenshots may live in `design/exemplars/`.
- `--skip-exemplar` follows the source-only pattern: interactive session required, a note recording the user's own words, and the evidence records it — never a default.
- URL trust is unchanged: fidelity runs only against trusted URLs; no cookie/header passthrough.
- The rubric is produced by the LLM (`peaks-ui`) as a JSON envelope the CLI validates; the CLI never scores aesthetics itself.
- File sizes: `design-check.ts` is near the cap — G3 lands in new modules; every touched file ≤300 raw lines (tests ≤500).
- BDD triple as the first three consecutive comments; `.js` specifiers; prettier; eslint 0; stage only in RD tasks; the orchestrator commits after QA.

## Review Focus

- **Jitter:** fidelity compares two renders; animations, fonts and flaky regions must be neutralised (motion disabled, fixed viewport/scale, masked regions), or the gate flakes and gets disabled by its users. Task 1 fixes the recipe and Task 3 pins it.
- **Baseline drift:** a baseline must be established only on a green run and never silently updated; a changed baseline is a reviewed act. Task 3 pins "no baseline → skipped, not pass".
- **Exemplar mismatch:** a changed route whose archetype has no exemplar must be `skipped(no-exemplar-for-archetype)`, not a rubric failure. Task 2 pins the mapping.
- **Rubric laundering:** a rubric with a missing dimension or out-of-range score must be refused, and an advisory failure must not turn a G1/G2 fail into a pass. Task 4 pins both.
- **Skip honesty:** `--skip-exemplar` without a session or note exits 3 and writes nothing; with both it records the acceptance. Task 5 pins it.

---

### Task 1: Spike — fidelity output and the baseline mechanism

**Files:**
- Create: `.peaks/_runtime/<sessionId>/rd/s4-spike.md` (findings)
- No source changes.

- [ ] **Step 1: Probe `designlang fidelity`** — serve two tiny static pages on loopback (a plain HTML fixture at two revisions), run `node node_modules/designlang/bin/design-extract.js fidelity <a> --clone <b> --min 90 -o <dir>`, and record: `fidelity.json` field names (overall score, visual/motion split), exit codes above/below the threshold, `--system-chrome` behaviour, and whether `-o` is required.
- [ ] **Step 2: Settle the baseline mechanism** — compare (a) a served snapshot of the base revision, (b) recorded screenshots plus a non-fidelity diff, (c) the previous deployment URL. Record which the gate can obtain reproducibly from a repo, what it costs, and why the others were rejected.
- [ ] **Step 3: Probe the jitter controls** — confirm which fidelity flags exist for motion/scale, and record the masking plan if none exists (fixed viewport, CSS animation kill, stable fonts).
- [ ] **Step 4: Write the findings** into `s4-spike.md`; every claim names the command and its output.

---

### Task 2: The exemplar registry reader

**Files:**
- Create: `src/services/design/exemplars.ts`
- Test: `tests/unit/design/exemplars.test.ts`

**Interfaces:**
- `type ExemplarEntry = { archetype: string; route: string; sourceFile: string; screenshotPath: string | null; metaPath: string }`
- `readExemplars(contractRoot: string): ExemplarEntry[]` — reads `design/exemplars/*/meta.json`, ignores malformed entries with a recorded reason, verifies the sibling source exists.
- `archetypeForRoute(entries: readonly ExemplarEntry[], route: string): ExemplarEntry | null` — exact route match only (no prefix matching).

- [ ] **Step 1: Failing tests** — valid entry read; malformed `meta.json` skipped with a reason; route matching exact; no entry → null.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** — the file green, `tsc` 0; stage only.

---

### Task 3: G3a — same-route fidelity against a baseline

**Files:**
- Create: `src/services/design/fidelity.ts` (spawn + parse, modelled on `designlang.ts`)
- Create: `src/services/design/design-check-g3.ts` (G3 orchestration)
- Test: `tests/unit/design/design-check-g3.test.ts`

**Interfaces:**
- `runFidelity(input: { baselineUrl; candidateUrl; min?: number; timeoutMs? }): Promise<{ ok: true; score: number; report: unknown } | { ok: false; code; message }>` — parses `fidelity.json`, never trusts exit 0 alone.
- `evaluateG3a(input): Promise<G3AResult>` — `status: 'pass' | 'fail' | 'skipped' | 'blocked'`; `skipped('no-baseline')` when the route has no baseline; `fail` below 90; `blocked` when the engine/browser/URL is unavailable.
- Result slot: `checks.g3_exemplar`.

- [ ] **Step 1: Failing tests** — score 92 → pass, 89 → fail, missing report with exit 0 → blocked, no baseline → skipped, untrusted candidate URL → blocked before spawning.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement** the wrapper with the spike's recipe (timeout, tree kill via the existing helper, no cookie/header).
- [ ] **Step 4: Verify** — tests green, `tsc` 0; stage only.

---

### Task 4: G3b — the advisory archetype rubric

**Files:**
- Modify: `src/services/design/design-check-g3.ts`
- Create: `src/services/design/rubric.ts` (envelope validation)
- Test: `tests/unit/design/rubric.test.ts`, extend the G3 test

**Interfaces:**
- Rubric file: `.peaks/_runtime/<sessionId>/design/rubric-<rid>.json` written by the LLM (`peaks-ui`), shape `{ schemaVersion: 1, rid, archetype, dimensions: { layout, type, color, states, responsive, a11y } }`, each 1–5.
- `readRubric(path): { ok: true; total: number; dimensions } | { ok: false; code; message }` — refuses missing dimensions, out-of-range scores, rid mismatch.
- G3b result: `status: 'pass' | 'warn' | 'skipped' | 'blocked'`; advisory threshold `total >= 32 && min(dimensions) >= 3` produces `warn` below it; never `fail`.

- [ ] **Step 1: Failing tests** — valid rubric; missing dimension refused; score 6 refused; below-threshold → warn not fail; no rubric and no exemplar → skipped with the reason.
- [ ] **Step 2–4:** implement, verify, stage.

---

### Task 5: CLI and result wiring

**Files:**
- Modify: `src/cli/commands/design-commands.ts`, `design-gate-evidence.ts`
- Modify: `src/services/design/design-check.ts` (result slot only)
- Test: `tests/unit/cli/design-commands.test.ts` (or a sibling under 500 lines)

**Interfaces:**
- Flags: `--skip-exemplar` (interactive-only, needs `--accept-note`, records acceptance), `--baseline-url <url>` (optional explicit baseline; otherwise from the baseline store).
- `checks.g3_exemplar` appears in the JSON envelope and the evidence markdown's `## Checks` section; the verdict line is unchanged (G3a fail sets the top-level verdict to `fail`; G3b warnings do not).

- [ ] **Step 1: Failing tests** — `--skip-exemplar` without a session/note → exit 3, nothing written; with both → marker recorded; a G3a fail flips the verdict and the evidence marker to `fail`; a G3b warn leaves `pass`.
- [ ] **Step 2–4:** implement, verify (including a real run in a temp fixture), stage.

---

### Task 6: Role prose and calibration record

**Files:**
- Modify: `skills/bee/peaks-ui/SKILL.md`, `skills/bee/peaks-qa/SKILL.md`, `skills/peaks-design/SKILL.md`
- Create: `.peaks/_runtime/<sessionId>/design/calibration.md`

- [ ] **Step 1: Prose** — peaks-ui captures exemplars (redacted/synthetic only) and writes the rubric envelope; peaks-qa seeds the fidelity baseline on a green run; peaks-design records that G3a is hard at 90 and G3b advisory until calibration.
- [ ] **Step 2: Calibration record** — the rubric threshold, the dimensions, and the condition that flips advisory→fail (a calibration run with no item <3 and total ≥32).
- [ ] **Step 3: Verify** — `tests/unit/skills` green; loop-hygiene block untouched; stage only.

---

### Task 7: ModelMatrix pilot (carries S3's deferred pilot)

**Files:** none in this repo; report under `.peaks/_runtime/<sessionId>/design/pilot-report.md`.

- [ ] **Step 1: Worktree** `D:\projects\ModelMatrix-pilot` on `pilot/peaks-design` from `origin/develop`; contract root `web/design/`.
- [ ] **Step 2: Baseline + exemplars** per the S3 plan and Task 1's recipe; two archetypes (list `features/channels`, form `features/subscriptions`).
- [ ] **Step 3: Run** `peaks design check --gate` before/after one change per archetype; record fidelity scores, rubric scores, round count to green, and false-positive samples.
- [ ] **Step 4: Report** every number traced to a command output; if the worktree or a browser is unavailable, record the deferral — never a green claim.

## Execution order and release note

Tasks 1 → 2 → 3 → 4 → 5 → 6, then the pilot. S4 is an optional capability: it ships as a **minor** unless the maintainer picks otherwise, and the CHANGELOG states that G3a is hard only for routes with a recorded baseline and G3b is advisory until calibrated.
