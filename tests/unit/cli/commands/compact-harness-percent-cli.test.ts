// tests/unit/cli/commands/compact-harness-percent-cli.test.ts
//
// The PERCENT half of `peaks compact harness-window`, at the CLI surface.
//
// WHY A FILE OF ITS OWN. `compact-harness-window.test.ts` sits at the 500-line
// tests cap, and the percent half's arms are about a DIFFERENT knob from the
// window's: `--reset`/`--reenable` must cover BOTH keys, and the envelope has to
// report the percent's ownership (none / human / peaks) so a rolled-back project
// cannot be mistaken for a fresh one. Dividing the two keeps each file under the
// cap without dropping an assertion — the same posture `scope-shadow-coverage`
// took out of `file-size-cap.test.ts`.
//
// These tests drive the REAL registered CLI command against a tmp workspace (no
// child process, no network) and assert on the JSON envelope plus the bytes on
// disk, because the rollback is only a rollback if it survives the next probe.
//
// Dimensions covered:
//   - render:      the envelope's `percent` block and the nextActions wording
//   - behavior:    reset / reenable transitions over the pair
//   - integration: the adapter-declared settings path is what gets rewritten
//   - a11y:        the sentences never ask the user a question

import { lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { registerCompactCommands } from '../../../../src/cli/commands/compact-command.js';
import { ensureHarnessCompactThreshold } from '../../../../src/services/context/harness-compact-threshold-ensure.js';

declareDimensions('tests/unit/cli/commands/compact-harness-percent-cli.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';
const SETTINGS_REL = join('.claude', 'settings.local.json');

interface Envelope {
  readonly ok: boolean;
  readonly data: Record<string, unknown>;
  readonly nextActions: readonly string[];
}

describe('peaks compact harness-window — the percent half', () => {
  const ws = withTmpWorkspacePerTest('peaks-harness-percent-cli-');

  afterEach(() => {
    process.exitCode = undefined;
  });

  async function run(args: readonly string[]): Promise<Envelope> {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerCompactCommands(program, io);
    await program.parseAsync(['compact', 'harness-window', '--json', ...args], { from: 'user' });
    return JSON.parse(captured.text()) as Envelope;
  }

  function settingsPath(): string {
    return join(ws().path, SETTINGS_REL);
  }

  function writeSettings(env: Record<string, unknown>): void {
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(settingsPath(), `${JSON.stringify({ env }, null, 2)}\n`, 'utf8');
  }

  function envBlock(): Record<string, unknown> {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      env?: Record<string, unknown>;
    };
    return parsed['env'] ?? {};
  }

  /** Configure the pair the way `init` does, so a rollback has something to undo. */
  function configurePair(): void {
    ensureHarnessCompactThreshold({
      location: {
        settingsPath: settingsPath(),
        envVar: KEY,
        percentEnvVar: PERCENT_KEY,
        projectRoot: ws().path
      },
      env: {}
    });
  }

  function neutraliseAmbientEnv(): void {
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    withEnv(PERCENT_KEY, undefined);
  }

  // N4 (QA round 2): reset → reenable left the percent unset with nothing said.
  it('N4: when --reenable follows a reset, should state what happens to EACH knob', async () => {
    // given: a rolled-back project
    // when: management is restored
    // then: the percent stays absent and the operator is told by name
    neutraliseAmbientEnv();
    configurePair();
    await run(['--project', ws().path, '--reset']);
    const envelope = await run(['--project', ws().path, '--reenable']);
    // the percent is still absent (reenable restores no value) and the operator
    // is told so by name, so its later absence is not a mystery
    expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    expect(envBlock()[KEY]).toBeUndefined();
    const percent = envelope.data['percent'] as { key: string; ownership: string } | undefined;
    expect(percent?.key).toBe(PERCENT_KEY);
    expect(percent?.ownership).toBe('none');
    const sentence = envelope.nextActions.join('\n');
    expect(sentence).toContain(PERCENT_KEY);
    expect(sentence).toContain('stays unset');
    expect(sentence).toContain(KEY);
    expect(sentence).not.toContain('?');
  });

  it('N4: when --reenable runs beside a human percent, should report it as NOT managed', async () => {
    // given: a hand-set percent and a recorded opt-out
    // when: management is restored
    // then: the human's value is named and left alone, never claimed
    neutraliseAmbientEnv();
    writeSettings({ [PERCENT_KEY]: '65' });
    await run(['--project', ws().path, '--disable']);
    const envelope = await run(['--project', ws().path, '--reenable']);
    expect(envBlock()[PERCENT_KEY]).toBe('65');
    const percent = envelope.data['percent'] as { ownership: string } | undefined;
    expect(percent?.ownership).toBe('human');
    expect(envelope.nextActions.join('\n')).toContain('does not manage');
  });

  it('N4: when the state is reported right after --reset, should show the percent half and the opt-out', async () => {
    // given: a project peaks-loop configured, then rolled back
    // when: the default state report runs
    // then: it is NOT just "no window is set yet" — the opt-out and the percent
    //       half are both visible, so a rolled-back project cannot be mistaken
    //       for a fresh one
    neutraliseAmbientEnv();
    configurePair();
    await run(['--project', ws().path, '--reset']);
    const envelope = await run(['--project', ws().path]);
    expect(envelope.data['optedOut']).toBe(true);
    const percent = envelope.data['percent'] as { key: string; ownership: string } | undefined;
    expect(percent?.key).toBe(PERCENT_KEY);
    expect(percent?.ownership).toBe('none');
    const report = envelope.nextActions.join('\n');
    expect(report).toContain(PERCENT_KEY);
    expect(report).toContain('not set');
  });

  // R1 (QA finding, HIGH): the documented rollback used to remove the window
  // only. `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` survived, and on a 1M model the
  // harness then compacted at 800,000 instead of 987,000 — the rollback moved
  // the trigger EARLIER while the opt-out claimed peaks-loop managed nothing.
  it('when --reset runs on a project peaks-loop configured, should remove the PERCENT too (R1)', async () => {
    // given: the pair `init` installs — window + percent, each with its marker
    // when: the documented rollback runs
    // then: NEITHER knob survives, the sentence names both, and the envelope
    //       reports the percent half
    neutraliseAmbientEnv();
    configurePair();
    expect(envBlock()[PERCENT_KEY]).toBe('80');
    const envelope = await run(['--project', ws().path, '--reset']);
    expect(envelope.data['action']).toBe('removed');
    expect(envBlock()[KEY]).toBeUndefined();
    expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    expect(envBlock()['PEAKS_HARNESS_WINDOW_WRITTEN']).toBeUndefined();
    expect(envBlock()['PEAKS_HARNESS_PERCENT_WRITTEN']).toBeUndefined();
    expect(envBlock()['PEAKS_HARNESS_WINDOW_SYNC']).toBe('off');
    const sentence = envelope.nextActions.join('\n');
    expect(sentence).toContain(KEY);
    expect(sentence).toContain(PERCENT_KEY);
    expect(sentence).toContain('--reenable');
    const percent = envelope.data['percent'] as { action: string } | undefined;
    expect(percent?.action).toBe('removed');
  });

  it('MED-3: when only the PERCENT is removed, should report the envelope action as removed', async () => {
    // given: a peaks-owned percent whose window was deleted by hand — a
    //        percent-only removal
    // when: the rollback runs
    // then: the TOP-LEVEL action is `removed`, not `absent`. Keying it off
    //       `window.action` alone reported `absent` beside `percent.action:
    //       'removed'`, which a consumer reading only `action` would take as
    //       "nothing was found".
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify(
        { env: { [PERCENT_KEY]: '80', PEAKS_HARNESS_PERCENT_WRITTEN: '80' } },
        null,
        2
      )}\n`,
      'utf8'
    );
    const envelope = await run(['--project', ws().path, '--reset']);
    expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    expect(envelope.data['action']).toBe('removed');
    const percent = envelope.data['percent'] as { action: string; ownership: string };
    expect(percent.action).toBe('removed');
  });

  it('MED-7: when --reset is REFUSED on a linked file, should report no removals', async () => {
    // given: a link to a victim carrying a peaks-owned percent — the rollback
    //        declines to write through the link
    // when: it runs
    // then: the envelope says `refused`, and NEITHER per-knob block claims a
    //       removal — the ownership snapshot is computed from the file whether
    //       or not a write follows, so `percent.action: 'removed'` here would
    //       describe a removal this call did not perform
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    const victim = join(ws().path, 'victim.json');
    writeFileSync(
      victim,
      `${JSON.stringify(
        { env: { [PERCENT_KEY]: '80', PEAKS_HARNESS_PERCENT_WRITTEN: '80' } },
        null,
        2
      )}\n`,
      'utf8'
    );
    try {
      symlinkSync(victim, settingsPath(), 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'UNKNOWN') throw error;
      symlinkSync(victim, settingsPath(), 'junction');
    }
    expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(true);
    const envelope = await run(['--project', ws().path, '--reset']);
    expect(envelope.data['action']).toBe('refused');
    const percent = envelope.data['percent'] as { action: string; ownership: string };
    // a refusal removed nothing, so no knob may claim a removal
    expect(percent.action).not.toBe('removed');
  });

  it('when --reset runs on a HUMAN-set percent, should keep it and say so (R1 control)', async () => {
    // given: a peaks-written window beside a percent the user set by hand
    // when: the rollback runs
    // then: the human's value survives — without this control, a reset that
    //       deleted every percent would pass the case above
    neutraliseAmbientEnv();
    writeSettings({ GATEGUARD_EXEMPT_GLOBS: '.peaks/**', [KEY]: '1000000' });
    const seeded = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      env: Record<string, unknown>;
    };
    seeded.env['PEAKS_HARNESS_WINDOW_WRITTEN'] = '1000000';
    seeded.env[PERCENT_KEY] = '65';
    writeFileSync(settingsPath(), `${JSON.stringify(seeded, null, 2)}\n`, 'utf8');

    const envelope = await run(['--project', ws().path, '--reset']);
    expect(envelope.data['action']).toBe('removed');
    expect(envBlock()[KEY]).toBeUndefined();
    expect(envBlock()[PERCENT_KEY]).toBe('65');
    const percent = envelope.data['percent'] as { action: string } | undefined;
    expect(percent?.action).toBe('kept-human');
    expect(envelope.nextActions.join('\n')).toContain('65');
  });

  it('when --reset runs on a LINKED settings file, should report refused and write nothing (behavior)', async () => {
    // given: `.claude/settings.local.json` is a link (or junction) to a victim
    //        file that carries a peaks pair — the rollback would follow it
    // when: the rollback runs
    // then: the envelope says `refused` (not `absent`, which would read as "found
    //       nothing"), names the reason, and the target is byte-identical
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    const victim = join(ws().path, 'victim.json');
    writeFileSync(
      victim,
      `${JSON.stringify({ env: { [KEY]: '1000000', CLAUDE_WRITTEN: '1000000' } }, null, 2)}\n`,
      'utf8'
    );
    try {
      symlinkSync(victim, settingsPath(), 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'UNKNOWN') throw error;
      symlinkSync(victim, settingsPath(), 'junction');
    }
    expect(lstatSync(settingsPath()).isSymbolicLink()).toBe(true);
    const before = readFileSync(victim, 'utf8');
    const envelope = await run(['--project', ws().path, '--reset']);
    expect(envelope.ok).toBe(true);
    expect(envelope.data['action']).toBe('refused');
    expect(envelope.data['reason']).toBe('symlinked-settings');
    expect(envelope.nextActions.join('\n')).toContain('symlink');
    expect(readFileSync(victim, 'utf8')).toBe(before);
  });

  it('when the same garbage sits in the percent AND its marker, should KEEP it (MED-1)', async () => {
    // given: `eighty` in both rows — the reproduction of the hole where the
    //        "both raws equal ⇒ corrupted peaks write" arm classified a HUMAN's
    //        typo as `peaks-corrupt` and `--reset` deleted their value
    // when: the documented rollback runs
    // then: the value and its marker SURVIVE, the action is `kept-human`, and the
    //       envelope never echoes the file's content
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    withEnv(PERCENT_KEY, undefined);
    writeSettings({ [PERCENT_KEY]: 'eighty', PEAKS_HARNESS_PERCENT_WRITTEN: 'eighty' });
    const envelope = await run(['--project', ws().path, '--reset']);
    // the envelope reports the percent half's action and ownership; the RAW note
    // is not part of the `compact harness-window --reset` envelope (it lives on
    // `percent.previousRawNote` in the service result, not this report)
    const percent = envelope.data['percent'] as {
      action: string;
      ownership: string;
    };
    expect(percent.action).toBe('kept-human');
    expect(percent.ownership).toBe('human');
    expect(envBlock()[PERCENT_KEY]).toBe('eighty');
    expect(envBlock()['PEAKS_HARNESS_PERCENT_WRITTEN']).toBe('eighty');
    expect(JSON.stringify(envelope)).not.toContain('eighty');
  });

  it('when the command help is read, should say --reset and --reenable cover BOTH keys', () => {
    // given: the registered command (what a human reads with --help)
    // when: its description and option help are read
    // then: each verb names the pair, so "reset the window" cannot be mistaken
    //       for a full rollback — the exact misunderstanding R1 measured
    const program = new Command();
    registerCompactCommands(program, makeCapturedIo().io);
    const cmd = program.commands
      .find((c) => c.name() === 'compact')
      ?.commands.find((c) => c.name() === 'harness-window');
    const description = cmd?.description() ?? '';
    expect(description).toContain('BOTH keys');
    expect(description).toContain('percent');
    const resetHelp = cmd?.options.find((o) => o.long === '--reset')?.description ?? '';
    const reenableHelp = cmd?.options.find((o) => o.long === '--reenable')?.description ?? '';
    expect(resetHelp).toContain('percent');
    expect(reenableHelp).toContain('percent');
    expect(description).not.toContain('?');
  });
});
