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
//   - env-first model window resolution: resolveClaudeModelFromEnv reads the
//     running model id from the Claude Code env var family (documented
//     precedence); a `[1M]` env model drives capacityTokens = 1_000_000 even
//     when the transcript message.model drops the suffix; empty env falls
//     back to the transcript model.
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

import {
  CLAUDE_CODE_ADAPTER,
  CONTEXT_WINDOW_TOKENS_ENV_VAR,
  modelContextWindowTokens,
  parseContextWindowOverride,
  resolveClaudeModelFromEnv,
  resolveContextWindow,
} from '~/src/services/ide/adapters/claude-code-adapter';

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

  it('when env ANTHROPIC_MODEL carries a [1M] suffix but the transcript model drops it, should use the 1M window env-first', () => {
    // given: a transcript whose message.model is the suffix-less id, and env ANTHROPIC_MODEL=<model>[1M]
    // when: the transcript fallback runs with that env
    // then: capacityTokens is 1_000_000 (env-first), not the 200_000 the transcript model alone would imply
    writeTranscript(outer, [
      usageLine('deepseek-v4-flash', { input_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const probe = fallback()({
      projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer,
      env: { ANTHROPIC_MODEL: 'deepseek-v4-flash[1M]' }
    });
    expect(probe).not.toBeNull();
    expect(probe!.source).toBe('transcript-estimate');
    expect(probe!.capacityTokens).toBe(1_000_000);
    expect(probe!.ratio).toBeCloseTo(100_000 / 1_000_000, 5);
  });

  it('when env has no model vars, should fall back to the transcript message.model window', () => {
    // given: a transcript whose message.model is a known 1M allowlist model, and an env with no model vars
    // when: the transcript fallback runs with an empty env map
    // then: the transcript model drives the window (1_000_000), preserving the pre-env behavior
    writeTranscript(outer, [
      usageLine('claude-sonnet-4-5-20250929', { input_tokens: 500_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer, env: {} });
    expect(probe).not.toBeNull();
    expect(probe!.capacityTokens).toBe(1_000_000);
    expect(probe!.ratio).toBeCloseTo(500_000 / 1_000_000, 5);
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

  // Slice 2026-09-09-context-window-override — the user report: a third-party
  // model id with no `[1M]` suffix reports a 5×-inflated ratio because the
  // window silently defaults to 200K. The explicit override + capacitySource
  // make that diagnosable and fixable in one read.
  it('when PEAKS_CONTEXT_WINDOW_TOKENS is set, should use it as the window and tag capacitySource env-override', () => {
    writeTranscript(outer, [
      usageLine('deepseek-v4-flash', { input_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const probe = fallback()({
      projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer,
      env: { PEAKS_CONTEXT_WINDOW_TOKENS: '400000' }
    });
    expect(probe).not.toBeNull();
    expect(probe!.capacityTokens).toBe(400_000);
    expect(probe!.capacitySource).toBe('env-override');
    expect(probe!.ratio).toBeCloseTo(100_000 / 400_000, 5);
  });

  it('when config context.windowTokens is set (env absent), should tag capacitySource config', () => {
    writeTranscript(outer, [
      usageLine('deepseek-v4-flash', { input_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const probe = fallback()({
      projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer,
      env: {}, configWindowTokens: 400_000
    });
    expect(probe!.capacityTokens).toBe(400_000);
    expect(probe!.capacitySource).toBe('config');
    expect(probe!.ratio).toBeCloseTo(0.25, 5);
  });

  it('when no override is set, should tag capacitySource from the winning heuristic layer', () => {
    writeTranscript(outer, [
      usageLine('deepseek-v4-flash[1M]', { input_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const known = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer, env: {} });
    expect(known!.capacitySource).toBe('model-heuristic');

    const unknownOuter = '12e57453-default-source-0000-000000000000';
    writeTranscript(unknownOuter, [
      usageLine('deepseek-v4-flash', { input_tokens: 100_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const unknown = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: unknownOuter, env: {} });
    expect(unknown!.capacitySource).toBe('default');
    expect(unknown!.capacityTokens).toBe(200_000);
  });

  it('when an explicit override is in effect, the late 1M rescue must NOT fight it', () => {
    // given: 500K observed tokens (which would trigger the ≥1M rescue) and a
    //        pinned 400K window
    // when: the transcript fallback runs
    // then: the pinned window wins — no silent bump to 1M
    writeTranscript(outer, [
      usageLine('deepseek-v4-flash', { input_tokens: 500_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const probe = fallback()({
      projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer,
      env: { PEAKS_CONTEXT_WINDOW_TOKENS: '400000' }
    });
    expect(probe!.capacityTokens).toBe(400_000);
    expect(probe!.capacitySource).toBe('env-override');
    expect(probe!.ratio).toBe(1);
  });

  it('regression: the late 1M rescue still fires when the window came from the heuristic/default layer', () => {
    writeTranscript(outer, [
      usageLine('deepseek-v4-flash', { input_tokens: 500_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })
    ]);
    const probe = fallback()({ projectRoot: '/tmp/x', sessionId: 'peaks-sid', outerSessionId: outer, env: {} });
    expect(probe!.capacityTokens).toBe(1_000_000);
    expect(probe!.capacitySource).toBe('default');
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

describe('Scenario: behavior — env-model resolver precedence + [1M] suffix window', () => {
  it('when ANTHROPIC_MODEL is set alongside later candidates, should resolve it first', () => {
    // given: env carries ANTHROPIC_MODEL plus later-precedence candidate vars
    // when: resolveClaudeModelFromEnv runs
    // then: the ANTHROPIC_MODEL value wins (documented precedence #1)
    expect(resolveClaudeModelFromEnv({
      ANTHROPIC_MODEL: 'deepseek-v4-flash[1M]',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5',
      CLAUDE_CODE_SUBAGENT_MODEL: 'claude-haiku-4-5'
    })).toBe('deepseek-v4-flash[1M]');
  });

  it('when ANTHROPIC_MODEL is absent, should resolve the first non-empty default', () => {
    // given: only ANTHROPIC_DEFAULT_SONNET_MODEL is set
    // when: resolveClaudeModelFromEnv runs
    // then: returns the sonnet default id
    expect(resolveClaudeModelFromEnv({
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-5[1M]'
    })).toBe('claude-sonnet-4-5[1M]');
  });

  it('when only CLAUDE_CODE_SUBAGENT_MODEL is set, should resolve it', () => {
    // given: only the sub-agent model var is present
    // when: resolveClaudeModelFromEnv runs
    // then: returns the sub-agent model id
    expect(resolveClaudeModelFromEnv({
      CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash[1M]'
    })).toBe('deepseek-v4-flash[1M]');
  });

  it('when a higher-precedence value is whitespace-only, should skip to the next non-empty candidate', () => {
    // given: ANTHROPIC_MODEL is blank and a later default is a real id
    // when: resolveClaudeModelFromEnv runs
    // then: skips the blank value and resolves the later default
    expect(resolveClaudeModelFromEnv({
      ANTHROPIC_MODEL: '   ',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-4-5-20251001'
    })).toBe('claude-haiku-4-5-20251001');
  });

  it('when env is empty or undefined, should return undefined so the transcript model drives the window', () => {
    // given: no model env vars in an empty map, and an undefined env
    // when: resolveClaudeModelFromEnv runs
    // then: returns undefined for both (transcript fallback path)
    expect(resolveClaudeModelFromEnv({})).toBeUndefined();
    expect(resolveClaudeModelFromEnv(undefined)).toBeUndefined();
  });

  it('when the model id carries an uppercase [1M] suffix marker, modelContextWindowTokens should return 1,000,000', () => {
    // given: a Claude Code model id with the [1M] suffix (e.g. deepseek-v4-flash[1M])
    // when: modelContextWindowTokens runs
    // then: returns the 1M window (matches `1m` case-insensitively)
    expect(modelContextWindowTokens('deepseek-v4-flash[1M]')).toBe(1_000_000);
  });

  it('when the model id is unknown with no suffix and not on the allowlist, should keep the 200K safe default', () => {
    // given: an unknown suffix-less model id that is not an allowlisted 1M model
    // when: modelContextWindowTokens runs
    // then: returns the 200_000 safe default
    expect(modelContextWindowTokens('deepseek-v4-flash')).toBe(200_000);
  });
});

// Slice 2026-09-09-context-window-override — explicit user override above the
// model-name heuristics. The user report: a third-party model id with no
// `[1M]` suffix is stuck at 200K, so `ratio` is inflated up to 5× and the
// probe emits false soft-warn / auto-compact-now verdicts.
describe('Scenario: behavior — explicit context-window override precedence + source', () => {
  const ENV = CONTEXT_WINDOW_TOKENS_ENV_VAR;

  it('when both env and config overrides are set, should let the env override win (env > config)', () => {
    // given: env + config carry different positive integers
    // when: resolveContextWindow runs
    // then: the env value + source 'env-override' win
    const out = resolveContextWindow('deepseek-v4-flash', {
      env: { [ENV]: '800000' },
      configWindowTokens: 500_000
    });
    expect(out.tokens).toBe(800_000);
    expect(out.source).toBe('env-override');
  });

  it('when only the config override is set, should beat the model heuristic (config > heuristic)', () => {
    // given: a model the heuristic would map to 1M, plus a config override of 300K
    // when: resolveContextWindow runs
    // then: the config value wins with source 'config' (explicit beats heuristic)
    const out = resolveContextWindow('deepseek-v4-flash[1M]', { configWindowTokens: 300_000 });
    expect(out.tokens).toBe(300_000);
    expect(out.source).toBe('config');
  });

  it('when no override is set, should report the heuristic source for a known 1M model', () => {
    // given: no env / config override and a `[1M]`-suffixed model id
    // when: resolveContextWindow runs
    // then: source is 'model-heuristic' with the 1M window
    expect(resolveContextWindow('deepseek-v4-flash[1M]', { env: {} })).toEqual({
      tokens: 1_000_000,
      source: 'model-heuristic'
    });
    expect(resolveContextWindow('claude-opus-4-5-20251101', { env: {} }).source).toBe('model-heuristic');
    // regression: the documented allowlist ids still resolve to 1M
    expect(modelContextWindowTokens('claude-opus-4')).toBe(1_000_000);
    expect(modelContextWindowTokens('claude-sonnet-4')).toBe(1_000_000);
  });

  it('when no override is set and the model is unknown, should report source default with 200K', () => {
    // given: no override and an unrecognised suffix-less model id
    // when: resolveContextWindow runs
    // then: source is 'default' with the 200_000 safe default
    expect(resolveContextWindow('deepseek-v4-flash', { env: {} })).toEqual({
      tokens: 200_000,
      source: 'default'
    });
    expect(resolveContextWindow('', { env: {} }).source).toBe('default');
  });

  it('when the env override is invalid (0 / negative / non-numeric / NaN), should warn and fall through', () => {
    // given: invalid env override values and a config override of 400K
    // when: resolveContextWindow runs
    // then: each invalid value is ignored with a warning; config still wins
    for (const bad of ['0', '-1', 'abc', 'NaN', '', '1.5', 'Infinity']) {
      const warnings: string[] = [];
      const out = resolveContextWindow('deepseek-v4-flash', {
        env: { [ENV]: bad },
        configWindowTokens: 400_000,
        onInvalidOverride: (m) => warnings.push(m)
      });
      expect(out).toEqual({ tokens: 400_000, source: 'config' });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(ENV);
    }
  });

  it('when the config override is invalid, should warn and fall through to the heuristic', () => {
    // given: an invalid config override and a `[1M]` model id
    // when: resolveContextWindow runs
    // then: the config value is ignored with a warning; the heuristic wins
    const warnings: string[] = [];
    const out = resolveContextWindow('deepseek-v4-flash[1M]', {
      env: {},
      configWindowTokens: 0,
      onInvalidOverride: (m) => warnings.push(m)
    });
    expect(out).toEqual({ tokens: 1_000_000, source: 'model-heuristic' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('context.windowTokens');
  });

  it('when both overrides are invalid, should warn twice and fall through to the default', () => {
    // given: invalid env AND config overrides
    // when: resolveContextWindow runs
    // then: both are ignored (2 warnings) and the 200K default wins
    const warnings: string[] = [];
    const out = resolveContextWindow('deepseek-v4-flash', {
      env: { [ENV]: 'nope' },
      configWindowTokens: -5,
      onInvalidOverride: (m) => warnings.push(m)
    });
    expect(out).toEqual({ tokens: 200_000, source: 'default' });
    expect(warnings).toHaveLength(2);
  });

  it('when parseContextWindowOverride runs, should accept only positive integers', () => {
    // given: a spread of candidate override values
    // when: parseContextWindowOverride runs
    // then: only positive finite integers (number or numeric string) pass
    expect(parseContextWindowOverride(1_000_000)).toBe(1_000_000);
    expect(parseContextWindowOverride('1000000')).toBe(1_000_000);
    expect(parseContextWindowOverride(' 1000000 ')).toBe(1_000_000);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '', '  ', 'abc', null, undefined, {}, [], true]) {
      expect(parseContextWindowOverride(bad)).toBeNull();
    }
  });
});
