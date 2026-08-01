# Statusline Auto-Compact Progress Implementation Plan

> **For agentic workers:** Execute through the Peaks-Loop `peaks-code → RD → QA → verdict` workflow. RD owns all application-code edits. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a first real Claude Code statusline version with the approved C1 visual hierarchy and an honest stage-based auto-compact progress bar.

**Architecture:** Evolve the existing compact-statusline helper into the single lifecycle reader/renderer, persist lifecycle transitions atomically from the auto-compact orchestrator, and compose compact state into the existing primary skill statusline. The statusline path stays read-only; execution policy and thresholds remain unchanged.

**Tech Stack:** TypeScript, Node.js ESM, Commander, Vitest 4.1.10, Claude Code `statusLine` command integration.

## Global Constraints

- No provisional mountain or logo glyph.
- Normal output follows `Peaks ● <skill> › <project>`.
- Normal mode and routine gate values stay hidden; only attention/blocking gates are promoted.
- Color is supplemental; Unicode no-color and complete ASCII output preserve meaning.
- Auto-compact progress uses only observable stages: `queued`, `preparing`, `compacting`, `verifying`, `completed`, `failed`.
- Progress fill is fixed at 0/2/4/6/8 cells; never synthesize continuous internal percentages.
- Missing post-compact ratio is omitted; never render `?` or `0.0?`.
- Statusline reads are side-effect free.
- Auto-compact thresholds, deferral rules, and zero-intervention behavior are unchanged.
- Vitest remains locked to 4.1.10.
- No AI attribution trailer in commits; SquabbyZ is sole author.
- User interaction remains natural language or multi-choice only.

---

## File map

- Create `src/services/compact-statusline/compact-lifecycle-store.ts` — lifecycle schema, validation, atomic writes, lifecycle reads, and stale-state classification.
- Modify `src/services/compact-statusline/compact-statusline-service.ts` — map lifecycle records and legacy artifacts to semantic compact display models; remove guessed values.
- Modify `src/services/skills/skill-statusline-service.ts` — include canonical session id, compact display state, and output capability in the read-only primary model.
- Modify `src/services/skills/skill-statusline-renderer.ts` — C1 normal rendering, compact precedence, progress bars, ANSI/no-color/ASCII rendering.
- Modify `src/services/code/auto-compact-orchestrator.ts` — atomically record observable lifecycle transitions around checkpoint creation, dispatch, and result recording.
- Modify `src/cli/commands/statusline-commands.ts` — compose the unified statusline model and expose deterministic preview flags for QA/visual checks if needed.
- Modify `src/services/skills/statusline-settings-service.ts` only if the installed command needs a stable capability flag; otherwise leave it unchanged.
- Modify `tests/unit/services/compact-visibility/compact-visibility.test.ts` — lifecycle/store compatibility and status semantics.
- Create `tests/unit/services/skills/skill-statusline-renderer.test.ts` — exact normal/compact/color/ASCII rendering contracts.
- Modify `tests/unit/code/auto-compact-orchestrator.test.ts` — transition-order and failure-stage evidence.
- Create or modify an integration test under `tests/integration/` — real filesystem lifecycle → `peaks statusline` output.
- Update statusline documentation or help snapshots only where current output examples become false.

---

### Task 1: Define and persist the compact lifecycle

**Files:**
- Create: `src/services/compact-statusline/compact-lifecycle-store.ts`
- Test: `tests/unit/services/compact-visibility/compact-visibility.test.ts`

**Interfaces:**
- Produces:

```ts
export type CompactLifecycleStage =
  | 'queued'
  | 'preparing'
  | 'compacting'
  | 'verifying'
  | 'completed'
  | 'failed';

export interface CompactLifecycleRecord {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly stage: CompactLifecycleStage;
  readonly updatedAt: string;
  readonly triggerRatio: number;
  readonly afterRatio?: number;
  readonly redLine: boolean;
  readonly failedAt?: Exclude<CompactLifecycleStage, 'failed' | 'completed'>;
  readonly errorSummary?: string;
}

export type CompactLifecycleRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'valid'; readonly record: CompactLifecycleRecord }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'stalled'; readonly record: CompactLifecycleRecord };

export function writeCompactLifecycle(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly record: CompactLifecycleRecord;
}): void;

export function readCompactLifecycle(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly nowMs: number;
  readonly staleAfterMs: number;
}): CompactLifecycleRead;
```

- [ ] **Step 1: Write failing lifecycle-store tests**

Add tests that use the real temporary workspace and assert:

```ts
const record: CompactLifecycleRecord = {
  schemaVersion: 1,
  runId: 'run-1',
  stage: 'compacting',
  updatedAt: '2026-08-01T12:00:00.000Z',
  triggerRatio: 0.87,
  redLine: false,
};
writeCompactLifecycle({ projectRoot: process.cwd(), sessionId: SID, record });
expect(readCompactLifecycle({
  projectRoot: process.cwd(),
  sessionId: SID,
  nowMs: Date.parse('2026-08-01T12:00:01.000Z'),
  staleAfterMs: 60_000,
})).toEqual({ kind: 'valid', record });
```

Also cover missing, malformed JSON, wrong schema, invalid ratios, failed-without-`failedAt`, atomic replacement, and an active stage older than `staleAfterMs` returning `stalled`. Completed and failed records must not become stalled merely because they are old.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm vitest run tests/unit/services/compact-visibility/compact-visibility.test.ts
```

Expected: FAIL because `compact-lifecycle-store.ts` and its exports do not exist.

- [ ] **Step 3: Implement validation and atomic storage**

Write records to:

```text
.peaks/_runtime/<sessionId>/compact-lifecycle.json
```

Use same-directory temporary files plus `renameSync`; clean the temp file on rename failure. Validate parsed values explicitly. Bound `errorSummary` to 160 characters before writing. Do not silently convert malformed content to missing.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
pnpm vitest run tests/unit/services/compact-visibility/compact-visibility.test.ts
pnpm typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/services/compact-statusline/compact-lifecycle-store.ts tests/unit/services/compact-visibility/compact-visibility.test.ts
git commit -m "feat(statusline): add compact lifecycle store"
```

---

### Task 2: Render C1 normal states and capability fallbacks

**Files:**
- Modify: `src/services/skills/skill-statusline-renderer.ts`
- Create: `tests/unit/services/skills/skill-statusline-renderer.test.ts`

**Interfaces:**
- Produces:

```ts
export type StatusLineCapability = 'ansi-unicode' | 'unicode' | 'ascii';

export interface StatusLineRenderOptions {
  readonly capability: StatusLineCapability;
}

export function renderStatusLine(
  model: StatusLineModel,
  options?: StatusLineRenderOptions,
): string;
```

Default capability must be chosen deliberately by the caller; if backward compatibility requires a renderer default, use `unicode`, never unconditional ANSI.

- [ ] **Step 1: Write exact-output tests**

Cover at minimum:

```ts
expect(renderStatusLine(activeModel, { capability: 'unicode' }))
  .toBe('Peaks ● peaks-code › peaks-loop');
expect(renderStatusLine(idleModel, { capability: 'unicode' }))
  .toBe('Peaks ○ idle › peaks-loop');
expect(renderStatusLine(activeModel, { capability: 'ascii' }))
  .toBe('Peaks * peaks-code > peaks-loop');
```

Add stale and invalid-presence cases. Add a model with `mode: 'assisted'` and routine `gate: 'startup'` and prove neither appears. Add a model with an explicit attention-gate classification and prove the human-readable gate appears as:

```text
Peaks ⚠ peaks-code · QA › peaks-loop
```

ANSI tests must assert escape codes and also assert that stripping ANSI yields the exact Unicode text. Assert that no output contains `⛰` or `🏔`.

- [ ] **Step 2: Run the focused renderer test and confirm RED**

```bash
pnpm vitest run tests/unit/services/skills/skill-statusline-renderer.test.ts
```

Expected: FAIL on missing capability API and old `⛰ Peaks` output.

- [ ] **Step 3: Implement C1 token rendering**

Use a small token/palette layer rather than embedding escape codes through switch branches. Full ASCII mapping must include status glyphs, separators, arrows, and progress characters. Preserve technical diagnostics for stale/invalid states.

Define attention-gate classification as a pure function with an explicit allowlist/shape. Do not infer that every non-empty gate is blocking. If current gate values do not encode severity, introduce a conservative list for known blocking values and leave routine gates hidden.

- [ ] **Step 4: Run renderer test, existing statusline tests, and typecheck**

```bash
pnpm vitest run tests/unit/services/skills/skill-statusline-renderer.test.ts
pnpm vitest run tests/unit --project unit --testNamePattern statusline
pnpm typecheck
```

Expected: PASS. If the repository's Vitest CLI does not support the name-filter form, select the exact statusline test files rather than inventing a flag.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/services/skills/skill-statusline-renderer.ts tests/unit/services/skills/skill-statusline-renderer.test.ts
git commit -m "feat(statusline): refine primary status hierarchy"
```

---

### Task 3: Map lifecycle stages to honest progress displays

**Files:**
- Modify: `src/services/compact-statusline/compact-statusline-service.ts`
- Modify: `tests/unit/services/compact-visibility/compact-visibility.test.ts`

**Interfaces:**
- Consumes: `readCompactLifecycle(...)` and `CompactLifecycleRecord` from Task 1.
- Produces:

```ts
export type CompactDisplayKind =
  | 'none'
  | 'queued'
  | 'preparing'
  | 'compacting'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'stalled'
  | 'invalid';

export interface CompactStatuslineState {
  readonly kind: CompactDisplayKind;
  readonly filledCells: 0 | 2 | 4 | 6 | 8;
  readonly triggerRatio?: number;
  readonly afterRatio?: number;
  readonly redLine?: boolean;
  readonly failedAt?: string;
  readonly detail?: string;
}
```

`decideCompactStatusline` should return semantic state, not a preformatted guessed label. `renderCompactStatusline` may remain for the legacy `peaks statusline compact` command but must share the primary rendering logic and never output guessed ratios.

- [ ] **Step 1: Replace legacy expectations with lifecycle expectations**

Add table-driven assertions:

```ts
const expected = {
  queued: 0,
  preparing: 2,
  compacting: 4,
  verifying: 6,
  completed: 8,
} as const;
```

For each stage, write a lifecycle fixture and assert `filledCells`. Cover failed-at-compacting retaining 4 cells, stalled active state, invalid data, red line, a completed record with `afterRatio`, and a completed record without it. Assert no rendered result includes `?`.

Preserve a compatibility test for legacy `auto-compact-pending.json` and `compact-history.jsonl`, but define the migration behavior explicitly: lifecycle wins; legacy pending maps to queued; a recent successful history event maps to completed without an invented after-ratio.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm vitest run tests/unit/services/compact-visibility/compact-visibility.test.ts
```

Expected: FAIL because the old five-kind state and guessed completion labels remain.

- [ ] **Step 3: Implement lifecycle-first decision logic**

Read `compact-lifecycle.json` first. Use legacy files only when lifecycle is missing. Invalid lifecycle must return `invalid`, not fall through to a reassuring legacy success. Set a concrete first-version stale timeout constant of 120 seconds, documented as adjustable after real timing evidence.

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm vitest run tests/unit/services/compact-visibility/compact-visibility.test.ts
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/services/compact-statusline/compact-statusline-service.ts tests/unit/services/compact-visibility/compact-visibility.test.ts
git commit -m "feat(statusline): render compact stage progress"
```

---

### Task 4: Integrate compact precedence into the primary statusline

**Files:**
- Modify: `src/services/skills/skill-statusline-service.ts`
- Modify: `src/services/skills/skill-statusline-renderer.ts`
- Modify: `src/cli/commands/statusline-commands.ts`
- Modify: `tests/unit/services/skills/skill-statusline-renderer.test.ts`
- Test: existing CLI/statusline command tests located by symbol search before editing

**Interfaces:**
- Consumes: `CompactStatuslineState` from Task 3.
- `StatusLineModel` gains:

```ts
readonly compact: CompactStatuslineState;
```

- Capability resolution is pure and deterministic:

```ts
export function resolveStatusLineCapability(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly isTTY: boolean;
  readonly forced?: StatusLineCapability;
}): StatusLineCapability;
```

- [ ] **Step 1: Write compact-precedence render tests**

For each compact state, assert exact Unicode output:

```text
Peaks ◐ [░░░░░░░░] queued · 87% › peaks-loop
Peaks ◑ [██░░░░░░] preparing · 87% › peaks-loop
Peaks ◒ [████░░░░] compacting · 87% › peaks-loop
Peaks ◓ [██████░░] verifying › peaks-loop
Peaks ✓ [████████] compacted · 87% → 42% › peaks-loop
Peaks ✕ [████░░░░] compact failed · compacting › peaks-loop
```

Assert compact state replaces the skill content while active. Assert `none` returns the normal C1 line. Add exact ASCII output and ANSI-stripped equivalence tests. Add stalled and invalid lifecycle diagnostics.

- [ ] **Step 2: Write CLI capability tests**

Prove:

- `NO_COLOR` selects Unicode without ANSI;
- forced ASCII selects full ASCII;
- ANSI is selected only under an explicit supported condition;
- JSON output contains the rendered string without corrupting the result envelope.

Use existing CLI test harnesses; do not mutate global `process.env` without restoring it.

- [ ] **Step 3: Run focused tests and confirm RED**

Run the new renderer test and exact existing CLI statusline test files discovered by `rg "runDefaultStatuslineRender|statusline.render" tests`.

Expected: FAIL because compact state is not in the primary model and capability resolution does not exist.

- [ ] **Step 4: Implement read-only composition**

`buildStatusLineModel` resolves the canonical session id for the detected project root and calls `decideCompactStatusline`. It performs reads only. `runDefaultStatuslineRender` resolves capability and passes it to `renderStatusLine`.

If a deterministic manual preview is needed, add hidden/test-oriented options such as `--plain-ascii` only if they do not widen the normal user-facing CLI surface. Prefer environment-driven fixtures for the first version.

- [ ] **Step 5: Run focused tests, typecheck, and build**

```bash
pnpm vitest run tests/unit/services/skills/skill-statusline-renderer.test.ts <exact-cli-statusline-test-files>
pnpm typecheck
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/services/skills/skill-statusline-service.ts src/services/skills/skill-statusline-renderer.ts src/cli/commands/statusline-commands.ts tests/unit/services/skills/skill-statusline-renderer.test.ts <exact-cli-statusline-test-files>
git commit -m "feat(statusline): merge compact progress into primary line"
```

---

### Task 5: Emit observable lifecycle transitions from auto-compact

**Files:**
- Modify: `src/services/code/auto-compact-orchestrator.ts`
- Modify: `tests/unit/code/auto-compact-orchestrator.test.ts`
- Modify: `tests/unit/services/compact-visibility/compact-visibility.test.ts` only for end-to-end store evidence if needed

**Interfaces:**
- Consumes: `writeCompactLifecycle(...)` from Task 1.
- Introduce a local helper that writes the next record while preserving `runId`, trigger ratio, red-line flag, and prior stage.

- [ ] **Step 1: Write transition-order tests**

Mock or spy on lifecycle writes through an injectable seam or a dedicated exported transition builder. Assert the successful observable order for a path that truly reaches all stages:

```text
queued → preparing → compacting → verifying → completed
```

If main-session in-band dispatch cannot truthfully observe completion in the same process, assert only the stages it can observe and drive `verifying/completed` from the existing post-compact detection path in a separate test. Do not emit fake stages merely to satisfy the ideal sequence.

Add failure tests for:

- checkpoint/preparation failure → `failedAt: 'preparing'`;
- dispatch failure → `failedAt: 'compacting'`;
- post-compact verification failure → `failedAt: 'verifying'` where that path exists.

- [ ] **Step 2: Run orchestrator tests and confirm RED**

```bash
pnpm vitest run tests/unit/code/auto-compact-orchestrator.test.ts
```

Expected: FAIL because no lifecycle transitions are written.

- [ ] **Step 3: Implement only truthful transitions**

Generate one `runId` per attempt. Write `queued` once the decision commits to compact, `preparing` before checkpoint/recovery writes, and `compacting` before IDE dispatch. On synchronous dispatch success, write only the next stage that the process can prove. Integrate `verifying/completed` with post-compact detection rather than claiming completion when dispatch merely returned successfully.

On exceptions, write `failed` with the last active stage and a bounded summary, then preserve the original result/error contract. Lifecycle telemetry must not alter threshold or dispatch decisions.

- [ ] **Step 4: Measure a real post-compact ratio**

At the existing post-compact probe, persist `afterRatio` only from `readContextPercent`. If no reliable probe exists, complete without `afterRatio`; the renderer omits the arrow suffix.

- [ ] **Step 5: Run focused tests, production ESM repro, and typecheck**

```bash
pnpm vitest run tests/unit/code/auto-compact-orchestrator.test.ts tests/unit/context/auto-compact-reader.test.ts
pnpm typecheck
pnpm build
```

Then import the built ESM modules with Node and execute the transition builder/store against a temporary runtime directory. Expected: no `require is not defined`, no swallowed syntax error, and valid lifecycle JSON.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/services/code/auto-compact-orchestrator.ts tests/unit/code/auto-compact-orchestrator.test.ts tests/unit/services/compact-visibility/compact-visibility.test.ts
git commit -m "feat(auto-compact): publish statusline lifecycle"
```

---

### Task 6: End-to-end first-version preview in real Claude Code statusline

**Files:**
- Create or modify: exact integration test selected after searching existing statusline E2E patterns
- Modify: documentation/help snapshots only when current facts change
- Runtime fixture: `.peaks/_runtime/<currentSessionId>/compact-lifecycle.json` (gitignored; generated by commands/tests, never committed)

**Interfaces:**
- Consumes the installed `peaks statusline` command and lifecycle schema from Tasks 1–5.
- Produces a QA evidence artifact under `.peaks/_runtime/<sessionId>/qa/test-reports/` through peaks-qa, not in the project root.

- [ ] **Step 1: Add a real-filesystem CLI integration test**

Create a temporary project with session binding, active skill presence, and lifecycle fixtures. Invoke the built CLI exactly as Claude Code does with a stdin payload. Assert normal, compacting, completed, failed, no-color, and ASCII output.

- [ ] **Step 2: Run integration test and full focused suite**

```bash
pnpm vitest run <exact-integration-test-file>
pnpm vitest run tests/unit/services/skills/skill-statusline-renderer.test.ts tests/unit/services/compact-visibility/compact-visibility.test.ts tests/unit/code/auto-compact-orchestrator.test.ts
pnpm typecheck
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Install the local built statusline for this project**

Use the existing Peaks statusline install primitive on the user's behalf. Verify the installed command still points at `peaks statusline`. Do not overwrite a non-Peaks statusline without confirmation.

- [ ] **Step 4: Generate controlled preview states**

Using the lifecycle writer or a test-only fixture helper, show these states in the actual Claude Code statusline one at a time:

1. normal C1;
2. queued;
3. compacting;
4. completed with a real fixture ratio;
5. failed;
6. back to normal.

Do not trigger a real destructive or unnecessary compaction solely for visuals. Use controlled lifecycle fixtures for layout review, then perform one genuine auto-compact observation only when the context threshold naturally permits or through a safe test seam.

- [ ] **Step 5: Capture visual evidence**

Capture terminal screenshots or direct terminal output proving ANSI color differs from no-color and that ASCII fully degrades. Ask the user for visual feedback after the first live version; keep polish adjustments out of this implementation plan until feedback identifies them.

- [ ] **Step 6: Run Peaks QA and pipeline verification**

QA must verify:

- exact stage bars;
- no provisional logo;
- no `?` ratio;
- statusline read-only behavior;
- truthful stage emission;
- persistent failure;
- 10-second completed expiry;
- stale active-state diagnostic;
- Windows Terminal and Claude Code live rendering.

Then run:

```bash
peaks workflow verify-pipeline --rid <rid> --project . --json
```

Expected: pipeline verification PASS before handoff.

- [ ] **Step 7: Commit Task 6 if tests/docs changed**

```bash
git add <exact-integration-test-file> <changed-docs-or-snapshots>
git commit -m "test(statusline): verify compact progress end to end"
```

---

## RD/QA execution envelope

1. Bind one request RID to this plan and approved design.
2. Transition request to `spec-locked` before application-code edits.
3. RD executes Tasks 1–6 with TDD and commits at the task boundaries above.
4. After each RD slice, auto-route to QA without waiting for user confirmation.
5. QA returns a verdict and concrete visual evidence; failed findings route back to RD, maximum three repair cycles.
6. Before final delivery, transition through `implemented → qa-handoff → handed-off` using the repository's current request-state vocabulary.
7. Run `peaks workflow verify-pipeline` for the RID.
8. Produce a compact TXT handoff and extract at least one durable project sediment unless the user explicitly approves no sediment.

## Plan self-review

- Spec coverage: all eleven design sections map to Tasks 1–6.
- Scope: one cohesive statusline/lifecycle feature; no unrelated refactor or logo work.
- Truthfulness: Task 5 explicitly forbids emitting stages the runtime cannot observe.
- Type consistency: lifecycle types originate in Task 1; display types in Task 3; primary composition in Task 4.
- Placeholder check: commands that require repository discovery are explicitly marked as exact files to select before execution rather than invented paths or flags; implementers must replace angle-bracket execution variables with discovered concrete values before running commands.
- First-version goal: Task 6 ends with live Claude Code visual review before further polish.
