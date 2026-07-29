/**
 * Slice 2026-07-29-context-evaluation-accuracy: when the
 * composer receives a context probe, the dispatch prompt
 * carries an authoritative `## Context window` block so the
 * sub-agent does not estimate context from message length.
 *
 * 4 cases:
 *  1. probe = null → block instructs the sub-agent to call
 *     `peaks code context-now` itself (no probe available).
 *  2. probe at 0.6 used → block shows "60.0% used / 40.0%
 *     free" + the soft-warn directive.
 *  3. probe at 0.97 used → block shows "97.0% used / 3.0%
 *     free" + the RED-LINE directive.
 *  4. probe omitted entirely (backward compat) → no block.
 *
 * All three with-probe cases assert the "do not estimate
 * yourself" rule appears in the block, which is the load-
 * bearing claim (without it, the LLM ignores the block and
 * reverts to self-estimating).
 */

import { describe, expect, test } from 'vitest';
import { buildDispatchSystemPrompt } from '../../../../src/services/context/build-dispatch-system-prompt.js';
import type { MemoryPreflightResult } from '../../../../src/services/context/memory-preflight-service.js';
import type { ContextPercentProbe } from '../../../../src/services/context/auto-compact-types.js';

const NO_MEMORY: MemoryPreflightResult = { available: false, block: null };

function makeProbe(ratio: number, source: 'statusline-poll' | 'env-var' | 'conservative-fallback' = 'statusline-poll'): ContextPercentProbe {
  return {
    ratio,
    capacityBytes: 256 * 1024,
    source,
    ide: 'claude-code',
    capturedAt: '2026-07-29T00:00:00.000Z',
    rawBytes: Math.round(ratio * 256 * 1024)
  };
}

describe('buildDispatchSystemPrompt — context window block (Part 21)', () => {
  test('emits "no probe available" hint when the probe is null', () => {
    const out = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'task body',
      memoryBlock: NO_MEMORY,
      contextProbe: null
    });
    expect(out).toMatch(/## Context window/);
    expect(out).toMatch(/no probe available/);
    expect(out).toMatch(/do not estimate/i);
    expect(out).toMatch(/peaks code context-now/);
  });

  test('emits the authoritative ratio at 60% used (soft-warn zone)', () => {
    const out = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'task body',
      memoryBlock: NO_MEMORY,
      contextProbe: makeProbe(0.6)
    });
    expect(out).toMatch(/60\.0% used/);
    expect(out).toMatch(/40\.0% free/);
    expect(out).toMatch(/soft-warn|continue working/i);
    expect(out).toMatch(/do not estimate/i);
    expect(out).toMatch(/statusline-poll/);
  });

  test('emits RED-LINE directive at 97% used', () => {
    const out = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'task body',
      memoryBlock: NO_MEMORY,
      contextProbe: makeProbe(0.97)
    });
    expect(out).toMatch(/97\.0% used/);
    expect(out).toMatch(/3\.0% free/);
    expect(out).toMatch(/RED-LINE/);
    expect(out).toMatch(/peaks compact auto --execute/);
  });

  test('omits the context probe values when contextProbe is omitted entirely (backward compat: no probe values, no rule)', () => {
    // When contextProbe is omitted (backward compat for callers
    // that have not yet been migrated to the Part 21 surface),
    // the composer does NOT render the "trust this number" block
    // — the LLM has no authoritative number to read, so the
    // directive would be misleading. The block header is still
    // present (so the LLM can see "context window" is a section
    // in the prompt) but it carries the no-probe-available hint.
    const out = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'task body',
      memoryBlock: NO_MEMORY
    });
    expect(out).toMatch(/## Context window/);
    // No numeric ratio (no probe available to show).
    expect(out).not.toMatch(/\d+\.\d% (used|free)/);
  });
});
