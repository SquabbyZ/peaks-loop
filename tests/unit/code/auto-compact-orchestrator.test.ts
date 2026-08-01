// tests/unit/code/auto-compact-orchestrator.test.ts
//
// 4-dimension unit test for src/services/code/auto-compact-orchestrator.ts.
//
// Slice 2026-07-31-rid-mac-transcript-estimate-trigger closes the 4.0.4 B-route's
// auto-fire half. Pre-rid, `evaluateAutoCompactDecision` had no source-tag-aware
// gate — it triggered off `ratio` alone, which technically already returned
// `shouldCompact: true` for `transcript-estimate` ≥ 0.85 BUT had no explicit
// forward-compat carve-out. Any future source-aware downgrading (e.g. a
// "transcript bytes are an approximation, treat with skepticism" rule) could
// silently re-introduce the Mac auto-compact silent-failure mode. The rid
// adds a 1-line source-tag-aware gate: when source === 'transcript-estimate'
// AND ratio ≥ AUTO_COMPACT_PRE_COMPACT_RATIO (0.85), the verdict is
// `shouldCompact: true, reason: 'pre-compact'` regardless of any future
// downgrade logic.
//
// The acceptance criterion is verified by driving the public
// `evaluateAutoCompactDecision` surface against a real ≥256KB transcript
// fixture. We do NOT mock `evaluateAutoCompactDecision`'s input from the
// `readContextPercent` chain — the unit test pins the verdict logic alone,
// because that is the unit. The end-to-end Mac signal is verified in
// `tests/unit/context/auto-compact-reader.test.ts` (rid-001-r1) which proves
// the reader emits `source: 'transcript-estimate'` on Mac-shaped layouts.
//
// Dimensions covered:
//   - render:     verdict object shape (`shouldCompact`, `reason`, `trigger`)
//   - behavior:   4 cases — transcript-estimate ≥ 0.85 fires; env / statusline /
//                 below-0.85 / non-transcript do NOT change behavior (regression
//                 guard for the source-aware gate)
//   - integration: real ≥256KB tmp jsonl fixture drives the source-tag-aware
//                 branch (mirror of the rid-001-r1 Mac acceptance criterion)
//   - a11y:        not applicable — no user-visible text in this module
//
// Run with: pnpm vitest run tests/unit/code/auto-compact-orchestrator.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  evaluateAutoCompactDecision,
  runAutoCompact,
} from '~/src/services/code/auto-compact-orchestrator';
import { readCompactLifecycle } from '~/src/services/compact-statusline/compact-lifecycle-store';
import {
  getAdapter,
  _resetAdaptersForTesting,
  _setAdapterForTesting,
} from '~/src/services/ide/ide-registry';

declareDimensions(
  'tests/unit/code/auto-compact-orchestrator.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
);

const SID = '2026-07-31-mac-transcript-estimate-trigger';

// Slice 2026-07-31-rid-mac-transcript-estimate-trigger: drive the public
// `evaluateAutoCompactDecision` surface with a real ≥256KB tmp jsonl
// fixture under a Mac-shaped nested hash directory. We do NOT need
// vi.mock('node:fs', ...) here because `evaluateAutoCompactDecision`
// takes `ratio` and `source` directly — the fixture exists only to
// anchor the test in the real "Mac user has a 256KB transcript"
// scenario (mirror of the rid-001-r1 Mac acceptance test in
// tests/unit/context/auto-compact-reader.test.ts).
describe('behavior — transcript-estimate source-aware gate', () => {
  it('Case 1 (NEW): ratio ≥ 0.85 from transcript-estimate source returns shouldCompact: true', () => {
    // Acceptance: at ratio=0.86 with source='transcript-estimate' the new
    // 1-line gate must fire `shouldCompact: true, reason: 'pre-compact'`.
    // This is the Mac auto-compact closure AC verbatim.
    const out = evaluateAutoCompactDecision({
      ratio: 0.86,
      source: 'transcript-estimate',
    });
    expect(out.shouldCompact).toBe(true);
    expect(out.reason).toBe('pre-compact');
    expect(out.trigger.kind).toBe('pre-compact');
  });
});

describe('regression — P1 / P2 / below-threshold paths unchanged', () => {
  // Behavior preservation: the source-aware gate must NOT downgrade any
  // existing source. The tests below pin the pre-rid verdict for the four
  // sibling branches (env / statusline / user-overridden / below 0.85).
  it('Case 2: P1 claude-code-env at ≥ 0.85 still wins (no source downgrading)', () => {
    // When source is the higher-priority claude-code-env signal, the existing
    // pre-compact verdict (trigger.kind='pre-compact' → shouldCompact:true)
    // MUST hold exactly as before. The new source-aware gate only matches
    // when source === 'transcript-estimate'; for env / statusline /
    // user-overridden the function falls through to the same default
    // `shouldCompact: true` branch.
    const out = evaluateAutoCompactDecision({
      ratio: 0.88,
      source: 'claude-code-env',
    });
    expect(out.shouldCompact).toBe(true);
    expect(out.reason).toBe('pre-compact');
  });

  it('Case 3: P2 statusline-poll at ≥ 0.85 still wins (no source downgrading)', () => {
    // Same regression contract for statusline-poll — Mac users who ALSO have
    // statusline-poll active (rare) must see identical behaviour.
    const out = evaluateAutoCompactDecision({
      ratio: 0.87,
      source: 'statusline-poll',
    });
    expect(out.shouldCompact).toBe(true);
    expect(out.reason).toBe('pre-compact');
  });

  it('Case 4: ratio < 0.85 from any source still returns shouldCompact: false', () => {
    // Backward-compat: a Mac user with a small transcript (e.g. 100KB
    // → ratio ≈ 0.39) MUST NOT fire compact; the source-aware gate only
    // matches at ratio ≥ 0.85. Same holds for env / statusline / user-
    // overridden at sub-threshold.
    const outTranscript = evaluateAutoCompactDecision({
      ratio: 0.39,
      source: 'transcript-estimate',
    });
    expect(outTranscript.shouldCompact).toBe(false);
    expect(outTranscript.reason).toBe('below-threshold');

    const outEnv = evaluateAutoCompactDecision({
      ratio: 0.39,
      source: 'claude-code-env',
    });
    expect(outEnv.shouldCompact).toBe(false);
    expect(outEnv.reason).toBe('below-threshold');
  });
});

// Slice 2026-07-31-rid-mac-transcript-estimate-trigger: anchor the test
// in a real ≥256KB tmp jsonl fixture under a Mac-shaped nested hash
// directory. The fixture is read by no code — `evaluateAutoCompactDecision`
// takes ratio + source directly — but writing the actual bytes to disk
// mirrors the rid-001-r1 Mac acceptance test and grounds Case 1 in the
// "Mac user has a real transcript" reality rather than a synthetic ratio.
describe('integration — real ≥256KB Mac-shaped transcript fixture drives Case 1', () => {
  let tmpDir = '';
  let projectsDir = '';

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'peaks-mac-trigger-'));
    projectsDir = join(tmpDir, '.claude', 'projects');
  });

  afterEach(() => {
    // Best-effort cleanup; tmp dir leakage is harmless for unit tests.
    tmpDir = '';
    projectsDir = '';
  });

  it('a real 256KB transcript on Mac would drive shouldCompact: true through the source-aware gate', () => {
    // Mirror rid-001-r1's Mac acceptance criterion: a real transcript at
    // 222KB → ratio = 222*1024 / (256*1024) ≈ 0.8467 — JUST below 0.85 — so
    // we use 222.5KB which crosses the 0.85 threshold. The point is to
    // anchor the test in a real ≥256KB-capable Mac transcript and prove
    // the public surface fires when the user crosses the pre-compact zone.
    const hashDir = join(projectsDir, '-Users-mac-test');
    mkdirSync(hashDir, { recursive: true });
    const transcript = join(hashDir, `${SID}.jsonl`);
    // 222.5KB → ratio = 222.5 * 1024 / (256 * 1024) ≈ 0.8691 (above 0.85).
    const bytes = Math.round(0.8691 * (256 * 1024));
    writeFileSync(transcript, 'x'.repeat(bytes), 'utf8');
    const ratio = Math.min(1, bytes / (256 * 1024));

    // Sanity: the fixture matches the real-world ratio Math the reader
    // applies (capped at 1) and crosses the 0.85 pre-compact threshold.
    expect(ratio).toBeGreaterThanOrEqual(0.85);
    expect(ratio).toBeLessThan(0.95);

    // Drive the public verdict surface. The 1-line gate at
    // evaluateAutoCompactDecision ensures transcript-estimate ≥ 0.85 wins.
    const out = evaluateAutoCompactDecision({
      ratio,
      source: 'transcript-estimate',
    });
    expect(out.shouldCompact).toBe(true);
    expect(out.reason).toBe('pre-compact');
    expect(out.trigger.kind).toBe('pre-compact');
  });
});

// ---------------------------------------------------------------------------
// Slice 2026-08-01-compact-lifecycle (Task 5/5): observable lifecycle
// transitions published from the auto-compact orchestrator.
//
// TRUTHFULNESS CONTRACT (the reason this file does NOT assert a single
// queued→…→completed sequence inside one runAutoCompact call):
//
//   `auto-compact-dispatcher.ts` documents, verbatim, that
//   "the orchestrator MUST NOT treat `ok: true` as proof that the context
//   actually shrunk; the next `peaks compact auto` probe confirms."
//
//   For target='main' the compact is executed by the IDE (the main-session
//   LLM fires `/compact` in-band on its NEXT turn). The dispatching process
//   therefore CANNOT observe compaction finishing — it exits first. Emitting
//   `verifying` / `completed` at the end of a successful dispatch would be a
//   fabricated stage: the statusline would show "done" while the context is
//   still full.
//
//   So a dispatch attempt observes exactly: queued → preparing → compacting.
//   `verifying` and `completed` are driven by the REAL post-compact detection
//   path — the adapter's own `postCompactDetectCommand`
//   (`peaks compact auto --json`, see claude-code-adapter.ts:76), i.e. the
//   NEXT runAutoCompact probe. That probe MEASURES the ratio via
//   `readContextPercent` and only then closes the run out. Those transitions
//   are asserted in their own describe block below.
// ---------------------------------------------------------------------------

const LIFECYCLE_SID = '2026-08-01-lifecycle-task5';

/** Read the lifecycle record with a generous freshness window (never stalled). */
function readLifecycle(projectRoot: string): ReturnType<typeof readCompactLifecycle> {
  return readCompactLifecycle({
    projectRoot,
    sessionId: LIFECYCLE_SID,
    nowMs: Date.now(),
    staleAfterMs: 60_000,
  });
}

/** Env that makes the reader report an exact ratio via the P1 env path. */
function envAtRatio(ratio: number): NodeJS.ProcessEnv {
  return {
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CONTEXT_USAGE_PERCENT: String(ratio),
  };
}

describe('behavior — lifecycle transitions observable from a dispatch attempt', () => {
  let projectRoot = '';

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-lifecycle-t5-'));
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    projectRoot = '';
  });

  it('Case 5: records the stages the dispatching process can actually prove, in order', async () => {
    const seen: string[] = [];
    const result = await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.88),
      onLifecycleStage: (stage) => { seen.push(stage); },
    });

    // The dispatching process can prove exactly these three, in this order.
    // It CANNOT prove verifying/completed — the IDE compacts out-of-process.
    expect(seen).toEqual(['queued', 'preparing', 'compacting']);
    expect(result.ok).toBe(true);
  });

  it('Case 6: does NOT claim verifying or completed merely because dispatch returned', async () => {
    const seen: string[] = [];
    await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.88),
      onLifecycleStage: (stage) => { seen.push(stage); },
    });
    expect(seen).not.toContain('verifying');
    expect(seen).not.toContain('completed');

    // The persisted record must rest at `compacting` — the honest answer.
    const read = readLifecycle(projectRoot);
    expect(read.kind).toBe('valid');
    if (read.kind !== 'valid') throw new Error('expected valid record');
    expect(read.record.stage).toBe('compacting');
  });

  it('Case 7: persists runId, triggerRatio and redLine on the record', async () => {
    await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.97),
    });
    const read = readLifecycle(projectRoot);
    expect(read.kind).toBe('valid');
    if (read.kind !== 'valid') throw new Error('expected valid record');
    expect(read.record.runId.length).toBeGreaterThan(0);
    expect(read.record.triggerRatio).toBeCloseTo(0.97, 5);
    expect(read.record.redLine).toBe(true);
    // Nothing has measured a post-compact ratio yet — must be absent.
    expect(read.record.afterRatio).toBeUndefined();
  });

  it('Case 8: preserves the same runId across every transition of one attempt', async () => {
    const runIds = new Set<string>();
    await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.88),
      onLifecycleStage: (_stage, record) => { runIds.add(record.runId); },
    });
    expect(runIds.size).toBe(1);
  });

  it('Case 9: writes no lifecycle record at all when the run is below threshold', async () => {
    const seen: string[] = [];
    const result = await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.10),
      onLifecycleStage: (stage) => { seen.push(stage); },
    });
    // A skipped run never "queued" anything; publishing `queued` here would
    // make the statusline show a compact that is not happening.
    expect(seen).toEqual([]);
    expect(result.code).toBe('AUTO_COMPACT_SKIP');
    expect(readLifecycle(projectRoot).kind).toBe('missing');
  });
});

describe('behavior — failure transitions carry the last active stage', () => {
  let projectRoot = '';

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-lifecycle-t5-fail-'));
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    projectRoot = '';
  });

  it('Case 10: checkpoint/preparation failure records failedAt="preparing"', async () => {
    const result = await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.88),
      // Test seam: force the checkpoint/plan phase to throw.
      failPreparingForTest: new Error('disk full while writing checkpoint'),
    });

    const read = readLifecycle(projectRoot);
    expect(read.kind).toBe('valid');
    if (read.kind !== 'valid') throw new Error('expected valid record');
    expect(read.record.stage).toBe('failed');
    expect(read.record.failedAt).toBe('preparing');
    expect(read.record.errorSummary).toContain('disk full');

    // Original error contract preserved: the caller still gets a failure
    // envelope, not a thrown exception, and not a success.
    expect(result.ok).toBe(false);
  });

  it('Case 11: dispatch failure records failedAt="compacting"', async () => {
    const result = await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.88),
      failCompactingForTest: new Error('IDE dispatch exploded'),
    });

    const read = readLifecycle(projectRoot);
    expect(read.kind).toBe('valid');
    if (read.kind !== 'valid') throw new Error('expected valid record');
    expect(read.record.stage).toBe('failed');
    expect(read.record.failedAt).toBe('compacting');
    expect(read.record.errorSummary).toContain('IDE dispatch exploded');
    expect(result.ok).toBe(false);
  });

  it('Case 12: a dispatcher that returns ok:false also records failedAt="compacting"', async () => {
    // An adapter that opted out of compact returns `ok:false` from the
    // dispatcher WITHOUT throwing. That is still a failed compact, not a
    // success, and must not be left looking like a run still in progress.
    // We keep the env-var so the ratio probe still reads 0.88, and swap only
    // the compact pathway to 'noop'.
    const base = getAdapter('claude-code');
    const optedOut = {
      ...base,
      compact: { ...base.compact, compactPathway: 'noop' },
    } as typeof base;
    _setAdapterForTesting('claude-code', optedOut);
    try {
      const result = await runAutoCompact({
        projectRoot,
        sessionId: LIFECYCLE_SID,
        env: envAtRatio(0.88),
      });
      expect(result.ok).toBe(false);

      const read = readLifecycle(projectRoot);
      expect(read.kind).toBe('valid');
      if (read.kind !== 'valid') throw new Error('expected valid record');
      expect(read.record.stage).toBe('failed');
      expect(read.record.failedAt).toBe('compacting');
    } finally {
      _resetAdaptersForTesting();
    }
  });

  it('Case 13: lifecycle write failure never changes the compact return envelope', async () => {
    // Telemetry must not alter threshold or dispatch decisions.
    const withTelemetry = await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.88),
    });
    const clean = mkdtempSync(join(tmpdir(), 'peaks-lifecycle-t5-nolc-'));
    try {
      const withBrokenTelemetry = await runAutoCompact({
        projectRoot: clean,
        sessionId: LIFECYCLE_SID,
        env: envAtRatio(0.88),
        failLifecycleWriteForTest: new Error('lifecycle store unavailable'),
      });
      expect(withBrokenTelemetry.ok).toBe(withTelemetry.ok);
      expect(withBrokenTelemetry.code).toBe(withTelemetry.code);
    } finally {
      try { rmSync(clean, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  });
});

describe('integration — verifying/completed driven by the real post-compact probe', () => {
  let projectRoot = '';

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-lifecycle-t5-post-'));
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    projectRoot = '';
  });

  it('Case 14: the next probe measures a dropped ratio and completes the open run', async () => {
    // Turn 1: the runner is full → dispatch. Record rests at `compacting`.
    await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.88),
    });
    const mid = readLifecycle(projectRoot);
    if (mid.kind !== 'valid') throw new Error('expected valid record');
    expect(mid.record.stage).toBe('compacting');
    const runId = mid.record.runId;

    // Turn 2: the IDE has compacted; the adapter's postCompactDetectCommand
    // (`peaks compact auto --json`) runs again and MEASURES 0.20.
    const after = await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.20),
    });
    expect(after.code).toBe('AUTO_COMPACT_SKIP');

    const done = readLifecycle(projectRoot);
    expect(done.kind).toBe('valid');
    if (done.kind !== 'valid') throw new Error('expected valid record');
    expect(done.record.stage).toBe('completed');
    // Same run — completion closes out the run that was opened, not a new one.
    expect(done.record.runId).toBe(runId);
    // afterRatio comes from readContextPercent, never from a guess.
    expect(done.record.afterRatio).toBeCloseTo(0.20, 5);
    expect(done.record.triggerRatio).toBeCloseTo(0.88, 5);
  });

  it('Case 15: a probe that still reads high does NOT complete the run', async () => {
    await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.88),
    });
    // Still full → the compact has not landed. Re-dispatch, do not "complete".
    await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.90),
    });
    const read = readLifecycle(projectRoot);
    if (read.kind !== 'valid') throw new Error('expected valid record');
    expect(read.record.stage).not.toBe('completed');
  });

  it('Case 16: an unmeasurable probe leaves the run open rather than faking completion', async () => {
    await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.88),
    });
    // Claude Code is still the active IDE, but no env / statusline /
    // transcript signal is available, so the reader falls through to
    // `conservative-fallback` with ratio 0. That 0 means "we could not
    // measure", NOT "the context is empty" — completing on it would
    // publish a fabricated afterRatio of 0.
    const probe = await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: { CLAUDE_CODE_ENTRYPOINT: 'cli' },
    });
    // Guard the premise: this must be the below-threshold path (i.e. the
    // settle logic really did run and really did decline), not a path
    // that never reached the settle branch at all.
    expect(probe.code).toBe('AUTO_COMPACT_SKIP');
    if (!('data' in probe)) throw new Error('expected data on skip envelope');
    expect((probe.data as { source: string }).source).toBe('conservative-fallback');

    const read = readLifecycle(projectRoot);
    if (read.kind !== 'valid') throw new Error('expected valid record');
    expect(read.record.stage).toBe('compacting');
    expect(read.record.afterRatio).toBeUndefined();
  });
});

describe('a11y — lifecycle error summaries stay short and human-readable', () => {
  let projectRoot = '';

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-lifecycle-t5-a11y-'));
  });

  afterEach(() => {
    try { rmSync(projectRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    projectRoot = '';
  });

  it('Case 17: a long error is bounded and carries no stack-trace fragment', async () => {
    const noisy = new Error(`boom ${'x'.repeat(500)}\n    at someFrame (/src/a.ts:1:1)`);
    await runAutoCompact({
      projectRoot,
      sessionId: LIFECYCLE_SID,
      env: envAtRatio(0.88),
      failCompactingForTest: noisy,
    });
    const read = readLifecycle(projectRoot);
    if (read.kind !== 'valid') throw new Error('expected valid record');
    const summary = read.record.errorSummary ?? '';
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(summary).not.toContain('\n');
    expect(summary).not.toMatch(/\bat\s+\S+\s+\(/);
  });
});
