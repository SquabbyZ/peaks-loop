import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMutReport } from '../../../src/services/mut/report-builder.js';

const FIXED_NOW = new Date('2026-06-22T12:00:00.000Z');

function fixedNow(): Date {
  return new Date(FIXED_NOW.getTime());
}

describe('buildMutReport', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces mut-report.json with valid sha256 + chains to inputSig', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-rb-'));
    try {
      const out = join(workdir, 'mut.json');
      const result = await buildMutReport({
        inputSig: 'a'.repeat(64),
        out,
        now: fixedNow,
        mutation: {
          tool: 'stryker',
          mutantsTotal: 100,
          mutantsKilled: 85,
          mutantsSurvived: 15,
          mutantsTimeout: 0,
          killRate: 0.85,
          byFile: [],
        },
        assertions: {
          totalAssertions: 100,
          weakAssertions: 3,
          weakRate: 0.03,
          weakPatterns: [],
        },
      });

      expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(result.inputSig).toBe('a'.repeat(64));
      expect(result.thresholds.passed).toBe(true);
      expect(result.generatedAt).toBe(FIXED_NOW.toISOString());

      const onDisk = JSON.parse(readFileSync(out, 'utf8'));
      expect(onDisk.sha256).toBe(result.sha256);
      expect(onDisk.inputSig).toBe('a'.repeat(64));
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('marks thresholds.passed=false when below bounds + emits followups', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-rb2-'));
    try {
      const result = await buildMutReport({
        inputSig: 'a'.repeat(64),
        out: join(workdir, 'mut.json'),
        now: fixedNow,
        mutation: {
          tool: 'stryker',
          mutantsTotal: 100,
          mutantsKilled: 60,
          mutantsSurvived: 40,
          mutantsTimeout: 0,
          killRate: 0.60,
          byFile: [
            { file: 'src/A.ts', killRate: 0.60, survived: [] },
          ],
        },
        assertions: {
          totalAssertions: 100,
          weakAssertions: 12,
          weakRate: 0.12,
          weakPatterns: [
            {
              pattern: 'toBeDefined',
              count: 12,
              examples: [
                {
                  file: 'src/A.test.ts',
                  line: 5,
                  code: 'expect(x).toBeDefined()',
                },
              ],
            },
          ],
        },
      });

      expect(result.thresholds.passed).toBe(false);
      expect(result.followups.length).toBeGreaterThan(0);
      expect(result.followups.some((f) => f.issue === 'low_kill_rate')).toBe(true);
      expect(
        result.followups.some((f) => f.issue === 'high_weak_assertions'),
      ).toBe(true);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('MUT.sig is deterministic across two builds with identical inputs', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-rb3-'));
    try {
      const input = {
        inputSig: 'b'.repeat(64),
        now: fixedNow,
        mutation: {
          tool: 'stryker' as const,
          mutantsTotal: 10,
          mutantsKilled: 9,
          mutantsSurvived: 1,
          mutantsTimeout: 0,
          killRate: 0.9,
          byFile: [
            { file: 'src/B.ts', killRate: 0.9, survived: [] },
          ],
        },
        assertions: {
          totalAssertions: 10,
          weakAssertions: 0,
          weakRate: 0,
          weakPatterns: [],
        },
      };
      const a = await buildMutReport({ ...input, out: join(workdir, 'a.json') });
      const b = await buildMutReport({ ...input, out: join(workdir, 'b.json') });
      expect(a.sha256).toBe(b.sha256);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('MUT.sig changes when inputSig changes (chain integrity)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-rb4-'));
    try {
      const baseInput = {
        now: fixedNow,
        mutation: {
          tool: 'stryker' as const,
          mutantsTotal: 10,
          mutantsKilled: 9,
          mutantsSurvived: 1,
          mutantsTimeout: 0,
          killRate: 0.9,
          byFile: [],
        },
        assertions: {
          totalAssertions: 10,
          weakAssertions: 0,
          weakRate: 0,
          weakPatterns: [],
        },
      };
      const a = await buildMutReport({
        ...baseInput,
        inputSig: 'a'.repeat(64),
        out: join(workdir, 'a.json'),
      });
      const b = await buildMutReport({
        ...baseInput,
        inputSig: 'c'.repeat(64),
        out: join(workdir, 'b.json'),
      });
      expect(a.sha256).not.toBe(b.sha256);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it('MUT.sig is independent of generatedAt (timestamp drift does not change sig)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-rb5-'));
    try {
      const otherNow = new Date('2026-06-22T13:30:00.000Z');
      const baseArgs = {
        inputSig: 'd'.repeat(64),
        mutation: {
          tool: 'stryker' as const,
          mutantsTotal: 10,
          mutantsKilled: 9,
          mutantsSurvived: 1,
          mutantsTimeout: 0,
          killRate: 0.9,
          byFile: [],
        },
        assertions: {
          totalAssertions: 10,
          weakAssertions: 0,
          weakRate: 0,
          weakPatterns: [],
        },
      };
      const a = await buildMutReport({
        ...baseArgs,
        out: join(workdir, 'a.json'),
        now: fixedNow,
      });
      const b = await buildMutReport({
        ...baseArgs,
        out: join(workdir, 'b.json'),
        now: () => otherNow,
      });
      expect(a.sha256).toBe(b.sha256);
      expect(a.generatedAt).not.toBe(b.generatedAt);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});