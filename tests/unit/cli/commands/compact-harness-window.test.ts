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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { registerCompactCommands } from '../../../../src/cli/commands/compact-command.js';
import { syncHarnessWindowForProject } from '../../../../src/services/context/auto-compact-reader.js';

declareDimensions('tests/unit/cli/commands/compact-harness-window.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

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
      'utf8'
    );
  }

  function envBlock(): Record<string, unknown> {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      env?: Record<string, unknown>;
    };
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
      'utf8'
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

  it('when --disable runs on a project never written to, should record the opt-out and make the NEXT probe write nothing (integration)', async () => {
    // given: a FRESH project — peaks-loop has never written a window here, so
    //        `--reset` is a deliberate no-op and the user has no way to say
    //        "do not manage this key" until AFTER a probe has written it
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    writeSettings({ GATEGUARD_EXEMPT_GLOBS: '.peaks/**' });
    // when: the user says it up front
    const disabled = await run(['--project', ws().path, '--disable']);
    // then: the opt-out is recorded, and nothing was removed because nothing
    //       was there to remove
    expect(disabled.ok).toBe(true);
    expect(disabled.data['action']).toBe('disabled');
    expect(envBlock()['PEAKS_HARNESS_WINDOW_SYNC']).toBe('off');
    expect(envBlock()[KEY]).toBeUndefined();
    expect(disabled.nextActions.join('\n')).toContain('--reenable');
    // and: THE POINT — the probe that would have written the key does not
    const probe = syncHarnessWindowForProject({ projectRoot: ws().path, tokens: 1_000_000 });
    expect(probe?.action).toBe('skipped');
    expect(probe?.reason).toBe('opted-out');
    expect(envBlock()[KEY]).toBeUndefined();
    // and: the way back exists
    const reenabled = await run(['--project', ws().path, '--reenable']);
    expect(reenabled.data['action']).toBe('reenabled');
    expect(syncHarnessWindowForProject({ projectRoot: ws().path, tokens: 1_000_000 })?.action).toBe(
      'written'
    );
    expect(envBlock()[KEY]).toBe('1000000');
  });

  it('when --disable is NOT used, should be the control: the same probe writes the key (integration)', async () => {
    // given: the identical fresh project, without the opt-out. Control for the
    //        case above — without it, a probe that failed for any unrelated
    //        reason would look exactly like the opt-out working.
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    writeSettings({ GATEGUARD_EXEMPT_GLOBS: '.peaks/**' });
    // when: the probe runs
    const probe = syncHarnessWindowForProject({ projectRoot: ws().path, tokens: 1_000_000 });
    // then: it writes — so "nothing was written" above is the opt-out's doing
    expect(probe?.action).toBe('written');
    expect(envBlock()[KEY]).toBe('1000000');
  });

  // E4 (rid 2026-09-13-defects-e): the opt-out verb used to be the one write in
  // this module with no home guard, so `--project .` from a fresh terminal (cwd
  // = $HOME) put a peaks-loop row in the user's PERSONAL settings. These two
  // cases run against an ISOLATED fake home — the real one is never touched.
  it('when --disable targets the home directory, should refuse and create nothing (E4)', async () => {
    // given: the fresh-terminal case, reconstructed with a fake HOME
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    const fakeHome = join(ws().path, 'fake-home');
    mkdirSync(fakeHome, { recursive: true });
    withEnv('HOME', fakeHome);
    withEnv('USERPROFILE', fakeHome);
    // when: the opt-out is requested for that root
    const envelope = await run(['--project', fakeHome, '--disable']);
    // then: refused, and NOTHING was created — not the file, not `.claude/`.
    //       A refusal that had already mkdir'd `$HOME/.claude` would not be one.
    expect(envelope.ok).toBe(true);
    expect(envelope.data['action']).toBe('refused-unsafe-project-root');
    expect(existsSync(join(fakeHome, '.claude'))).toBe(false);
    // and: the operator is told why, and what to do instead
    expect(envelope.nextActions.join('\n')).toContain('home directory');
    expect(envelope.nextActions.join('\n')).toContain('--project');
  });

  it('when --disable targets a SUBDIRECTORY of home, should still record the opt-out (E4 control)', async () => {
    // given: a home directory that CONTAINS the project — the ordinary layout.
    //        Without this case, the refusal above would be indistinguishable
    //        from a guard that rejected every path under home.
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    const fakeHome = join(ws().path, 'fake-home-sub');
    const project = join(fakeHome, 'proj');
    mkdirSync(project, { recursive: true });
    withEnv('HOME', fakeHome);
    withEnv('USERPROFILE', fakeHome);
    // when: the opt-out is requested for the project, not for home itself
    const envelope = await run(['--project', project, '--disable']);
    // then: recorded — the guard is exact-home, exactly like H1's
    expect(envelope.data['action']).toBe('disabled');
    expect(existsSync(join(project, '.claude', 'settings.local.json'))).toBe(true);
  });

  it('when --disable runs twice, should report the second as already opted out (behavior)', async () => {
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(KEY, undefined);
    writeSettings({ [KEY]: '150000' });
    await run(['--project', ws().path, '--disable']);
    // when: it runs again
    const again = await run(['--project', ws().path, '--disable']);
    // then: idempotent and honest about it — and the pinned value still stands,
    //       because "stop managing" is not "remove"
    expect(again.data['action']).toBe('already-opted-out');
    expect(envBlock()[KEY]).toBe('150000');
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
