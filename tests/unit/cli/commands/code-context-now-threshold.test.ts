// tests/unit/cli/commands/code-context-now-threshold.test.ts
//
// `peaks code context-now` must answer "is the harness threshold I configured
// actually in force in THIS session?" — with numbers, not strings.
//
// The harness reads its env once, at process start (measured 2026-11-20), so
// the interesting state is the DISAGREEMENT: the project file says one thing
// and the running session still uses another. Before this field, the only
// place that told a user anything was the file they had just edited — which is
// exactly the pretending the slice removes.
//
// These tests drive the REAL registered command over a real settings file, and
// pin BOTH directions of the disagreement (session stale, file stale) plus the
// agreeing control, so `matches: false` cannot be produced by a broken reader.
//
// Dimensions covered:
//   - render:      the `harnessThreshold` envelope field + its shape
//   - behavior:    matches=true / false in both directions, restart hint
//   - integration: real `.claude/settings.local.json` read by the real command
//   - a11y:        the restart line is a statement, not a question, and names
//                  both pairs so a human can act on it

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { registerCodeRuntimeCommands } from '~/src/cli/commands/code-runtime-commands';

declareDimensions('tests/unit/cli/commands/code-context-now-threshold.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const WINDOW_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';
const RATIO_ENV = 'CLAUDE_CONTEXT_USAGE_PERCENT';
const SID = '2026-11-20-session-threshold';

type ThresholdField = {
  readonly windowTokens: number | null;
  readonly percent: number | null;
  readonly configured: { windowTokens: number | null; percent: number | null };
  readonly inForce: { windowTokens: number | null; percent: number | null };
  readonly matches: boolean;
};

interface Envelope {
  readonly ok: boolean;
  readonly data: {
    readonly ratio: number;
    readonly action: string;
    readonly harnessThreshold?: ThresholdField;
  };
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

describe('peaks code context-now — harness threshold verdict', () => {
  const ws = withTmpWorkspacePerTest('peaks-ctx-now-threshold-');

  afterEach(() => {
    process.exitCode = undefined;
  });

  function settingsPath(): string {
    return join(ws().path, '.claude', 'settings.local.json');
  }

  /** File the project configures. The SESSION env is set per case below. */
  function seedConfigured(window: string, percent: string): void {
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify({ env: { [WINDOW_KEY]: window, [PERCENT_KEY]: percent } }, null, 2)}\n`,
      'utf8'
    );
  }

  /** Everything the probe reads, cleared of this host's ambient values. */
  function neutraliseAmbientEnv(): void {
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(RATIO_ENV, '0.40');
    withEnv(WINDOW_KEY, undefined);
    withEnv(PERCENT_KEY, undefined);
  }

  /** The threshold field, or a loud failure — it is the subject of every case. */
  function thresholdOf(envelope: Envelope): ThresholdField {
    const field = envelope.data.harnessThreshold;
    if (field === undefined) throw new Error('harnessThreshold missing from the envelope');
    return field;
  }

  async function runContextNow(): Promise<Envelope> {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    const code = program.command('code');
    registerCodeRuntimeCommands(code, io);
    await program.parseAsync(
      ['code', 'context-now', '--json', '--project', ws().path, '--session-id', SID],
      { from: 'user' }
    );
    return JSON.parse(captured.text()) as Envelope;
  }

  it('when the session env agrees with the project file, should report matches=true and no restart hint', async () => {
    // given: a project configured 250000 × 80 and a session that captured it
    // when: the probe runs
    // then: the field is present, reports the configured pair, and matches
    neutraliseAmbientEnv();
    seedConfigured('250000', '80');
    withEnv(WINDOW_KEY, '250000');
    withEnv(PERCENT_KEY, '80');
    const envelope = await runContextNow();
    const field = thresholdOf(envelope);
    expect(field.windowTokens).toBe(250_000);
    expect(field.percent).toBe(80);
    expect(field.matches).toBe(true);
    expect(envelope.nextActions.join('\n')).not.toContain('NOT in force');
  });

  it('when the SESSION is stale, should report matches=false and the restart', async () => {
    // given: the file now configures 250000 × 80 while this session still runs
    //        the 1M window it captured at start — the ordinary post-edit state
    // when: the probe runs
    // then: it says so, with both pairs, and names the restart
    neutraliseAmbientEnv();
    seedConfigured('250000', '80');
    withEnv(WINDOW_KEY, '1000000');
    const envelope = await runContextNow();
    const field = thresholdOf(envelope);
    expect(field.matches).toBe(false);
    expect(field.configured).toEqual({ windowTokens: 250_000, percent: 80 });
    expect(field.inForce.windowTokens).toBe(1_000_000);
    const hint = envelope.nextActions.find((line) => line.includes('NOT in force')) ?? '';
    expect(hint).toContain('250000 tokens × 80%');
    expect(hint).toContain('1000000 tokens × unset%');
    expect(hint).toContain('Restart');
    // and: it is a statement, never a question
    expect(hint).not.toContain('?');
  });

  it('when the FILE is stale, should report matches=false in the other direction', async () => {
    // given: the file still says 250000 × 80 while the session runs 1M × 60
    // when: the probe runs
    // then: the same false verdict, with the pairs swapped
    neutraliseAmbientEnv();
    seedConfigured('250000', '80');
    withEnv(WINDOW_KEY, '1000000');
    withEnv(PERCENT_KEY, '60');
    const field = thresholdOf(await runContextNow());
    expect(field.matches).toBe(false);
    expect(field.configured).toEqual({ windowTokens: 250_000, percent: 80 });
    expect(field.inForce).toEqual({ windowTokens: 1_000_000, percent: 60 });
  });

  it('when nothing is configured on disk, should report matches=true rather than a fake disagreement', async () => {
    // given: no keys in the project file — a session env alone is an outer
    //        layer, not a disagreement to report
    // when: the probe runs
    // then: nothing on disk to apply, so nothing is "not in force"
    neutraliseAmbientEnv();
    const envelope = await runContextNow();
    const field = thresholdOf(envelope);
    expect(field.configured).toEqual({ windowTokens: null, percent: null });
    expect(field.matches).toBe(true);
    expect(envelope.nextActions.join('\n')).not.toContain('NOT in force');
  });

  it('when the threshold disagrees, should never move the compact decision', async () => {
    // given: the same ratio under a disagreeing and an agreeing configuration
    // when: both probes run
    // then: action and ratio are identical — the field reports, it does not decide
    neutraliseAmbientEnv();
    seedConfigured('250000', '80');
    withEnv(WINDOW_KEY, '1000000');
    const disagreeing = await runContextNow();
    withEnv(WINDOW_KEY, '250000');
    withEnv(PERCENT_KEY, '80');
    const agreeing = await runContextNow();
    expect(disagreeing.data.action).toBe(agreeing.data.action);
    expect(disagreeing.data.ratio).toBe(agreeing.data.ratio);
    // and: the two runs really are the two states, so the equality is not vacuous
    expect(thresholdOf(disagreeing).matches).toBe(false);
    expect(thresholdOf(agreeing).matches).toBe(true);
  });
});
