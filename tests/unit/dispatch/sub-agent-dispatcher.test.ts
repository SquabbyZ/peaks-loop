/**
 * 2.7.0 slice-dag-dispatcher MVP (slice 1.2.a) — sub-agent dispatcher shape tests.
 *
 * Covers AC-3.a / AC-3.b from the 1.1 PRD: every `SubAgentDispatcher`
 * implementation exposes a stable `awaitBatch` envelope shape; claude-code
 * implements a real join barrier, the 4 other IDEs return an `awaitByLlm`
 * marker, and `nullSubAgentDispatcher` throws.
 *
 * Sibling to `tests/unit/sub-agent-dispatcher.test.ts` which guards the
 * `buildToolCall` shape; this file guards `awaitBatch`.
 */
import { describe, expect, it } from 'vitest';
import {
  awaitByLlmFallback,
  awaitClaudeCodeBatch,
  claudeCodeSubAgentDispatcher,
  nullSubAgentDispatcher,
  SubAgentNotSupportedError,
  traeSubAgentDispatcher,
  type SubAgentAwaitBatchInput
} from '../../../src/services/dispatch/sub-agent-dispatcher.js';

describe('SubAgentDispatcher.awaitBatch shape (AC-3.a)', () => {
  it('claude-code exposes awaitBatch', () => {
    expect(typeof claudeCodeSubAgentDispatcher.awaitBatch).toBe('function');
  });

  it('trae exposes awaitBatch (1.2 fallback; real per-IDE in 1.3)', () => {
    expect(typeof traeSubAgentDispatcher.awaitBatch).toBe('function');
  });

  it('null dispatcher awaitBatch throws SubAgentNotSupportedError', async () => {
    const input: SubAgentAwaitBatchInput = {
      batchId: 'b1',
      dispatchCount: 1,
      recordPaths: []
    };
    await expect(nullSubAgentDispatcher.awaitBatch!(input)).rejects.toBeInstanceOf(SubAgentNotSupportedError);
  });
});

describe('claude-code awaitClaudeCodeBatch (AC-3.b)', () => {
  it('returns [] for empty input', async () => {
    const r = await awaitClaudeCodeBatch({
      batchId: 'b1',
      dispatchCount: 0,
      recordPaths: []
    });
    expect(r).toEqual([]);
  });

  it('reports timeout for missing record files after deadline', async () => {
    const r = await awaitClaudeCodeBatch({
      batchId: 'b1',
      dispatchCount: 1,
      recordPaths: ['/tmp/this-file-does-not-exist-slice-dag-test.json'],
      timeoutMs: 200
    });
    expect(r.length).toBe(1);
    expect(r[0]?.status).toBe('timeout');
    expect(r[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('awaitByLlmFallback (AC-3.b trae/trae-cn/codex/cursor)', () => {
  it('returns one timeout marker per recordPath with note=`awaitByLlm: <ide>`', async () => {
    const r = await awaitByLlmFallback(
      { batchId: 'b2', dispatchCount: 2, recordPaths: ['/x/a.json', '/x/b.json'] },
      'trae'
    );
    expect(r.length).toBe(2);
    expect(r[0]?.status).toBe('timeout');
    expect(r[0]?.note).toContain('awaitByLlm: trae');
    expect(r[0]?.note).toContain('1.2 fallback');
  });
});
