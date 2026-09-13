// tests/unit/cli/commands/compact-harness-window.test.ts
//
// Slice 2026-09-13-auto-compact-trigger-ownership (T1 + T2), CLI surface.
//
// The window peaks-loop divides its context ratio by and the window the
// harness compacts against must be ONE number. `peaks compact harness-window`
// is where a human can SEE and UNDO the write peaks-loop performs on every
// context probe:
//   - default  → report what is in force (key, value, source, opt-out flag)
//   - --reset  → remove the key AND opt the project out
//   - --reenable → clear the opt-out
//
// These tests drive the REAL registered CLI command against a tmp workspace
// (no child process, no network) and assert on the JSON envelope, because the
// rollback path is only a real rollback if it survives the next probe.
//
// Dimensions covered:
//   - render:      envelope fields + action enums + nextActions wording
//   - behavior:    show / reset / reenable transitions, idempotent reset
//   - integration: the adapter-declared settings path is what gets read and
//                  rewritten on disk, with sibling env keys preserved
//   - a11y:        the human-facing nextActions name the rollback command and
//                  never leak a stack trace or a bare verb

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { registerCompactCommands } from '../../../../src/cli/commands/compact-command.js';

declareDimensions(
  'tests/unit/cli/commands/compact-harness-window.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
);

const KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const SETTINGS_REL = join('.claude', 'settings.local.json');

interface Envelope {
  readonly ok: boolean;
  readonly command: string;
  readonly data: Record<string, unknown>;
  readonly nextActions: readonly string[];
}

function parseEnvelope(text: string): Envelope {
  return JSON.parse(text) as Envelope;
}

describe('peaks compact harness-window — show / rollback', () => {
  const ws = withTmpWorkspacePerTest('peaks-harness-window-cli-');

  afterEach(() => {
    process.exitCode = undefined;
  });

  async function run(args: readonly string[]): Promise<Envelope> {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerCompactCommands(program, io);
    await program.parseAsync(['compact', 'harness-window', '--json', ...args], { from: 'user' });
    return parseEnvelope(captured.text());
  }

  function settingsPath(): string {
    return join(ws().path, SETTINGS_REL);
  }

  function writeSettings(env: Record<string, unknown>): void {
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify({ env, hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce' }] }] } }, null, 2)}\n`,
      'utf8',
    );
  }

  function envBlock(): Record<string, unknown> {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as { env?: Record<string, unknown> };
    return parsed['env'] ?? {};
  }

  it('when no window is set, should report managed=true with a null value and name the probe that will set it (render)', async () => {
    // given: a Claude Code session and a project with no window key yet
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    // The dev machine running these tests may itself have the key exported
    // (Claude Code injects the settings `env` block into tool subprocesses),
    // so clear it — otherwise the process env would satisfy the read and the
    // "nothing set yet" case could never be observed.
    withEnv(KEY, undefined);
    const envelope = await run(['--project', ws().path]);
    // when: the command reports
    expect(envelope.ok).toBe(true);
    expect(envelope.data['managed']).toBe(true);
    expect(envelope.data['key']).toBe(KEY);
    expect(envelope.data['tokens']).toBeNull();
    expect(envelope.data['optedOut']).toBe(false);
    // then: the operator is told how it gets set and how to undo it
    expect(envelope.nextActions.join('\n')).toContain('peaks code context-now');
    expect(envelope.nextActions.join('\n')).toContain('peaks compact harness-window --reset');
    expect(envelope.nextActions.join('\n')).not.toMatch(/Error:|at Object\./);
  });

  it('when the window is in force, should report the value and its source (render)', async () => {
    // given: a settings file peaks-loop has already written to
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    writeSettings({ GATEGUARD_EXEMPT_GLOBS: '.peaks/**', [KEY]: '1000000' });
    // when: the command reads it back
    const envelope = await run(['--project', ws().path]);
    // then: value + source + the sibling key are all accounted for
    expect(envelope.data['tokens']).toBe(1_000_000);
    expect(envelope.data['source']).toBe('settings-file');
    expect(envBlock()['GATEGUARD_EXEMPT_GLOBS']).toBe('.peaks/**');
    expect(envelope.nextActions.join('\n')).toContain('1000000 tokens');
  });

  it('when --reset runs, should remove the key, preserve the sibling env key, and opt the project out (integration)', async () => {
    // given: a written window beside a third-party env key and a hook
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    writeSettings({ GATEGUARD_EXEMPT_GLOBS: '.peaks/**', [KEY]: '1000000' });
    // when: the rollback runs
    const envelope = await run(['--project', ws().path, '--reset']);
    // then: only the window row moved
    expect(envelope.ok).toBe(true);
    expect(envelope.data['action']).toBe('removed');
    expect(envelope.data['previousTokens']).toBe(1_000_000);
    expect(envBlock()[KEY]).toBeUndefined();
    expect(envBlock()['PEAKS_HARNESS_WINDOW_SYNC']).toBe('off');
    expect(envBlock()['GATEGUARD_EXEMPT_GLOBS']).toBe('.peaks/**');
    const raw = JSON.parse(readFileSync(settingsPath(), 'utf8')) as { hooks: unknown };
    expect(raw.hooks).toBeDefined();
    // and: the human is told how to undo the rollback
    expect(envelope.nextActions.join('\n')).toContain('--reenable');
  });

  it('when --reset runs twice, should report absent the second time (behavior)', async () => {
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    writeSettings({ [KEY]: '1000000' });
    await run(['--project', ws().path, '--reset']);
    // when: the rollback runs again
    const second = await run(['--project', ws().path, '--reset']);
    // then: idempotent, and it says so instead of pretending
    expect(second.ok).toBe(true);
    expect(second.data['action']).toBe('absent');
  });

  it('when --reset runs on a file with no peaks rows, should write NOTHING and say so (behavior)', async () => {
    // given: a settings file another tool owns — a window key is not there,
    //        and neither is the provenance marker (round 4: `--reset` used to
    //        write `PEAKS_HARNESS_WINDOW_SYNC: "off"` into exactly this shape
    //        of file, which in `$HOME` is the user's own personal settings)
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify({ permissions: { allow: ['Bash(git status)'] }, env: { SOME_USER_KEY: 'keep-me' } }, null, 2)}\n`,
      'utf8',
    );
    const before = readFileSync(settingsPath(), 'utf8');
    // when: the rollback runs
    const envelope = await run(['--project', ws().path, '--reset']);
    // then: nothing to remove ⇒ nothing written — the personal file is
    //       byte-identical and no peaks-loop row appeared in it
    expect(envelope.ok).toBe(true);
    expect(envelope.data['action']).toBe('absent');
    expect(readFileSync(settingsPath(), 'utf8')).toBe(before);
    expect(envBlock()['PEAKS_HARNESS_WINDOW_SYNC']).toBeUndefined();
    expect(envBlock()['SOME_USER_KEY']).toBe('keep-me');
    // and: the operator is told that — "absent" alone would read as "done"
    expect(envelope.nextActions.join('\n')).toContain('nothing was written');
  });

  it('when --reenable runs, should clear the opt-out and report whether one existed (behavior)', async () => {
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    writeSettings({ [KEY]: '1000000' });
    await run(['--project', ws().path, '--reset']);
    // when: management is restored
    const envelope = await run(['--project', ws().path, '--reenable']);
    // then: the flag is gone and the state is reported
    expect(envelope.data['action']).toBe('reenabled');
    expect(envBlock()['PEAKS_HARNESS_WINDOW_SYNC']).toBeUndefined();
    expect(envBlock()[KEY]).toBeUndefined();
    // and: a second re-enable is honestly a no-op
    const again = await run(['--project', ws().path, '--reenable']);
    expect(again.data['action']).toBe('absent');
  });
});
