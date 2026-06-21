/**
 * End-to-end: buildContext on a fixture repo → context.json has expected shape,
 * sha256 is stable, retry produces same hash (with mocked clock).
 *
 * buildContext carries 4+ time-derived fields:
 *   - generatedAt (top-level)
 *   - fetchedAt (per fetched doc)
 *   - renderedAt (renderer)
 *   - timeDecayScore (tokenizer metadata, derived from fetchedAt)
 * Stripping volatile fields is fragile (round 3 caught timeDecayScore drift).
 * Mocking the clock via vi.useFakeTimers freezes all derived values.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../../../src/services/context/context-builder.js';

describe('end-to-end buildContext', () => {
  beforeEach(() => {
    // Freeze time at a fixed point so all time-derived fields match across runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces a stable context.json across two runs (with mocked clock)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-e2e-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), 'export const X = 1;\n');
      writeFileSync(join(workdir, 'package.json'), JSON.stringify({
        name: 'demo', dependencies: { antd: '5.21.0' },
      }));
      writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

      const out = join(workdir, 'ctx.json');
      const fetcher = async () => ({ version: '5.21.0', excerpt: 'Form.Item' });

      const ctx1 = await buildContext({
        goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
        docBudgetTokens: 8000, out, fetcher,
      });
      const ctx2 = await buildContext({
        goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
        docBudgetTokens: 8000, out, fetcher,
      });

      // With mocked clock, ALL fields are deterministic — including sha256.
      expect(ctx1).toEqual(ctx2);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});