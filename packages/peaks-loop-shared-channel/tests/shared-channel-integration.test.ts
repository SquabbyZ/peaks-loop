// packages/peaks-loop-shared-channel/tests/shared-channel-integration.test.ts
//
// Integration dimension of the shared-channel public surface — split from
// `shared-channel.test.ts` to bring that file under the 300-line raw cap for
// `packages/*/tests`. The `describe` body, its cases, its order and its temp-dir
// hooks are moved VERBATIM; nothing is rewritten. `writeSharedEntry` and
// `readSharedChannel` are the only production symbols this file reaches.
//
// `declareDimensions` is inlined again here for the same reason the parent file
// inlines it (the workspace-package vitest config does not inherit the root
// `~` alias), and this file carries its OWN call with its OWN path so the
// 4-dimension contract covers both files.

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  'packages/peaks-loop-shared-channel/tests/shared-channel-integration.test.ts',
  ['integration'],
  [
    { dim: 'render', reason: 'constants + path composition are covered by shared-channel.test.ts' },
    {
      dim: 'behavior',
      reason:
        'compileKeyPattern + writeSharedEntry validation are covered by shared-channel.test.ts'
    },
    { dim: 'a11y', reason: 'no user-facing text or exit code' }
  ]
);

import { readSharedChannel, writeSharedEntry } from '../src/shared-channel.js';

describe('integration — writeSharedEntry + readSharedChannel round-trip', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = join(process.cwd(), '.tmp-shared-channel-' + Math.random().toString(36).slice(2, 8));
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it('writes a single entry and reads it back', () => {
    const w = writeSharedEntry({
      projectRoot: tmpRoot,
      sid: 's1',
      rid: 'r1',
      batchId: 'b1',
      key: 'rd.completed',
      from: 'rd',
      value: { result: 'success' }
    });
    expect(w.ok).toBe(true);
    if (w.ok) {
      expect(w.lastWriteWins).toBe(false);
      expect(w.softWarning).toBe(false);
    }
    const r = readSharedChannel({ projectRoot: tmpRoot, sid: 's1', rid: 'r1', batchId: 'b1' });
    expect(r.entries['rd.completed']?.value).toEqual({ result: 'success' });
  });

  it('flags lastWriteWins=true when overwriting an existing key', () => {
    writeSharedEntry({
      projectRoot: tmpRoot,
      sid: 's',
      rid: 'r',
      batchId: 'b',
      key: 'k',
      from: 'a',
      value: { v: 1 }
    });
    const w = writeSharedEntry({
      projectRoot: tmpRoot,
      sid: 's',
      rid: 'r',
      batchId: 'b',
      key: 'k',
      from: 'b',
      value: { v: 2 }
    });
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.lastWriteWins).toBe(true);
    const r = readSharedChannel({ projectRoot: tmpRoot, sid: 's', rid: 'r', batchId: 'b' });
    expect(r.entries['k']?.value).toEqual({ v: 2 });
    expect(r.entries['k']?.from).toBe('b');
  });

  it('flags softWarning=true when value > 1KB but < 64KB', () => {
    const big = 'x'.repeat(2000); // 2KB stringified
    const w = writeSharedEntry({
      projectRoot: tmpRoot,
      sid: 's',
      rid: 'r',
      batchId: 'b',
      key: 'k',
      from: 'a',
      value: { payload: big }
    });
    expect(w.ok).toBe(true);
    if (w.ok) expect(w.softWarning).toBe(true);
  });

  it('rejects a value at or above the 64KB hard limit', () => {
    // Build a value that JSON.stringify produces >= 65536 bytes.
    // The value itself is a single big string field.
    const huge = 'x'.repeat(70_000);
    const w = writeSharedEntry({
      projectRoot: tmpRoot,
      sid: 's',
      rid: 'r',
      batchId: 'b',
      key: 'k',
      from: 'a',
      value: { payload: huge }
    });
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.code).toBe('VALUE_TOO_LARGE');
  });

  it('readSharedChannel returns an empty channel for a never-written batch', () => {
    const r = readSharedChannel({ projectRoot: tmpRoot, sid: 's', rid: 'r', batchId: 'never' });
    expect(Object.keys(r.entries)).toEqual([]);
  });

  it('5 concurrent writes to the same channel do not lose entries', async () => {
    const N = 5;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        Promise.resolve().then(() =>
          writeSharedEntry({
            projectRoot: tmpRoot,
            sid: 's',
            rid: 'r',
            batchId: 'b',
            key: `k-${i}`,
            from: `from-${i}`,
            value: { i }
          })
        )
      )
    );
    const r = readSharedChannel({ projectRoot: tmpRoot, sid: 's', rid: 'r', batchId: 'b' });
    expect(Object.keys(r.entries).sort()).toEqual(['k-0', 'k-1', 'k-2', 'k-3', 'k-4']);
    for (let i = 0; i < N; i++) {
      expect(r.entries[`k-${i}`]?.value).toEqual({ i });
    }
  });
});
