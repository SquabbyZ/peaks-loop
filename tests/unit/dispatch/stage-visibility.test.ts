/**
 * Slice 2026-07-29-dispatch-stall-governance / S5 — stage visibility
 * (AC-5.1 / AC-5.2 / AC-5.3).
 *
 * Pins the bounded stage contract:
 *   - `setStage` accepts one of `STAGE_LABELS` (or `null` to clear)
 *   - `setStage` rejects unknown values with `INVALID_STAGE`
 *   - `viewSubAgent` and `renderOne` surface the stage label so a
 *     long-`running` agent is legible
 *   - the writer's `DispatchRecord` carries the `stage: string | null`
 *     field (so a future grep for `stage` in
 *     `src/services/dispatch/dispatch-record-writer.ts` returns a
 *     non-zero count — AC-5.3)
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync as exists, readFileSync as read } from 'node:fs';
import { resolve as pathResolve, dirname as pathDirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setStage,
  writeInitialDispatchRecord,
  type DispatchRecord
} from '../../../src/services/dispatch/dispatch-record-writer.js';
import {
  STAGE_LABELS,
  isStageLabel,
  type StageLabel
} from '../../../src/services/dispatch/stage-enum.js';
import { viewSubAgent, renderStatusLine } from '../../../src/services/code/status-line-renderer.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-stage-'));
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('STAGE_LABELS (AC-5.1) — bounded enum', () => {
  it('is a non-empty array of distinct strings', () => {
    expect(STAGE_LABELS.length).toBeGreaterThan(0);
    const set = new Set<string>(STAGE_LABELS);
    expect(set.size).toBe(STAGE_LABELS.length);
  });

  it('contains the expected canonical labels', () => {
    expect(STAGE_LABELS).toContain('planning');
    expect(STAGE_LABELS).toContain('testing');
    expect(STAGE_LABELS).toContain('reviewing');
    expect(STAGE_LABELS).toContain('finalizing');
  });

  it('isStageLabel accepts each member, rejects unknowns', () => {
    for (const s of STAGE_LABELS) {
      expect(isStageLabel(s)).toBe(true);
    }
    expect(isStageLabel('awaiting-coffee')).toBe(false);
    expect(isStageLabel('')).toBe(false);
    expect(isStageLabel(null)).toBe(false);
    expect(isStageLabel(undefined)).toBe(false);
  });
});

describe('setStage (AC-5.1) — bounded label accepted, unknowns refused', () => {
  it('writes a valid stage label to the record', () => {
    const { path } = writeInitialDispatchRecord({
      projectRoot: root,
      sessionId: 'sess-stage-1',
      requestId: 'rid-stage-1',
      role: 'rd',
      prompt: 'p',
      toolCall: { name: 'Task', args: {} },
      batchId: 'b-stage-1'
    });
    const r = setStage({ recordPath: path, stage: 'planning' as StageLabel });
    expect(r.record.stage).toBe('planning');
  });

  it('clears the stage when called with null', () => {
    const { path } = writeInitialDispatchRecord({
      projectRoot: root,
      sessionId: 'sess-stage-2',
      requestId: 'rid-stage-2',
      role: 'rd',
      prompt: 'p',
      toolCall: { name: 'Task', args: {} },
      batchId: 'b-stage-2'
    });
    setStage({ recordPath: path, stage: 'planning' });
    const r = setStage({ recordPath: path, stage: null });
    expect(r.record.stage).toBeNull();
  });

  it('rejects an unknown label with INVALID_STAGE', () => {
    const { path } = writeInitialDispatchRecord({
      projectRoot: root,
      sessionId: 'sess-stage-3',
      requestId: 'rid-stage-3',
      role: 'rd',
      prompt: 'p',
      toolCall: { name: 'Task', args: {} },
      batchId: 'b-stage-3'
    });
    let thrown: unknown = null;
    try {
      setStage({ recordPath: path, stage: 'awaiting-coffee' as StageLabel });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).not.toBeNull();
    expect((thrown as { code?: string }).code).toBe('INVALID_STAGE');
  });
});

describe('viewSubAgent + renderStatusLine (AC-5.2) — stage rendered', () => {
  it('viewSubAgent surfaces the stage label', () => {
    const base: DispatchRecord = {
      version: 2,
      createdAt: '2026-07-29T00:00:00.000Z',
      completedAt: null,
      outcome: 'no-execution',
      artifactPaths: [],
      disposed: false,
      disposedAt: null,
      role: 'rd',
      requestId: 'rid-1',
      sessionId: 'sess-1',
      prompt: 'p',
      toolCall: { name: 'Task', args: {} },
      batchId: 'b-1',
      heartbeats: [],
      lastBeatAt: '2026-07-29T00:00:10.000Z',
      status: 'running',
      stage: 'testing'
    };
    const v = viewSubAgent(base, () => new Date('2026-07-29T00:00:11.000Z'));
    expect(v.stage).toBe('testing');
  });

  it('viewSubAgent returns stage: null for records that never set it', () => {
    const base: DispatchRecord = {
      version: 2,
      createdAt: '2026-07-29T00:00:00.000Z',
      completedAt: null,
      outcome: 'no-execution',
      artifactPaths: [],
      disposed: false,
      disposedAt: null,
      role: 'rd',
      requestId: 'rid-1',
      sessionId: 'sess-1',
      prompt: 'p',
      toolCall: { name: 'Task', args: {} },
      batchId: 'b-1',
      heartbeats: [],
      lastBeatAt: '2026-07-29T00:00:10.000Z',
      status: 'running',
      stage: null
    };
    const v = viewSubAgent(base, () => new Date('2026-07-29T00:00:11.000Z'));
    expect(v.stage).toBeNull();
  });

  it('renderStatusLine prefixes the stage inline so a long-running agent is legible', () => {
    const records: DispatchRecord[] = [
      {
        version: 2,
        createdAt: '2026-07-29T00:00:00.000Z',
        completedAt: null,
        outcome: 'no-execution',
        artifactPaths: [],
        disposed: false,
        disposedAt: null,
        role: 'rd',
        requestId: 'r1',
        sessionId: 's1',
        prompt: 'p',
        toolCall: { name: 'Task', args: {} },
        batchId: 'b1',
        heartbeats: [],
        lastBeatAt: '2026-07-29T00:00:10.000Z',
        status: 'running',
        stage: 'planning'
      }
    ];
    const line = renderStatusLine('[peaks]', records, () => new Date('2026-07-29T00:00:11.000Z'));
    expect(line).toContain('[planning]');
  });
});

describe('AC-5.3 — the writer source has the stage concept', () => {
  it('dispatch-record-writer.ts source contains "stage" ≥ 1 time', () => {
    const here = pathDirname(fileURLToPath(import.meta.url));
    const writer = pathResolve(here, '..', '..', '..', 'src', 'services', 'dispatch', 'dispatch-record-writer.ts');
    expect(exists(writer)).toBe(true);
    const src = read(writer, 'utf8');
    // Count any occurrence of "stage" — covers the field declaration,
    // setStage, upgradeRecord, and the inline slice comments.
    const matches = src.match(/stage/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
  });
});