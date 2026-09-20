// tests/unit/code/auto-compact-dispatch-backoff.test.ts
//
// rid `2026-09-14-compact-dispatch-backoff` — one dispatch per compact attempt.
//
// THE MEASUREMENT THIS IS WRITTEN AGAINST (one real session, verbatim from
// `.peaks/_runtime/2026-09-13-session-21878f/compact-history.jsonl`):
//
//   span            2026-09-13T22:43:33.618Z → 2026-09-14T14:15:02.114Z (~15.5 h)
//   dispatch rows   1034        (100% `kind: 'dispatch'`)
//   observed rows   0
//   checkpoints     444
//   beforeRatio     0.6577 → 0.8613, never back below the auto-fire threshold
//   mode            partial
//
// Cause: `evaluateAutoCompactDecision` fires on every probe whose ratio is at
// or over the auto-fire threshold, and that ratio never comes back down —
// peaks-loop cannot compact a running session, so the obligation could never be
// discharged. The dispatch it fired is idempotent (`ide-native` re-installs the
// same PreToolUse hook, a documented no-op), so the 1034 repeats bought no
// capability. A signal that fires 1034 times is not a signal.
//
// THE TWO-SIDED CONTROL. This slice is as easy to get wrong in the other
// direction — a backoff that silences the crossing is worse than the noise — so
// the ACs below are pinned in PAIRS, not singly:
//
//   AC1  the bound is a provable NUMBER (exactly 1 dispatch row per crossing),
//        not "fewer rows than before"
//   AC2  the first crossing is still RECORDED, and while the backoff holds the
//        probe still reports the LIVE ratio, so "still high, unanswered" stays
//        legible — the remaining difference between a quiet signal and a
//        silenced one
//   AC3  CONTROL GROUP: a real compaction still produces its dispatch+observed
//        pair, and the crossing AFTER it still gets its own dispatch
//   AC4  the append-only history file is never rewritten and rows written by the
//        previous release still parse
//
// Dimensions:
//   - render:      the backoff envelope's shape and the words it uses
//   - behavior:    the bound, the live-ratio report, and the stage the gate
//                  keys on
//   - integration: real files on disk — the history file and the lifecycle store
//   - a11y:        the user-visible sentence (no fabricated "a compaction
//                  happened", no CLI verb the reader must type)
//
// Run with: pnpm vitest run tests/unit/code/auto-compact-dispatch-backoff.test.ts

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { runAutoCompact } from '~/src/services/code/auto-compact-orchestrator';
import {
  readCompactLifecycle,
  writeCompactLifecycle
} from '~/src/services/compact-statusline/compact-lifecycle-store';
import { readOpenDispatchRun } from '~/src/services/code/auto-compact-lifecycle';
import {
  computeWindowCalibration,
  readCompactHistory
} from '~/src/services/compact-history/compact-history-service';

declareDimensions('tests/unit/code/auto-compact-dispatch-backoff.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SID = '2026-09-14-dispatch-backoff';

/** Env that makes the reader report an exact ratio via the P1 env path. */
function envAtRatio(ratio: number): NodeJS.ProcessEnv {
  return {
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    CLAUDE_CONTEXT_USAGE_PERCENT: String(ratio)
  };
}

function historyPath(projectRoot: string): string {
  return join(projectRoot, '.peaks', '_runtime', SID, 'compact-history.jsonl');
}

function readRows(projectRoot: string): Array<Record<string, unknown>> {
  const raw = readFileSync(historyPath(projectRoot), 'utf8');
  return raw
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function dispatchRows(projectRoot: string): Array<Record<string, unknown>> {
  return readRows(projectRoot).filter((r) => (r['kind'] ?? 'dispatch') === 'dispatch');
}

function lifecycleOf(projectRoot: string) {
  return readCompactLifecycle({
    projectRoot,
    sessionId: SID,
    nowMs: Date.now(),
    staleAfterMs: 60_000
  });
}

let projectRoot = '';

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-backoff-'));
});

afterEach(() => {
  try {
    rmSync(projectRoot, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  projectRoot = '';
});

describe('Scenario: behavior — AC1, the bound on dispatch rows', () => {
  it('when invoked, should Case 1 (AC1): a ratio that crosses and never falls produces EXACTLY ONE dispatch row, however many probes run', async () => {
    // given: a session whose ratio is above the auto-fire threshold and does not
    //        come back down — the measured defect, 1034 rows, 15.5 h, no compact
    // when:  the same probe runs repeatedly
    const codes: string[] = [];
    for (const ratio of [0.86, 0.88, 0.9, 0.92, 0.94, 0.96, 0.98, 0.99, 1.0]) {
      const result = await runAutoCompact({
        projectRoot,
        sessionId: SID,
        env: envAtRatio(ratio)
      });
      codes.push(result.code);
    }
    // then: exactly one row, and it is the FIRST probe's
    expect(dispatchRows(projectRoot)).toHaveLength(1);
    expect(codes[0]).toBe('AUTO_COMPACT_DISPATCHED');
    expect(codes.slice(1)).toEqual(Array(codes.length - 1).fill('AUTO_COMPACT_ALREADY_ARMED'));
    // The bound is 1, and this is where it comes from: a dispatch is admitted
    // only when `readOpenDispatchRun` finds NO open attempt, and a run closes
    // only on a settle — which requires the ratio to fall, which by hypothesis
    // never happens. So the one run opened by the crossing is never superseded,
    // and the crossing admits exactly one dispatch.
    expect(readOpenDispatchRun({ projectRoot, sessionId: SID })).toMatchObject({
      kind: 'open',
      stage: 'armed'
    });
  });

  it('when invoked, should Case 2 (AC1): the bound is 1 per crossing, not 1 per session — it is the RUN that is open, not a global latch', async () => {
    // given: eleven crossings' worth of probes is impossible to fake without a
    //        compaction, so this pins the mechanism instead: the gate releases
    //        the moment no attempt is outstanding
    // when:  the run is settled by a real measured drop, then the ratio climbs again
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.9) });
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.2) });
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.91) });
    // then: two dispatches — one per crossing — and one observation
    const kinds = readRows(projectRoot).map((r) => r['kind'] ?? 'dispatch');
    expect(kinds).toEqual(['dispatch', 'observed', 'dispatch']);
  });

  it('when invoked, should Case 3: the gate keys on the run STAGE, not on a ratio, so an over-threshold probe does not re-open a red-line run either', async () => {
    // given: a run dispatched at the red line (>=95%: the harness's own trigger
    //        is satisfied, so the honest resting stage is `compacting`)
    // when:  probes keep arriving at or above the red line
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.97) });
    const first = lifecycleOf(projectRoot);
    if (first.kind !== 'valid') throw new Error(`expected a valid record, got ${first.kind}`);
    expect(first.record.stage).toBe('compacting');
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.98) });
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.99) });
    // then: still one row, and the record is still the run that was opened
    expect(dispatchRows(projectRoot)).toHaveLength(1);
    const after = lifecycleOf(projectRoot);
    if (after.kind !== 'valid') throw new Error(`expected a valid record, got ${after.kind}`);
    expect(after.record.runId).toBe(first.record.runId);
  });

  it('when invoked, should Case 4: a FAILED attempt does not latch the backoff — the next probe is free to dispatch again', async () => {
    // given: an attempt that died before dispatch left the store at `failed`
    // when:  the ratio is still over the threshold
    writeCompactLifecycle({
      projectRoot,
      sessionId: SID,
      record: {
        schemaVersion: 1,
        runId: 'compact-died',
        stage: 'failed',
        updatedAt: new Date().toISOString(),
        triggerRatio: 0.9,
        redLine: false,
        failedAt: 'preparing',
        errorSummary: 'disk full while writing checkpoint'
      }
    });
    const result = await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.9) });
    // then: a failure is a reason to try again, not a reason to stay quiet
    expect(result.code).toBe('AUTO_COMPACT_DISPATCHED');
    expect(dispatchRows(projectRoot)).toHaveLength(1);
  });

  it('when invoked, should Case 5: `force` outranks the backoff, so the published --force flag is not silently a no-op', async () => {
    // given: an open run and an explicit instruction to compact anyway
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.9) });
    // when:  the caller forces it
    const forced = await runAutoCompact({
      projectRoot,
      sessionId: SID,
      env: envAtRatio(0.9),
      force: true
    });
    // then: the instruction is honoured — an inference about whether re-asking
    //       helps must never reduce an explicit command to a silent no-op
    expect(forced.code).toBe('AUTO_COMPACT_DISPATCHED');
    expect(dispatchRows(projectRoot)).toHaveLength(2);
  });
});

describe('Scenario: behavior — AC2, the crossing is still recorded and still legible', () => {
  it('when invoked, should Case 6 (AC2): the FIRST crossing is still written, with the ratio it crossed at', async () => {
    // given/when: the crossing
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.87) });
    const rows = dispatchRows(projectRoot);
    // then: recorded, not swallowed — the whole point of the backoff is that the
    //       first crossing survives it
    expect(rows).toHaveLength(1);
    expect(rows[0]!['beforeRatio']).toBeCloseTo(0.87, 5);
    expect(rows[0]!['ok']).toBe(true);
  });

  it('when invoked, should Case 7 (AC2): while the backoff holds, the probe reports the LIVE ratio AND the ratio the open ask was made at', async () => {
    // given: a crossing at 0.87
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.87) });
    // when: the ratio KEEPS RISING with nothing compacted
    const later = await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.94) });
    // then: the fact that it is still high is not lost — the live reading is
    //       reported (0.94), paired with the unanswered ask (0.87). This pair is
    //       what replaces the per-probe rows the backoff stops writing.
    expect(later.code).toBe('AUTO_COMPACT_ALREADY_ARMED');
    if (later.code !== 'AUTO_COMPACT_ALREADY_ARMED')
      throw new Error('expected the backoff envelope');
    expect(later.data.ratio).toBeCloseTo(0.94, 5);
    expect(later.data.armedAtRatio).toBeCloseTo(0.87, 5);
    expect(later.data.decision).toBe('already-armed');
    // and the open attempt is still the one the crossing opened
    const open = readOpenDispatchRun({ projectRoot, sessionId: SID });
    expect(open).toMatchObject({ kind: 'open' });
    expect(open.kind === 'open' ? open.triggerRatio : null).toBeCloseTo(0.87, 5);
  });

  it("when invoked, should Case 8 (AC2): the suppressed probe writes NO checkpoint, which is where 444 of the 15.5-hour session's files came from", async () => {
    // given: a crossing
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.88) });
    // when:  two more probes are suppressed
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.9) });
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.92) });
    // then: the number of dispatch rows and the number of checkpoints agree —
    //       both are 1. The suppression is of the whole side effect, not of the
    //       history row alone.
    const checkpointDir = join(projectRoot, '.peaks', '_runtime', SID, 'checkpoints');
    expect(readdirSync(checkpointDir)).toHaveLength(1);
    expect(dispatchRows(projectRoot)).toHaveLength(1);
  });
});

describe('Scenario: integration — AC3, the control group (a real compaction still pairs)', () => {
  it('when invoked, should Case 9 (AC3): a real compaction still produces its dispatch + observed pair', async () => {
    // given: a dispatch, then a REAL compaction (the next probe measures a drop
    //        below the auto-fire threshold — the adapter's own
    //        postCompactDetectCommand)
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.93) });
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.3) });
    // then: the pair exists and is measured — the backoff must not eat the
    //       calibration data it is supposed to be cleaning up around
    const rows = readRows(projectRoot);
    expect(rows.map((r) => r['kind'])).toEqual(['dispatch', 'observed']);
    expect(rows[1]!['beforeRatio']).toBeCloseTo(0.93, 5);
    expect(rows[1]!['afterRatio']).toBeCloseTo(0.3, 5);
    const read = readCompactHistory({ projectRoot, sessionId: SID });
    if (read.kind !== 'ok') throw new Error(`expected ok, got ${read.kind}`);
    const calibration = computeWindowCalibration(read.events);
    expect(calibration.pairs).toHaveLength(1);
    expect(calibration.pairs[0]?.measured).toBe(true);
    expect(calibration.unmeasured).toBe(0);
  });

  it('when invoked, should Case 10 (AC3): a compaction whose ratio settles ABOVE the threshold does not fake a pair — the run stays open', async () => {
    // given: a dispatch at 0.88, then a probe that still reads over the
    //        threshold. Nothing proves a compaction landed.
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.88) });
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.9) });
    // then: no `observed` row is invented, and the run is still open
    expect(readRows(projectRoot).map((r) => r['kind'] ?? 'dispatch')).toEqual(['dispatch']);
    expect(readOpenDispatchRun({ projectRoot, sessionId: SID })).toMatchObject({
      kind: 'open',
      stage: 'armed'
    });
  });
});

describe('Scenario: integration — AC4, the history file is append-only and stays readable', () => {
  // A row written by the PREVIOUS release, copied verbatim out of the measured
  // session (`.peaks/_runtime/2026-09-13-session-21878f/compact-history.jsonl`,
  // first line). Not synthesised: the point of this case is that the shapes the
  // old release actually wrote still parse under the new code.
  const LEGACY_ROW =
    '{"schemaVersion":1,"kind":"dispatch","ts":"2026-09-13T22:43:33.618Z","target":"main","mode":"partial","ide":"claude-code","pathway":"ide-native","beforeRatio":0.657719,"redLine":false,"ok":true,"checkpointPath":".peaks\\\\_runtime\\\\2026-09-13-session-21878f\\\\checkpoints\\\\pre-compact-2026-09-13T22-43-33-618Z.json","dispatchMessage":"Auto-compact PreToolUse hook installed at .claude\\\\settings.local.json. Next Bash/Tool call will read CLAUDE_CONTEXT_USAGE_PERCENT and compact in-band at ratio ≥ 95%.","windowTokens":1000000,"windowSource":"harness-env"}';

  it('when invoked, should Case 11 (AC4): existing rows are not rewritten, and the new code APPENDS to them', async () => {
    // given: a history file already containing rows from the previous release
    mkdirSync(join(projectRoot, '.peaks', '_runtime', SID), { recursive: true });
    const seeded = `${LEGACY_ROW}\n${LEGACY_ROW}\n`;
    writeFileSync(historyPath(projectRoot), seeded, 'utf8');
    // when: the backoff runs (dispatch on the first probe, suppressed after)
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.9) });
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.92) });
    // then: the original bytes are still the file's first 2 lines, byte for byte
    const raw = readFileSync(historyPath(projectRoot), 'utf8');
    expect(raw.startsWith(seeded)).toBe(true);
    // and one row was appended, not two — the suppression is visible as line
    // count, which is the whole claim
    expect(raw.split('\n').filter((l) => l.length > 0)).toHaveLength(3);
  });

  it('when invoked, should Case 12 (AC4): every seeded legacy row still parses, and the CALIBRATION view reads them without error', () => {
    // given: the measured session's exact shape — a `dispatch` row that carries
    //        no `kind`-specific extras and, critically, no following observation
    mkdirSync(join(projectRoot, '.peaks', '_runtime', SID), { recursive: true });
    writeFileSync(historyPath(projectRoot), `${LEGACY_ROW}\n`, 'utf8');
    // when: the reader and the calibration projection run over it
    const read = readCompactHistory({ projectRoot, sessionId: SID });
    // then: no parse errors, and the row is counted as an unmeasured dispatch
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') throw new Error(`expected ok, got ${read.kind}`);
    expect(read.parseErrors).toEqual([]);
    expect(read.events).toHaveLength(1);
    expect(read.events[0]!.beforeRatio).toBeCloseTo(0.657719, 6);
    const calibration = computeWindowCalibration(read.events);
    expect(calibration.pairs).toHaveLength(1);
    expect(calibration.unmeasured).toBe(1);
    expect(calibration.lastWindowTokens).toBe(1_000_000);
  });
});

describe('Scenario: render / a11y — the sentence the human and the runner read', () => {
  it('when invoked, should Case 13: the backoff envelope is `ok`, so the runner is not told the probe FAILED', async () => {
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.9) });
    const result = await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.92) });
    expect(result.ok).toBe(true);
    expect(result.code).toBe('AUTO_COMPACT_ALREADY_ARMED');
  });

  it('when invoked, should Case 14 (a11y): the message names the live ratio, the unanswered ask, and claims no compaction', async () => {
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.9) });
    const result = await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.93) });
    // then: the human-visible text carries both numbers...
    expect(result.message).toContain('93.0%');
    expect(result.message).toContain('90.0%');
    // ...says plainly that nothing compacted...
    expect(result.message).toContain('nothing has compacted since');
    // ...and never claims a compaction landed or a ratio dropped
    expect(result.message).not.toMatch(
      /compacted successfully|ratio dropped|context is now smaller|shrunk/i
    );
  });

  it('when invoked, should Case 15 (a11y): the message asks for no CLI verb the reader must type itself', async () => {
    await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.9) });
    const result = await runAutoCompact({ projectRoot, sessionId: SID, env: envAtRatio(0.93) });
    // The reader is the LLM, and it re-probes itself; the sentence must not read
    // as an instruction addressed to a human at a shell prompt.
    expect(result.message).toContain('Re-probe');
    expect(result.message).not.toMatch(/run the following|execute|paste/i);
  });
});
