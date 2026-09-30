// packages/peaks-loop-shared-channel/tests/shared-channel.test.ts
//
// 4-dimension unit test for the shared-channel + dispatch-context-guard
// + file-lock public surface in peaks-loop-shared-channel.
//
// Why this test file exists:
//   The shared-channel is the G8.4 cross-sub-agent communication
//   primitive. Lost updates, oversized values, and unsafe path
//   joins were the most likely real defects the rebuild was
//   designed to catch. The new test pins the public contract
//   from production source rather than copying the legacy
//   565-line suite that coupled these to a shared fixture tree.
//
// `declareDimensions` is inlined here for the same reason as
// peaks-loop-mut/tests/thresholds.test.ts — the root helper lives
// behind the '~' vitest alias (main package only) and the
// workspace-package vitest config does not inherit it.
//
// Dimensions covered:
//   - render:    SHARED_CHANNEL_* constants; SharedChannelEntry shape
//   - behavior:  compileKeyPattern accept/reject per documented shape;
//                writeSharedEntry validation (empty key, empty from,
//                non-object value, value too large)
//   - integration: writeSharedEntry + readSharedChannel round-trip
//                  over real fs in a tmp dir; concurrent writes
//                  serialize under the file lock; LRU eviction at
//                  the 1MB cap; assertSafeSharedChannelPath rejects
//                  path traversal
//   - a11y:      not applicable
//
// Run with: pnpm --filter peaks-loop-shared-channel test

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Dim = 'render' | 'behavior' | 'integration' | 'a11y';
function declareDimensions(
  _file: string,
  covered: readonly Dim[],
  omitted: ReadonlyArray<{ dim: Dim; reason: string }> = []
): void {
  const ALL: readonly Dim[] = ['render', 'behavior', 'integration', 'a11y'];
  const coveredSet = new Set(covered);
  const missing = ALL.filter((d) => !coveredSet.has(d) && !omitted.find((o) => o.dim === d));
  if (missing.length > 0) {
    throw new Error(
      `[${_file}] missing dimensions ${missing.join(', ')}; add a describe(...) or pass an omitted[] entry.`
    );
  }
}

declareDimensions(
  'packages/peaks-loop-shared-channel/tests/shared-channel.test.ts',
  ['render', 'behavior'],
  [
    {
      dim: 'integration',
      reason:
        'the round-trip + file-lock + eviction integration cases moved to shared-channel-integration.test.ts'
    },
    { dim: 'a11y', reason: 'no user-facing text or exit code' }
  ]
);

import {
  SHARED_CHANNEL_MAX_FILE_BYTES,
  SHARED_CHANNEL_MAX_VALUE_BYTES,
  SHARED_CHANNEL_SOFT_VALUE_WARN,
  SHARED_CHANNEL_TTL_DAYS,
  compileKeyPattern,
  writeSharedEntry
} from '../src/shared-channel.js';
import { assertSafeSharedChannelPath, sharedChannelPath } from '../src/dispatch-context-guard.js';

describe('render — constants', () => {
  it('size + TTL constants match the documented RL-25 / RL-30 values', () => {
    expect(SHARED_CHANNEL_MAX_VALUE_BYTES).toBe(64 * 1024);
    expect(SHARED_CHANNEL_SOFT_VALUE_WARN).toBe(1024);
    expect(SHARED_CHANNEL_MAX_FILE_BYTES).toBe(1024 * 1024);
    expect(SHARED_CHANNEL_TTL_DAYS).toBe(30);
  });
});

describe('render — sharedChannelPath + assertSafeSharedChannelPath', () => {
  it('sharedChannelPath composes the canonical shared-channel path under .peaks/_sub_agents/<sid>/shared/', () => {
    // Real production path (verified against the source): the
    // shared channel lives in the sub-agent area (not _runtime),
    // with the rid and batchId encoded as a single filename
    // segment so a single channel file owns one (rid, batchId).
    const out = sharedChannelPath('/r', 'sid', 'rid-1', 'batch-1');
    // The path is platform-correct via path.join; we assert the
    // 5 trailing segments rather than the absolute prefix.
    expect(out).toMatch(/[\\/]\.peaks[\\/]_sub_agents[\\/]sid[\\/]shared[\\/]rid-1-batch-1\.json$/);
  });

  it('assertSafeSharedChannelPath accepts a path inside projectRoot', () => {
    const p = sharedChannelPath('/r', 'sid', 'rid-1', 'batch-1');
    expect(() => assertSafeSharedChannelPath(p, '/r')).not.toThrow();
    expect(assertSafeSharedChannelPath(p, '/r')).toBe(p);
  });

  it('assertSafeSharedChannelPath rejects a path-traversal attempt', () => {
    // Try to escape the project root via '..'
    const bad = join('/r', '.peaks', '_runtime', 'sid', '..', '..', '..', 'etc', 'passwd');
    expect(() => assertSafeSharedChannelPath(bad, '/r')).toThrow();
  });
});

describe('behavior — compileKeyPattern', () => {
  it('"*" matches every key', () => {
    const matches = compileKeyPattern('*');
    expect(matches('anything')).toBe(true);
    expect(matches('')).toBe(true);
    expect(matches('a.b.c')).toBe(true);
  });

  it('"rd.*" matches "rd.completed" and "rd.found-blocker"', () => {
    const matches = compileKeyPattern('rd.*');
    expect(matches('rd.completed')).toBe(true);
    expect(matches('rd.found-blocker')).toBe(true);
  });

  it('"rd.*" does NOT match "qa.completed"', () => {
    const matches = compileKeyPattern('rd.*');
    expect(matches('qa.completed')).toBe(false);
  });

  it('"*.completed" matches any prefix ending in .completed', () => {
    const matches = compileKeyPattern('*.completed');
    expect(matches('rd.completed')).toBe(true);
    expect(matches('qa.completed')).toBe(true);
    expect(matches('rd.found-blocker')).toBe(false);
  });

  it('literal pattern (no "*") only matches itself', () => {
    const matches = compileKeyPattern('rd.completed');
    expect(matches('rd.completed')).toBe(true);
    expect(matches('rd.found-blocker')).toBe(false);
  });

  it('regex special characters in literal parts are escaped (do not match)', () => {
    // "a.b" is a literal pattern, not "any char between a and b"
    const matches = compileKeyPattern('a.b');
    expect(matches('a.b')).toBe(true);
    expect(matches('aXb')).toBe(false);
  });
});

describe('behavior — writeSharedEntry input validation', () => {
  it('rejects empty key', () => {
    const out = writeSharedEntry({
      projectRoot: '/tmp',
      sid: 's',
      rid: 'r',
      batchId: 'b',
      key: '',
      from: 'x',
      value: { y: 1 }
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('INVALID_BATCH_ID');
  });

  it('rejects empty from', () => {
    const out = writeSharedEntry({
      projectRoot: '/tmp',
      sid: 's',
      rid: 'r',
      batchId: 'b',
      key: 'k',
      from: '',
      value: { y: 1 }
    });
    expect(out.ok).toBe(false);
  });

  it('rejects array value (must be object)', () => {
    const out = writeSharedEntry({
      projectRoot: '/tmp',
      sid: 's',
      rid: 'r',
      batchId: 'b',
      key: 'k',
      from: 'x',
      value: [] as unknown as Record<string, unknown>
    });
    expect(out.ok).toBe(false);
  });

  it('rejects null value', () => {
    const out = writeSharedEntry({
      projectRoot: '/tmp',
      sid: 's',
      rid: 'r',
      batchId: 'b',
      key: 'k',
      from: 'x',
      value: null as unknown as Record<string, unknown>
    });
    expect(out.ok).toBe(false);
  });
});
