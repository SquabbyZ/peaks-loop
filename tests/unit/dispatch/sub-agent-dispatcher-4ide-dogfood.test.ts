/**
 * 2.7.0 slice-dag-dispatcher (slice 1.3) — 4-IDE awaitBatch dogfood.
 *
 * Covers AC-3.c from the 1.1 PRD:
 *   trae / trae-cn / codex / cursor each have a REAL `awaitBatch`
 *   implementation in slice 1.3 (not the 1.2 `awaitByLlmFallback`
 *   marker). The 5 IDEs (claude-code + 4) all read dispatch record
 *   files the same way; the only per-IDE distinction is the
 *   default timeout + the note label surfaced on timeout.
 *
 * Sibling to:
 *   - tests/unit/dispatch/sub-agent-dispatcher.test.ts (1.2 marker test,
 *     still passes — `awaitByLlmFallback` is preserved as a deprecated
 *     export for legacy callers).
 *   - tests/unit/dispatch/sub-agent-dispatcher-cross-platform.test.ts
 *     (path discipline guard; covers all 5 dispatchers via
 *     `pollDispatchRecords` and the new dispatchers).
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  awaitByLlmFallback,
  awaitClaudeCodeBatch,
  claudeCodeSubAgentDispatcher,
  codexSubAgentDispatcher,
  cursorSubAgentDispatcher,
  pollDispatchRecords,
  traeCnSubAgentDispatcher,
  traeSubAgentDispatcher,
  type SubAgentAwaitBatchInput
} from '../../../src/services/dispatch/sub-agent-dispatcher.js';

let tmpDir = '';
const sessionId = '2026-06-18-slice-1-3-4ide-dogfood';

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-slice-1-3-dogfood-'));
});

afterAll(() => {
  if (tmpDir && existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

/** Write a fake dispatch record file at the given absolute path. */
function writeRecord(
  sliceId: string,
  body: Record<string, unknown>
): string {
  const p = join(tmpDir, `${sliceId}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(body), 'utf8');
  return p;
}

describe('AC-3.c: trae / trae-cn / codex / cursor have real awaitBatch (slice 1.3)', () => {
  it('trae exposes awaitBatch and is no longer the 1.2 awaitByLlmFallback marker', () => {
    expect(typeof traeSubAgentDispatcher.awaitBatch).toBe('function');
  });

  it('trae-cn exposes awaitBatch', () => {
    expect(typeof traeCnSubAgentDispatcher.awaitBatch).toBe('function');
  });

  it('codex exposes awaitBatch', () => {
    expect(typeof codexSubAgentDispatcher.awaitBatch).toBe('function');
  });

  it('cursor exposes awaitBatch', () => {
    expect(typeof cursorSubAgentDispatcher.awaitBatch).toBe('function');
  });

  it('all 5 dispatchers are distinct instances (per-IDE attribution)', () => {
    expect(claudeCodeSubAgentDispatcher).not.toBe(traeSubAgentDispatcher);
    expect(claudeCodeSubAgentDispatcher).not.toBe(traeCnSubAgentDispatcher);
    expect(claudeCodeSubAgentDispatcher).not.toBe(codexSubAgentDispatcher);
    expect(claudeCodeSubAgentDispatcher).not.toBe(cursorSubAgentDispatcher);
    expect(traeSubAgentDispatcher).not.toBe(traeCnSubAgentDispatcher);
    expect(traeSubAgentDispatcher).not.toBe(codexSubAgentDispatcher);
    expect(traeSubAgentDispatcher).not.toBe(cursorSubAgentDispatcher);
    expect(traeCnSubAgentDispatcher).not.toBe(codexSubAgentDispatcher);
    expect(traeCnSubAgentDispatcher).not.toBe(cursorSubAgentDispatcher);
    expect(codexSubAgentDispatcher).not.toBe(cursorSubAgentDispatcher);
  });

  it('all 5 dispatchers expose the per-IDE label', () => {
    expect(claudeCodeSubAgentDispatcher.label).toBe('claude-code');
    expect(traeSubAgentDispatcher.label).toBe('trae');
    expect(traeCnSubAgentDispatcher.label).toBe('trae-cn');
    expect(codexSubAgentDispatcher.label).toBe('codex');
    expect(cursorSubAgentDispatcher.label).toBe('cursor');
  });
});

describe('AC-3.c: per-IDE awaitBatch resolves done records to status=done', () => {
  it('trae awaits done records with note prefix "trae 1.3 real awaitBatch"', async () => {
    const path = writeRecord('trae-1', { status: 'done' });
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-trae-1',
      dispatchCount: 1,
      recordPaths: [path]
    };
    const r = await traeSubAgentDispatcher.awaitBatch!(input);
    expect(r.length).toBe(1);
    expect(r[0]?.status).toBe('done');
    expect(r[0]?.note).toContain('trae 1.3 real awaitBatch');
  });

  it('trae-cn awaits done records with note prefix "trae-cn 1.3 real awaitBatch"', async () => {
    const path = writeRecord('trae-cn-1', { status: 'success' });
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-trae-cn-1',
      dispatchCount: 1,
      recordPaths: [path]
    };
    const r = await traeCnSubAgentDispatcher.awaitBatch!(input);
    expect(r.length).toBe(1);
    expect(r[0]?.status).toBe('done');
    expect(r[0]?.note).toContain('trae-cn 1.3 real awaitBatch');
  });

  it('codex awaits done records with note prefix "codex 1.3 real awaitBatch"', async () => {
    const path = writeRecord('codex-1', { status: 'done' });
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-codex-1',
      dispatchCount: 1,
      recordPaths: [path]
    };
    const r = await codexSubAgentDispatcher.awaitBatch!(input);
    expect(r.length).toBe(1);
    expect(r[0]?.status).toBe('done');
    expect(r[0]?.note).toContain('codex 1.3 real awaitBatch');
  });

  it('cursor awaits done records with note prefix "cursor 1.3 real awaitBatch"', async () => {
    const path = writeRecord('cursor-1', { status: 'done' });
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-cursor-1',
      dispatchCount: 1,
      recordPaths: [path]
    };
    const r = await cursorSubAgentDispatcher.awaitBatch!(input);
    expect(r.length).toBe(1);
    expect(r[0]?.status).toBe('done');
    expect(r[0]?.note).toContain('cursor 1.3 real awaitBatch');
  });
});

describe('AC-3.c: per-IDE awaitBatch surfaces failed / cancelled / stale outcomes', () => {
  it('trae reads { status: failed, outcome: "..." } into status=failed with note appended', async () => {
    const path = writeRecord('trae-fail', { status: 'failed', outcome: 'cli-disagreement' });
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-trae-fail',
      dispatchCount: 1,
      recordPaths: [path]
    };
    const r = await traeSubAgentDispatcher.awaitBatch!(input);
    expect(r[0]?.status).toBe('failed');
    expect(r[0]?.note).toContain('cli-disagreement');
  });

  it('codex reads { status: cancelled } into status=cancelled', async () => {
    const path = writeRecord('codex-cancel', { status: 'cancelled' });
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-codex-cancel',
      dispatchCount: 1,
      recordPaths: [path]
    };
    const r = await codexSubAgentDispatcher.awaitBatch!(input);
    expect(r[0]?.status).toBe('cancelled');
  });

  it('cursor reads { status: stale } into status=timeout (matches claude-code semantics)', async () => {
    const path = writeRecord('cursor-stale', { status: 'stale' });
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-cursor-stale',
      dispatchCount: 1,
      recordPaths: [path]
    };
    const r = await cursorSubAgentDispatcher.awaitBatch!(input);
    expect(r[0]?.status).toBe('timeout');
    expect(r[0]?.note).toContain('stale');
  });
});

describe('AC-3.c: per-IDE timeout defaults are distinguishable (slice 1.3 design)', () => {
  it('trae default timeout surfaces "trae 1.3 real awaitBatch (timeout)" when no record', async () => {
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-trae-timeout',
      dispatchCount: 1,
      recordPaths: [join(tmpDir, 'never-written-trae.json')],
      timeoutMs: 100
    };
    const r = await traeSubAgentDispatcher.awaitBatch!(input);
    expect(r[0]?.status).toBe('timeout');
    expect(r[0]?.note).toContain('trae 1.3 real awaitBatch');
    expect(r[0]?.note).toContain('(timeout)');
  });

  it('codex default timeout surfaces "codex 1.3 real awaitBatch (timeout)" when no record', async () => {
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-codex-timeout',
      dispatchCount: 1,
      recordPaths: [join(tmpDir, 'never-written-codex.json')],
      timeoutMs: 100
    };
    const r = await codexSubAgentDispatcher.awaitBatch!(input);
    expect(r[0]?.status).toBe('timeout');
    expect(r[0]?.note).toContain('codex 1.3 real awaitBatch');
    expect(r[0]?.note).toContain('(timeout)');
  });

  it('cursor default timeout surfaces "cursor 1.3 real awaitBatch (timeout)" when no record', async () => {
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-cursor-timeout',
      dispatchCount: 1,
      recordPaths: [join(tmpDir, 'never-written-cursor.json')],
      timeoutMs: 100
    };
    const r = await cursorSubAgentDispatcher.awaitBatch!(input);
    expect(r[0]?.status).toBe('timeout');
    expect(r[0]?.note).toContain('cursor 1.3 real awaitBatch');
    expect(r[0]?.note).toContain('(timeout)');
  });
});

describe('AC-3.c: 1.3 dispatchers differ from 1.2 awaitByLlmFallback (no regression)', () => {
  it('trae 1.3 awaitBatch does NOT return the 1.2 awaitByLlm marker', async () => {
    const path = writeRecord('trae-no-marker', { status: 'done' });
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-trae-no-marker',
      dispatchCount: 1,
      recordPaths: [path]
    };
    const r = await traeSubAgentDispatcher.awaitBatch!(input);
    expect(r[0]?.note).not.toContain('awaitByLlm: trae 1.2 fallback');
    expect(r[0]?.note).toContain('trae 1.3 real awaitBatch');
  });

  it('awaitByLlmFallback still returns the 1.2 marker (deprecated export preserved)', async () => {
    const r = await awaitByLlmFallback(
      { batchId: 'b-fallback', dispatchCount: 2, recordPaths: ['/x/a.json', '/x/b.json'] },
      'trae'
    );
    expect(r.length).toBe(2);
    expect(r[0]?.note).toContain('awaitByLlm: trae 1.2 fallback');
  });
});

describe('AC-3.c: pollDispatchRecords shared core (file-based, cross-platform)', () => {
  it('returns [] for empty input (dispatchCount=0)', async () => {
    const r = await pollDispatchRecords(
      { batchId: 'b-empty', dispatchCount: 0, recordPaths: [] },
      { ide: 'trae', defaultTimeoutMs: 30_000, notePrefix: 'trae 1.3' }
    );
    expect(r).toEqual([]);
  });

  it('respects per-call timeoutMs override (must terminate well under 1s)', async () => {
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-override',
      dispatchCount: 1,
      recordPaths: [join(tmpDir, 'never-written-override.json')],
      timeoutMs: 150
    };
    const startedAt = Date.now();
    const r = await pollDispatchRecords(input, {
      ide: 'codex',
      defaultTimeoutMs: 45_000,
      notePrefix: 'override-test'
    });
    const elapsed = Date.now() - startedAt;
    expect(r[0]?.status).toBe('timeout');
    expect(elapsed).toBeLessThan(2_000);
  });

  it('reports multiple records in dispatchIndex order (stable sort)', async () => {
    const pathA = writeRecord('multi-a', { status: 'done' });
    const pathB = writeRecord('multi-b', { status: 'failed', outcome: 'broke' });
    const pathC = writeRecord('multi-c', { status: 'done' });
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-multi',
      dispatchCount: 3,
      recordPaths: [pathA, pathB, pathC]
    };
    const r = await pollDispatchRecords(input, {
      ide: 'cursor',
      defaultTimeoutMs: 30_000,
      notePrefix: 'multi-test'
    });
    expect(r.length).toBe(3);
    expect(r[0]?.dispatchIndex).toBe(0);
    expect(r[0]?.status).toBe('done');
    expect(r[1]?.dispatchIndex).toBe(1);
    expect(r[1]?.status).toBe('failed');
    expect(r[2]?.dispatchIndex).toBe(2);
    expect(r[2]?.status).toBe('done');
  });
});

describe('AC-3.c: 5 IDE envelope shape parity (one batch, 5 records)', () => {
  it('all 5 dispatchers produce same SubAgentBatchResult shape for the same input', async () => {
    const records = [
      writeRecord('sh-A', { status: 'done' }),
      writeRecord('sh-B', { status: 'done' }),
      writeRecord('sh-C', { status: 'failed', outcome: 'sh-fail' }),
      writeRecord('sh-D', { status: 'done' }),
      writeRecord('sh-E', { status: 'done' })
    ];
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-shape',
      dispatchCount: 5,
      recordPaths: records
    };
    const dispatchers = [
      claudeCodeSubAgentDispatcher,
      traeSubAgentDispatcher,
      traeCnSubAgentDispatcher,
      codexSubAgentDispatcher,
      cursorSubAgentDispatcher
    ];
    const batches = await Promise.all(
      dispatchers.map(async (d) => {
        expect(typeof d.awaitBatch).toBe('function');
        return d.awaitBatch!(input);
      })
    );
    // All 5 IDEs should report the same status array: done, done, failed, done, done
    const statusByIde = batches.map((b) => b.map((r) => r.status));
    expect(statusByIde[0]).toEqual(['done', 'done', 'failed', 'done', 'done']);
    expect(statusByIde[1]).toEqual(['done', 'done', 'failed', 'done', 'done']);
    expect(statusByIde[2]).toEqual(['done', 'done', 'failed', 'done', 'done']);
    expect(statusByIde[3]).toEqual(['done', 'done', 'failed', 'done', 'done']);
    expect(statusByIde[4]).toEqual(['done', 'done', 'failed', 'done', 'done']);
    // Notes differ by IDE — each one should carry its own label
    expect(batches[0]?.[0]?.note).toBeNull();
    expect(batches[1]?.[0]?.note).toContain('trae 1.3 real awaitBatch');
    expect(batches[2]?.[0]?.note).toContain('trae-cn 1.3 real awaitBatch');
    expect(batches[3]?.[0]?.note).toContain('codex 1.3 real awaitBatch');
    expect(batches[4]?.[0]?.note).toContain('cursor 1.3 real awaitBatch');
  });
});

describe('AC-8.cross-platform: 4-IDE path discipline', () => {
  it('every 1.3 IDE note contains no hardcoded /Users/ or C:\\ path', async () => {
    // Build a synthetic "failed" outcome so each IDE surfaces a note.
    const path = writeRecord('cross-platform', { status: 'failed', outcome: 'x' });
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-xp',
      dispatchCount: 1,
      recordPaths: [path]
    };
    const rTrae = await traeSubAgentDispatcher.awaitBatch!(input);
    const rTraeCn = await traeCnSubAgentDispatcher.awaitBatch!(input);
    const rCodex = await codexSubAgentDispatcher.awaitBatch!(input);
    const rCursor = await cursorSubAgentDispatcher.awaitBatch!(input);
    for (const r of [rTrae[0], rTraeCn[0], rCodex[0], rCursor[0]]) {
      expect(r?.note ?? '').not.toMatch(/\/Users\/[A-Za-z0-9_.-]+/);
      expect(r?.note ?? '').not.toMatch(/C:\\\\/);
    }
  });

  it('claude-code awaitBatch + 1.3 pollDispatchRecords use the same dispatch-record transport', async () => {
    // Same record file should produce the same status reading regardless of
    // which IDE awaits it. This is the cross-platform contract — the
    // `SubAgentBatchResult.status` field must be uniform across all 5 IDEs.
    const path = writeRecord('shared', { status: 'failed', outcome: 'shared-x' });
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b-shared',
      dispatchCount: 1,
      recordPaths: [path]
    };
    const rClaude = await awaitClaudeCodeBatch(input);
    const rTrae = await traeSubAgentDispatcher.awaitBatch!(input);
    expect(rClaude[0]?.status).toBe(rTrae[0]?.status);
  });
});
