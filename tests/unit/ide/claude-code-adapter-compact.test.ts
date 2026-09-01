// tests/unit/ide/claude-code-adapter-compact.test.ts
//
// 4-dimension unit test for the Claude Code adapter's vendor-specific
// `IdeCompactProfile.readContextPercentFallback` (moved out of the generic
// reader in slice 2026-09-02-vendor-neutral-context-probe). The generic reader
// delegates to this hook; only the adapter knows the Claude-specific paths.
//
// Coverage pinned here:
//   - statusline key parsing (~/.claude/statusline-state.json):
//     contextPercent / context_usage_percent / contextPercentUsed, ÷100 for
//     >1.5, clamp to [0,1], broken JSON → SyntaxError surfaces.
//   - transcript outer-session-id lookup (~/.claude/projects/<hash>/...):
//     recursive (Mac-nested-aware) search, ratio = bytes / 256K.
//   - the session-id-mismatch fix: the transcript is named by the OUTER
//     session id (e.g. `12e57453-...`), NOT the peaks `sessionId` — outer
//     present → found; outer absent → null.
//
// os.homedir is mocked via `vi.mock('node:os')` (the ESM namespace is frozen,
// so a spy is impossible; a full module mock is the accepted workaround, the
// same pattern already used for `node:fs` in the old reader test). node:fs is
// pass-through-mocked so the error-injection cases can override readFileSync /
// readdirSync / existsSync without touching the real homedir.
//
// Dimensions covered:
//   - behavior:    statusline key parsing + error surfacing
//   - integration: real fs read of synthetic `.claude/**` tree under a mocked
//                  homedir (recursive dir layout to mimic Mac truth)
//   - render:      omitted — probe shape asserted inside behavior cases
//   - a11y:        omitted — no human-facing text in the fallback path

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

const __home = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => __home.value };
});

const __fsMocks = vi.hoisted(() => ({
  readdirSync: null as unknown as ((...args: unknown[]) => unknown) | null,
  existsSync: null as unknown as ((...args: unknown[]) => unknown) | null,
  readFileSync: null as unknown as ((...args: unknown[]) => unknown) | null,
  openSync: null as unknown as ((...args: unknown[]) => unknown) | null,
  readSync: null as unknown as ((...args: unknown[]) => unknown) | null,
  closeSync: null as unknown as ((...args: unknown[]) => unknown) | null,
  // Instrumentation for the reverse-scan bounded-read assertion.
  readFileSyncPaths: [] as string[],
  readSyncTotalBytes: 0,
}));
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readdirSync: (...args: unknown[]) => {
      if (__fsMocks.readdirSync) return __fsMocks.readdirSync(...args);
      return (actual.readdirSync as (...a: unknown[]) => unknown)(...args);
    },
    existsSync: (...args: unknown[]) => {
      if (__fsMocks.existsSync) return __fsMocks.existsSync(...args);
      return (actual.existsSync as (...a: unknown[]) => unknown)(...args);
    },
    readFileSync: (...args: unknown[]) => {
      if (__fsMocks.readFileSync) return __fsMocks.readFileSync(...args);
      __fsMocks.readFileSyncPaths.push(String((args as unknown[])[0]));
      return (actual.readFileSync as (...a: unknown[]) => unknown)(...args);
    },
    openSync: (...args: unknown[]) => {
      if (__fsMocks.openSync) return __fsMocks.openSync(...args);
      return (actual.openSync as (...a: unknown[]) => unknown)(...args);
    },
    readSync: (...args: unknown[]) => {
      if (__fsMocks.readSync) return __fsMocks.readSync(...args);
      const n = (actual.readSync as (...a: unknown[]) => unknown)(...args) as number;
      __fsMocks.readSyncTotalBytes += n;
      return n;
    },
    closeSync: (...args: unknown[]) => {
      if (__fsMocks.closeSync) return __fsMocks.closeSync(...args);
      return (actual.closeSync as (...a: unknown[]) => unknown)(...args);
    },
  };
});

declareDimensions(
  'tests/unit/ide/claude-code-adapter-compact.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'adapter fallback returns a probe; shape is asserted inside behavior cases' },
    { dim: 'a11y', reason: 'no human-facing text in the fallback path' },
  ],
);

import { CLAUDE_CODE_ADAPTER } from '~/src/services/ide/adapters/claude-code-adapter';

const fallback = () => CLAUDE_CODE_ADAPTER.compact!.readContextPercentFallback!;

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'peaks-cc-adapter-'));
  __home.value = home;
  __fsMocks.readFileSyncPaths.length = 0;
  __fsMocks.readSyncTotalBytes = 0;
});

afterEach(() => {
  __home.value = '';
  __fsMocks.readdirSync = null;
  __fsMocks.existsSync = null;
  __fsMocks.readFileSync = null;
  __fsMocks.openSync = null;
  __fsMocks.readSync = null;
  __fsMocks.closeSync = null;
  setImmediate(() => {
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });
});

describe('Scenario: behavior — statusline key parsing', () => {
  it('when statusline has contextPercent (0..1), should read it directly', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'statusline-state.json'), JSON.stringify({ contextPercent: 0.42 }), 'utf8');

    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid' });
    expect(probe).not.toBeNull();
    expect(probe!.source).toBe('statusline-poll');
    expect(probe!.ratio).toBeCloseTo(0.42);
    expect(probe!.ide).toBe('claude-code');
  });

  it('when statusline has context_usage_percent (>1.5), should divide by 100', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'statusline-state.json'), JSON.stringify({ context_usage_percent: 72 }), 'utf8');

    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid' });
    expect(probe!.source).toBe('statusline-poll');
    expect(probe!.ratio).toBeCloseTo(0.72);
  });

  it('when statusline has contextPercentUsed, should clamp to [0,1]', () => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'statusline-state.json'), JSON.stringify({ contextPercentUsed: 1.2 }), 'utf8');

    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid' });
    expect(probe!.source).toBe('statusline-poll');
    expect(probe!.ratio).toBe(1);
  });

  it('when statusline JSON is broken, should surface SyntaxError (not swallowed)', () => {
    __fsMocks.existsSync = () => true;
    __fsMocks.readFileSync = () => '{ broken json';
    try {
      expect(() => fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid' })).toThrow(SyntaxError);
    } finally {
      __fsMocks.existsSync = null;
      __fsMocks.readFileSync = null;
    }
  });
});

describe('Scenario: integration — transcript outer-session-id lookup + token ratio', () => {
  const outer = '12e57453-aaaa-bbbb-cccc-ddddeeeeffff';

  /** Write a transcript under the mocked homedir's projects tree. */
  function writeTranscript(outerId: string, lines: string[]): void {
    const hashDir = join(home, '.claude', 'projects', '-Users-foo-bar');
    mkdirSync(hashDir, { recursive: true });
    writeFileSync(join(hashDir, `${outerId}.jsonl`), lines.join('\n') + '\n', 'utf8');
  }

  /** A single jsonl line carrying a `message.usage` + `message.model`. */
  function usageLine(model: string, usage: Record<string, number>): string {
    return JSON.stringify({ type: 'assistant', message: { model, usage } });
  }

  it('when transcript has a usage entry, should return transcript-estimate with token ratio (200K window)', () => {
    // Non-1M model → 200K window; 100K + 50K + 10K = 160K → ratio 0.8
    writeTranscript(outer, [
      usageLine('claude-3-5-sonnet-20241022', { input_tokens: 100_000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 10_000 })
    ]);
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer });
    expect(probe).not.toBeNull();
    expect(probe!.source).toBe('transcript-estimate');
    expect(probe!.ratio).toBeCloseTo(160_000 / 200_000, 5);
    expect(probe!.rawTokens).toBe(160_000);
    expect(probe!.capacityTokens).toBe(200_000);
  });

  it('when transcript exists under a Mac-nested hash dir, should still find + parse it', () => {
    const deep = join(home, '.claude', 'projects', '-Users-foo-bar', 'nested-level');
    mkdirSync(deep, { recursive: true });
    writeFileSync(
      join(deep, `${outer}.jsonl`),
      usageLine('claude-3-5-sonnet-20241022', { input_tokens: 40_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) + '\n',
      'utf8'
    );
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer });
    expect(probe).not.toBeNull();
    expect(probe!.source).toBe('transcript-estimate');
    expect(probe!.ratio).toBeCloseTo(40_000 / 200_000, 5);
  });

  it('should use the LATEST usage entry, not an older one (reverse scan)', () => {
    writeTranscript(outer, [
      usageLine('claude-3-5-sonnet-20241022', { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      usageLine('claude-3-5-sonnet-20241022', { input_tokens: 100_000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 10_000 })
    ]);
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer });
    expect(probe!.rawTokens).toBe(160_000);
    expect(probe!.ratio).toBeCloseTo(0.8, 5);
  });

  it('when model is a known 1M-context model (allowlist), should use 1,000,000 window', () => {
    writeTranscript(outer, [
      usageLine('claude-sonnet-4-5-20250929', { input_tokens: 500_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer });
    expect(probe!.capacityTokens).toBe(1_000_000);
    expect(probe!.ratio).toBeCloseTo(500_000 / 1_000_000, 5);
  });

  it('when model id carries a "1m" suffix, should use 1,000,000 window', () => {
    writeTranscript(outer, [
      usageLine('some-vendor-model-2025-1m', { input_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer });
    expect(probe!.capacityTokens).toBe(1_000_000);
    expect(probe!.ratio).toBeCloseTo(100_000 / 1_000_000, 5);
  });

  it('when tokens exceed 200K on an unknown model, should infer a ≥1M window', () => {
    writeTranscript(outer, [
      usageLine('unknown-future-model', { input_tokens: 300_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer });
    expect(probe!.capacityTokens).toBe(1_000_000);
    expect(probe!.ratio).toBeCloseTo(300_000 / 1_000_000, 5);
  });

  it('should clamp ratio to 1 when tokens exceed even the 1M window', () => {
    writeTranscript(outer, [
      usageLine('claude-sonnet-4-5-20250929', { input_tokens: 1_500_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer });
    expect(probe!.ratio).toBe(1);
  });

  it('when no entry carries a numeric message.usage, should return null (conservative)', () => {
    const noUsage = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hello' } });
    writeTranscript(outer, [noUsage, noUsage]);
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer });
    expect(probe).toBeNull();
  });

  it('when usage fields are non-numeric, should return null (conservative)', () => {
    writeTranscript(outer, [
      JSON.stringify({ type: 'assistant', message: { model: 'claude-3-5-sonnet-20241022', usage: { input_tokens: 'a lot', cache_read_input_tokens: null } } })
    ]);
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer });
    expect(probe).toBeNull();
  });

  it('large-file reverse-scan reads only a tail chunk, not the whole file', () => {
    const big = '12e57453-9999-8888-7777-666655554444';
    const hashDir = join(home, '.claude', 'projects', '-Users-large');
    mkdirSync(hashDir, { recursive: true });
    const junkLine = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'x'.repeat(200) } });
    const tailLine = usageLine('claude-3-5-sonnet-20241022', { input_tokens: 100_000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 10_000 });
    const lines: string[] = [];
    for (let i = 0; i < 10_000; i++) lines.push(junkLine);
    lines.push(tailLine);
    writeFileSync(join(hashDir, `${big}.jsonl`), lines.join('\n') + '\n', 'utf8');

    __fsMocks.readFileSyncPaths.length = 0;
    __fsMocks.readSyncTotalBytes = 0;

    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: big });
    expect(probe).not.toBeNull();
    expect(probe!.rawTokens).toBe(160_000);

    // The transcript jsonl was NOT loaded whole via readFileSync.
    const transcriptReads = __fsMocks.readFileSyncPaths.filter((p) => p.endsWith(`${big}.jsonl`));
    expect(transcriptReads).toHaveLength(0);

    // Reverse scan read only a bounded tail (≤ one 64KB chunk), far less than
    // the multi-MB file.
    expect(__fsMocks.readSyncTotalBytes).toBeGreaterThan(0);
    expect(__fsMocks.readSyncTotalBytes).toBeLessThanOrEqual(64 * 1024);
  });

  it('when outerSessionId present, should find the transcript keyed on the OUTER id (not the peaks sid)', () => {
    const outerId = '12e57453-1111-2222-3333-444455556666';
    const peaksSid = '2026-09-01-session-ABCD';
    const hashDir = join(home, '.claude', 'projects', '-Users-bar');
    mkdirSync(hashDir, { recursive: true });
    // Claude names the transcript by the OUTER session UUID.
    writeFileSync(
      join(hashDir, `${outerId}.jsonl`),
      usageLine('claude-3-5-sonnet-20241022', { input_tokens: 10_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }) + '\n',
      'utf8'
    );

    const found = fallback()({ projectRoot: '/tmp/x', sessionId: peaksSid, outerSessionId: outerId });
    expect(found).not.toBeNull();
    expect(found!.source).toBe('transcript-estimate');

    // outerSessionId absent → transcript lookup skipped → null (the mismatch bug:
    // searching by the peaks sid would never match the OUTER-id transcript).
    const missing = fallback()({ projectRoot: '/tmp/x', sessionId: peaksSid });
    expect(missing).toBeNull();
  });

  it('when no matching transcript exists, should return null (caller → conservative-fallback)', () => {
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: '12e57453-absent' });
    expect(probe).toBeNull();
  });

  it('when readdirSync raises ReferenceError, should surface to caller (not swallowed)', () => {
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
    __fsMocks.readdirSync = () => {
      throw new ReferenceError('require is not defined in ES module scope');
    };
    try {
      expect(() => fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: 'outer-1' })).toThrow(ReferenceError);
    } finally {
      __fsMocks.readdirSync = null;
    }
  });
});
