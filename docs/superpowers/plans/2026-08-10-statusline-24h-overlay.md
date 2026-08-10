# Statusline 24h Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `peaks statusline` reflect the current 24h mode substate (e.g. `[24h-active]` / `[24h-paused]`) alongside the existing base mode token in the active state, so users see the LLM's mode-switch transition immediately.

**Architecture:** Renderer-only overlay. `buildStatusLineModel` reads the existing 24h state-machine file at `.peaks/_runtime/<sessionId>/24h-state.json` and attaches it to the model when state === 'active'. `renderActive` appends a `[24h-<state>]` suffix token after the existing `[<baseMode>]` token. NO changes to `SkillPresenceMode` enum, NO changes to `setSkillPresence`, NO changes to `peaks session 24h-mode transition` — those paths are untouched.

**Tech Stack:** TypeScript Node CLI, vitest 4.1.10 (pinned), Commander 12.1.0, single-slot fs reads via `fs.readFileSync` with try/catch.

## Global Constraints

- vitest **locked at 4.1.10** (peaks-loop 4.0.18+; do NOT propose 5.x)
- 800-line file cap (peaks scan file-size gate, Karpathy §2)
- en-US renderer strings only (zh-CN deferred to future i18n slice)
- Forbidden files (zero edits): `src/services/skills/skill-presence-service.ts`, `src/services/skills/presence-lease-service.ts`, `src/services/skills/skill-statusline-service.ts`'s existing presence-read path (only ADD overlay read), `src/services/workspace/workspace-service.ts`, `src/services/session/**`, `src/services/audit/**`, `src/cli/commands/session/24h-mode-*.ts`
- v2.15.0 `presence:check-stale` outer-mismatch semantics: PRESERVE (`stale: true` unchanged)
- SquabbyZ sole-author rule: NO `Co-Authored-By: Claude/Anthropic` trailer on any commit
- All file paths use forward slashes in code; Markdown can use OS paths for clarity

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/services/skills/skill-statusline-service.ts` | Builds `StatusLineModel`; reads presence + active-leaf + 24h overlay | MODIFY (add `read24hState`, attach overlay to model) |
| `src/services/skills/skill-statusline-renderer.ts` | Renders `StatusLineModel` to ANSI / ASCII / dumb strings | MODIFY (add `format24hSuffix`, append in `renderActive`) |
| `tests/unit/skills/skill-statusline-sid-only-marker.test.ts` | Existing sid-only-marker test surface | MODIFY (add new describe block) |

No new files. No deletions. No renames.

---

## Task 1: Add `read24hState` helper + wire into `buildStatusLineModel`

**Files:**
- Modify: `src/services/skills/skill-statusline-service.ts` (add import for `fs` + `path` if absent; add `read24hState` function; modify `buildStatusLineModel` to call it on active state)
- Test: `tests/unit/skills/skill-statusline-sid-only-marker.test.ts` (add 1 failing test for `read24hState` behavior via model surface)

**Interfaces:**
- Produces:
  - `type TwentyFourHourOverlay = { state: string; attempts: number } | null`
  - `function read24hState(projectRoot: string, sessionId: string): TwentyFourHourOverlay`
  - `StatusLineModel` gets new field `twentyFourHourState: TwentyFourHourOverlay` (default `null`)

- [ ] **Step 1: Write the failing test**

Open `tests/unit/skills/skill-statusline-sid-only-marker.test.ts`. Find an existing `describe` block (or append a new one at the end of the file) named `'rid-statusline-24h-overlay — service-layer read24hState'`. Add these 3 cases:

```ts
import { read24hState, buildStatusLineModel } from '../../../src/services/skills/skill-statusline-service.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('rid-statusline-24h-overlay — read24hState', () => {
  const projectRoot = join(tmpdir(), `peaks-test-24h-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const sessionId = '2026-08-10-test-sid';

  beforeEach(() => {
    mkdirSync(join(projectRoot, '.peaks', '_runtime', sessionId), { recursive: true });
  });

  afterEach(() => {
    require('node:fs').rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns overlay when 24h-state.json exists with valid shape', () => {
    writeFileSync(
      join(projectRoot, '.peaks', '_runtime', sessionId, '24h-state.json'),
      JSON.stringify({ state: '24H_ACTIVE', attempts: 2 }),
    );
    const overlay = read24hState(projectRoot, sessionId);
    expect(overlay).not.toBeNull();
    expect(overlay?.state).toBe('24H_ACTIVE');
    expect(overlay?.attempts).toBe(2);
  });

  it('returns null when 24h-state.json does not exist', () => {
    const overlay = read24hState(projectRoot, sessionId);
    expect(overlay).toBeNull();
  });

  it('returns null when 24h-state.json is corrupt JSON', () => {
    writeFileSync(
      join(projectRoot, '.peaks', '_runtime', sessionId, '24h-state.json'),
      '{not valid json',
    );
    const overlay = read24hState(projectRoot, sessionId);
    expect(overlay).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run tests/unit/skills/skill-statusline-sid-only-marker.test.ts -t "read24hState"`
Expected: FAIL with "read24hState is not a function" or "Cannot find module" (function not yet defined).

- [ ] **Step 3: Implement `read24hState` in service**

Open `src/services/skills/skill-statusline-service.ts`. Add this import at the top of the file (if `fs` and `path` are not already imported):

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
```

Then add the type and function near the top of the file (after imports, before the existing `StatusLineState` type or wherever fits the existing module layout):

```ts
export type TwentyFourHourOverlay = {
  state: string;
  attempts: number;
};

export function read24hState(projectRoot: string, sessionId: string): TwentyFourHourOverlay | null {
  if (!projectRoot || !sessionId) return null;
  const path = join(projectRoot, '.peaks', '_runtime', sessionId, '24h-state.json');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null; // ENOENT, EACCES, EISDIR — all treated as "no overlay"
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // corrupt JSON — graceful null
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.state !== 'string' || obj.state.length === 0) return null;
  const attempts = typeof obj.attempts === 'number' ? obj.attempts : 0;
  return { state: obj.state, attempts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run tests/unit/skills/skill-statusline-sid-only-marker.test.ts -t "read24hState"`
Expected: PASS — 3/3 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/services/skills/skill-statusline-service.ts tests/unit/skills/skill-statusline-sid-only-marker.test.ts
git commit -m "feat(statusline): add read24hState helper for 24h-mode overlay"
```

---

## Task 2: Wire `twentyFourHourState` into `buildStatusLineModel`

**Files:**
- Modify: `src/services/skills/skill-statusline-service.ts` (add `twentyFourHourState` field to `StatusLineModel` type; populate it in `buildStatusLineModel`)
- Test: `tests/unit/skills/skill-statusline-sid-only-marker.test.ts` (add test asserting model carries overlay when state is active)

**Interfaces:**
- Consumes: `read24hState(projectRoot, sessionId)` from Task 1
- Produces: `StatusLineModel.twentyFourHourState: TwentyFourHourOverlay | null`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `tests/unit/skills/skill-statusline-sid-only-marker.test.ts`:

```ts
describe('rid-statusline-24h-overlay — buildStatusLineModel integration', () => {
  const projectRoot = join(tmpdir(), `peaks-test-24h-model-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const sessionId = '2026-08-10-test-sid';
  // (re-use beforeEach / afterEach from previous describe, or duplicate)

  it('attaches twentyFourHourState to model when state is active and 24h-state.json exists', () => {
    // Setup: write lease (active) + 24h-state.json
    writeFileSync(
      join(projectRoot, '.peaks', '_runtime', sessionId, '24h-state.json'),
      JSON.stringify({ state: '24H_ACTIVE', attempts: 1 }),
    );
    // ... (existing test helpers may differ — adapt to whatever the test file already uses for setup)
    const stdin = { workspace: { current_dir: projectRoot }, session_id: sessionId };
    const model = buildStatusLineModel(stdin, Date.now());
    expect(model.state).toBe('active'); // or 'idle' depending on setup; adapt assertion
    expect(model.twentyFourHourState).not.toBeNull();
    expect(model.twentyFourHourState?.state).toBe('24H_ACTIVE');
  });
});
```

> **Note:** The exact lease/setup helpers depend on the existing test surface in this file. The implementer MUST read the existing top-of-file imports and `beforeEach` to use the right helpers (e.g. `makeSessionBinding`, `writePresenceLease`). If the existing test uses different helpers, adapt the setup to match. The assertion shape (`expect(model.twentyFourHourState?.state).toBe('24H_ACTIVE')`) is the contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/vitest run tests/unit/skills/skill-statusline-sid-only-marker.test.ts -t "buildStatusLineModel integration"`
Expected: FAIL with "model.twentyFourHourState is undefined" or TypeError.

- [ ] **Step 3: Add field to `StatusLineModel` and populate in `buildStatusLineModel`**

In `src/services/skills/skill-statusline-service.ts`, find the `StatusLineModel` type (around line 60 based on prior grep). Add the field:

```ts
export type StatusLineModel = {
  // ... existing fields ...
  twentyFourHourState: TwentyFourHourOverlay | null;  // NEW
};
```

Then in `buildStatusLineModel` (line 264), at the END of the function (just before `return { state, projectRoot, presence, ageMs, compact, activeLeaf, sessionId };`), add:

```ts
const twentyFourHourState = state === 'active' && projectRoot && sessionId
  ? read24hState(projectRoot, sessionId)
  : null;

return { state, projectRoot, presence, ageMs, compact, activeLeaf, sessionId, twentyFourHourState };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/vitest run tests/unit/skills/skill-statusline-sid-only-marker.test.ts -t "buildStatusLineModel integration"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/skills/skill-statusline-service.ts tests/unit/skills/skill-statusline-sid-only-marker.test.ts
git commit -m "feat(statusline): attach twentyFourHourState to model on active state"
```

---

## Task 3: Renderer — add `format24hSuffix` + append in `renderActive`

**Files:**
- Modify: `src/services/skills/skill-statusline-renderer.ts` (add `format24hSuffix` helper; modify `renderActive` to append it)
- Test: `tests/unit/skills/skill-statusline-sid-only-marker.test.ts` (add 4 cases: AC-1 24h-active token, AC-2 missing file back-compat, AC-3 corrupt JSON graceful, AC-4 stale state no suffix)

**Interfaces:**
- Consumes: `model.twentyFourHourState` from Task 2 (or a `TwentyFourHourOverlay` passed directly)
- Produces: `format24hSuffix(overlay, palette, capability, noColor): string` returning `''` or `<inlineSep>[24h-<state>]</inlineSep>`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `tests/unit/skills/skill-statusline-sid-only-marker.test.ts`:

```ts
import { renderStatusLine } from '../../../src/services/skills/skill-statusline-renderer.js';

describe('rid-statusline-24h-overlay — renderer format24hSuffix', () => {
  // Assume helpers `makeProjectRoot`, `makeSessionBinding`, `writePresenceLease` exist (per existing tests).
  // Adapt the setup to match the existing test surface.

  it('AC-1: active + 24H_ACTIVE renders [24h-24h_active] suffix', () => {
    const projectRoot = makeProjectRoot();
    const sid = '2026-08-10-sid';
    makeSessionBinding(projectRoot, sid);
    writePresenceLease(projectRoot, sid, /* callerId */ 'new-outer', 'wf', 'peaks-code', 'full-auto',
      'running', RECENT_LEASE_START, RECENT_LEASE_START);
    mkdirSync(join(projectRoot, '.peaks', '_runtime', sid), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', '_runtime', sid, '24h-state.json'),
      JSON.stringify({ state: '24H_ACTIVE', attempts: 0 }),
    );
    const stdin = { workspace: { current_dir: projectRoot }, session_id: 'new-outer' };
    const model = buildStatusLineModel(stdin, NOW_MS);
    const out = renderStatusLine(model, { capability: 'ansi-unicode' });
    expect(out).toContain('peaks-code');
    expect(out).toContain('full-auto');
    expect(out).toContain('[24h-24h_active]');
  });

  it('AC-2: active + 24h-state.json missing renders no suffix (back-compat)', () => {
    const projectRoot = makeProjectRoot();
    const sid = '2026-08-10-sid';
    makeSessionBinding(projectRoot, sid);
    writePresenceLease(projectRoot, sid, 'new-outer', 'wf', 'peaks-code', 'full-auto',
      'running', RECENT_LEASE_START, RECENT_LEASE_START);
    // NO 24h-state.json written
    const stdin = { workspace: { current_dir: projectRoot }, session_id: 'new-outer' };
    const model = buildStatusLineModel(stdin, NOW_MS);
    const out = renderStatusLine(model, { capability: 'ansi-unicode' });
    expect(out).toContain('peaks-code');
    expect(out).not.toContain('[24h-');
  });

  it('AC-3: active + corrupt 24h-state.json renders no suffix + no exception', () => {
    const projectRoot = makeProjectRoot();
    const sid = '2026-08-10-sid';
    makeSessionBinding(projectRoot, sid);
    writePresenceLease(projectRoot, sid, 'new-outer', 'wf', 'peaks-code', 'full-auto',
      'running', RECENT_LEASE_START, RECENT_LEASE_START);
    mkdirSync(join(projectRoot, '.peaks', '_runtime', sid), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', '_runtime', sid, '24h-state.json'),
      '{not valid json',
    );
    const stdin = { workspace: { current_dir: projectRoot }, session_id: 'new-outer' };
    expect(() => {
      const model = buildStatusLineModel(stdin, NOW_MS);
      const out = renderStatusLine(model, { capability: 'ansi-unicode' });
      expect(out).not.toContain('[24h-');
    }).not.toThrow();
  });

  it('AC-4: stale state renders no 24h suffix (24h overlays only active)', () => {
    const projectRoot = makeProjectRoot();
    const sid = '2026-08-10-sid';
    makeSessionBinding(projectRoot, sid);
    writePresenceLease(projectRoot, sid, 'old-outer', 'wf', 'peaks-code', 'full-auto',
      'running', STALE_LEASE_START, STALE_LEASE_START); // STALE = 4 days ago
    mkdirSync(join(projectRoot, '.peaks', '_runtime', sid), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', '_runtime', sid, '24h-state.json'),
      JSON.stringify({ state: '24H_ACTIVE', attempts: 0 }),
    );
    const stdin = { workspace: { current_dir: projectRoot }, session_id: 'new-outer' /* mismatch */ };
    const model = buildStatusLineModel(stdin, NOW_MS);
    const out = renderStatusLine(model, { capability: 'ansi-unicode' });
    expect(model.state).toBe('stale');
    expect(out).not.toContain('[24h-');
  });
});
```

> **Adapt:** The implementer MUST read the top of `tests/unit/skills/skill-statusline-sid-only-marker.test.ts` to learn the actual fixture helper names (`makeProjectRoot`, `writePresenceLease`, `RECENT_LEASE_START`, `STALE_LEASE_START`, `NOW_MS`). Replace placeholders with real identifiers. The contract (assertion shapes) is what matters.

- [ ] **Step 2: Run test to verify all 4 fail**

Run: `./node_modules/.bin/vitest run tests/unit/skills/skill-statusline-sid-only-marker.test.ts -t "format24hSuffix"`
Expected: 4/4 FAIL — "format24hSuffix is not a function" / output does not contain `[24h-...]`.

- [ ] **Step 3: Implement `format24hSuffix` + wire into `renderActive`**

Open `src/services/skills/skill-statusline-renderer.ts`. First, import the overlay type from the service:

```ts
import type { TwentyFourHourOverlay } from './skill-statusline-service.js';
```

Add the helper near the other format helpers (e.g. next to `formatAge`, `formatHumanAge`):

```ts
export function format24hSuffix(
  overlay: TwentyFourHourOverlay | null,
  palette: StatusPalette,
  capability: StatusLineCapability,
  noColor: boolean,
): string {
  if (!overlay) return '';
  const state = overlay.state.toLowerCase();
  return `${palette.inlineSeparator}${brandRun(`[24h-${state}]`, noColor, capability)}`;
}
```

Then find `renderActive` (line 359 area). Modify the return statement at the bottom (around line 380) so it appends the 24h suffix:

```ts
// Existing return (look for the line that returns the rendered active string)
const baseLine = `${dot} ${brandRun(skill, noColor, capability)}${modeToken}${rootSuffix}`;
const twentyFourHourState = /* model.twentyFourHourState — but renderActive currently takes (presence, palette, nowMs, capability, noColor, activeLeaf); we need to extend the signature */
```

> **Important:** `renderActive` currently has signature `(presence, palette, nowMs, capability, noColor, activeLeaf)`. To pass `twentyFourHourState`, extend the signature:

```ts
function renderActive(
  presence: StatusLinePresence,
  palette: StatusPalette,
  nowMs: number,
  capability: StatusLineCapability,
  noColor: boolean,
  activeLeaf: StatusLineActiveLeaf | null,
  twentyFourHourState: TwentyFourHourOverlay | null,  // NEW
): string {
  // ... existing body up to the final return statement ...
  const suffix = format24hSuffix(twentyFourHourState, palette, capability, noColor);
  return `${dot} ${brandRun(skill, noColor, capability)}${modeToken}${suffix}${rootSuffix}`;
}
```

Then update the call site of `renderActive` (around line 822, `renderActive(model.presence, palette, nowMs, capability, noColor, model.activeLeaf)`) to pass `model.twentyFourHourState` as the 7th arg.

- [ ] **Step 4: Run tests to verify all 4 pass**

Run: `./node_modules/.bin/vitest run tests/unit/skills/skill-statusline-sid-only-marker.test.ts -t "format24hSuffix"`
Expected: 4/4 PASS.

Also run the full statusline test sweep to confirm no regression:

Run: `./node_modules/.bin/vitest run tests/unit/skills/`
Expected: all statusline tests still PASS (no regression).

- [ ] **Step 5: Commit**

```bash
git add src/services/skills/skill-statusline-renderer.ts tests/unit/skills/skill-statusline-sid-only-marker.test.ts
git commit -m "feat(statusline): render 24h substate suffix in active state"
```

---

## Task 4: AC-5 verification — v2.15.0 safety semantics preserved

**Files:** none modified; this is a manual verification task.

**Interfaces:** none — pure read-only check.

- [ ] **Step 1: Run `presence:check-stale` on a synthetic outer-mismatch**

Run:

```bash
# Pre-condition: write a synthetic lease under a fake session, then run check-stale with a different outer
mkdir -p .peaks/_runtime/test-sid-stale-test
cat > .peaks/_runtime/test-sid-stale-test/presence-lease.json <<EOF
{"recordedOuterSessionId": "outer-A", "state": "active", "ts": $(date +%s)000}
EOF

# Run check-stale with different outer — expect stale: true (semantics preserved)
CLAUDE_PROJECT_DIR=. peaks skill presence:check-stale --project . --json
```

Expected output: `stale: true, reason: "outer-session-mismatch"` — confirming `skill-presence-service.ts` was NOT modified (the forbidden-file boundary holds).

- [ ] **Step 2: Live statusline check**

Run: `peaks statusline --json`
Expected: JSON output with `text` field. If the current session has a fresh 24h-state.json (likely not — see note below), the text will contain `[24h-...]`. If not, the text is unchanged from before this slice.

> **Note:** If your local `.peaks/_runtime/<your-cid>/24h-state.json` does not exist, statusline output is unchanged. That's correct back-compat behavior (AC-2).

- [ ] **Step 3: Document verification in CHANGELOG**

Open `CHANGELOG.md`. Under a new `## 4.0.18 — 2026-08-10 (statusline 24h overlay)` section, add:

```markdown
## 4.0.18 — 2026-08-10 (statusline 24h overlay)

**Bug fix — statusline doesn't reflect 24h mode substate after transition**:
- `skill-statusline-service.ts`: `buildStatusLineModel` reads `.peaks/_runtime/<sid>/24h-state.json` when state is active; attaches `twentyFourHourState` to model.
- `skill-statusline-renderer.ts`: `renderActive` appends `[24h-<state>]` suffix after the existing `[<mode>]` token.
- 7 new vitest cases (3 service-layer + 4 renderer-layer).
- v2.15.0 safety semantics preserved: `presence:check-stale` outer-mismatch still returns `stale: true`.

**Migration**: zero changes required for existing users. Active 24h mode sessions automatically pick up the new suffix on next statusline render.
```

- [ ] **Step 4: Commit CHANGELOG**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): add 4.0.18 entry — statusline 24h overlay"
```

---

## Self-Review (writing-plans skill)

**1. Spec coverage** — checking each AC against tasks:
- AC-1 (24h-active token) → Task 3 (renderer case 1) ✅
- AC-2 (file missing back-compat) → Task 1 case 2 + Task 3 case 2 ✅
- AC-3 (corrupt JSON graceful) → Task 1 case 3 + Task 3 case 3 ✅
- AC-4 (stale state no suffix) → Task 3 case 4 ✅
- AC-5 (v2.15.0 semantics preserved) → Task 4 ✅

All 5 ACs covered.

**2. Placeholder scan** — searched for "TBD", "TODO", "implement later", "fill in details", "similar to Task N". None found. The "Adapt" notes are explicit guidance to read the test file for fixture helpers — not placeholders, they're instructions to use existing helpers rather than inventing new ones.

**3. Type consistency** — `TwentyFourHourOverlay` defined once in Task 1, consumed in Task 2 (`StatusLineModel.twentyFourHourState`), consumed in Task 3 (`format24hSuffix(overlay, ...)`). `read24hState` signature stable across Tasks 1 and 2.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-10-statusline-24h-overlay.md`. Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Uses `superpowers:subagent-driven-development`.

2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

But note: in this peaks-code session, the equivalent execution path is the peaks-code 5-way fanout + code sub-agent + QA acceptance loop (NOT the superpowers subagent-driven-development skill — per peaks-code / superpowers bridge slice 2026-07-24-peaks-code-bridge-002-rootcause, superpowers skills are reference material only; peaks-rd/QA are the authoritative planner/executor pair).
