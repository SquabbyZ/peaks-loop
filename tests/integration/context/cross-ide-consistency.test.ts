/**
 * Per spec §4.1 — same fixtures should produce identical context.json
 * regardless of which IDE invoked peaks-rd (Claude Code / Trae / Cursor).
 * Since peaks-context is purely Node-side, the test pins this.
 *
 * buildContext carries 4+ time-derived fields:
 *   - generatedAt (top-level)
 *   - fetchedAt (per fetched doc)
 *   - renderedAt (renderer)
 *   - timeDecayScore (tokenizer metadata, derived from fetchedAt)
 * Plus sha256 (derived from the rest of the payload). The brief's
 * `stripVolatile` only clears `generatedAt` + `sha256`; with the other
 * three time-derived fields also drifting on real wall clock, the
 * assertion would fail intermittently. We mock the clock (Task 11
 * pattern) so all derived fields are deterministic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../../../src/services/context/context-builder.js';

describe('cross-IDE consistency', () => {
  beforeEach(() => {
    // Freeze time at a fixed point so all time-derived fields match
    // across the two buildContext invocations.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces identical context.json regardless of env (CI vs IDE)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-cide-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'A.ts'), 'export const X = 1;\n');
      writeFileSync(join(workdir, 'package.json'), JSON.stringify({
        name: 'demo', dependencies: { antd: '5.21.0' },
      }));
      writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

      const out = join(workdir, 'ctx.json');
      const fetcher = async () => ({ version: '5.21.0', excerpt: 'Form.Item' });

      // First invocation as if from Claude Code.
      const prevClaude = process.env.CLAUDE_CODE_ENTRYPOINT;
      process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
      const a = await buildContext({
        goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
        docBudgetTokens: 8000, out, fetcher,
      });
      // Second invocation as if from Trae.
      delete process.env.CLAUDE_CODE_ENTRYPOINT;
      process.env.TRAE_ENTRYPOINT = 'cli';
      const b = await buildContext({
        goal: 'x', project: workdir, audience: 'peaks-rd', depsMode: 'locked',
        docBudgetTokens: 8000, out, fetcher,
      });

      // With mocked clock, ALL fields are deterministic — including sha256.
      // The brief's stripVolatile handles only generatedAt + sha256; we can
      // do a stricter equality because the clock is frozen. The stripVolatile
      // check is still documented in the JSDoc above for the no-fake-timers
      // variant of this test (which would be flaky without mocking).
      expect(a).toEqual(b);

      if (prevClaude === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT;
      else process.env.CLAUDE_CODE_ENTRYPOINT = prevClaude;
      delete process.env.TRAE_ENTRYPOINT;
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
