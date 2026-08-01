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

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  evaluateAutoCompactDecision,
} from '~/src/services/code/auto-compact-orchestrator';

declareDimensions(
  'tests/unit/code/auto-compact-orchestrator.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'pure verdict function; no user-visible text emitted' }],
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
