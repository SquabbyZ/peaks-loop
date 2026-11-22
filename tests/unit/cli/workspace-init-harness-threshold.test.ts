// tests/unit/cli/workspace-init-harness-threshold.test.ts
//
// The user's requirement, at the surface they can see it: "a downstream project
// using peaks-loop must get working compaction INSIDE that project, configured
// in the project's own .claude/settings.local.json".
//
// `peaks workspace init` is the moment a project is adopted, so it is the
// moment the pair (window + percent) becomes configured. These tests drive the
// REAL registered command against a tmp project and assert what landed on
// disk — plus the two states init must NOT touch: a project that opted out, and
// one whose settings file was not JSON (which init heals rather than refusing
// on).
//
// Dimensions covered:
//   - render:      the envelope's `harnessThreshold` field and its notice
//   - behavior:    fresh write / idempotent re-init / opt-out / corrupt file
//   - integration: real commander command + real settings file on disk
//   - a11y:        the notice names the file and never asks a question

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { makeCapturedIo, withEnv } from '../_setup/io.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { registerWorkspaceInitCommand } from '~/src/cli/commands/workspace/init-command';

declareDimensions('tests/unit/cli/workspace-init-harness-threshold.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const WINDOW_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

interface Envelope {
  readonly ok: boolean;
  readonly data: Record<string, unknown>;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

describe('peaks workspace init — harness auto-compact threshold', () => {
  const ws = withTmpWorkspacePerTest('peaks-init-threshold-');

  afterEach(() => {
    process.exitCode = undefined;
  });

  function settingsPath(): string {
    return join(ws().path, '.claude', 'settings.local.json');
  }

  function envBlock(): Record<string, unknown> {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as {
      env?: Record<string, unknown>;
    };
    return parsed['env'] ?? {};
  }

  /** This host's Claude Code session is itself running with these exported. */
  function neutraliseAmbientEnv(): void {
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv(WINDOW_KEY, undefined);
    withEnv(PERCENT_KEY, undefined);
  }

  async function runInit(): Promise<Envelope> {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    // The registrar adds `init` to the command it is handed, so it must be the
    // `workspace` sub-command — handing it the program registers `peaks init`.
    const workspace = program.command('workspace');
    registerWorkspaceInitCommand(workspace, io);
    await program.parseAsync(['workspace', 'init', '--project', ws().path, '--json'], {
      from: 'user'
    });
    return JSON.parse(captured.text()) as Envelope;
  }

  it('when a fresh project is initialised, should configure the window and the percent in ITS OWN settings file', async () => {
    // given: a project peaks-loop has never touched
    // when: the workspace is initialised
    // then: both knobs are on disk, at the documented defaults
    neutraliseAmbientEnv();
    const envelope = await runInit();
    expect(envelope.ok).toBe(true);
    expect(existsSync(settingsPath())).toBe(true);
    expect(envBlock()[WINDOW_KEY]).toBe('1000000');
    expect(envBlock()[PERCENT_KEY]).toBe('80');
    // and: the envelope carries the outcome structurally, not only as prose
    const threshold = envelope.data['harnessThreshold'] as {
      settingsPath: string;
      percent: { action: string; key: string };
    };
    expect(threshold.settingsPath).toBe(settingsPath());
    expect(threshold.percent.action).toBe('written');
    expect(threshold.percent.key).toBe(PERCENT_KEY);
  });

  it('when the project is initialised again, should not rewrite the configured values', async () => {
    // given: an already-configured project
    // when: init runs a second time
    // then: both halves report "already in force" and the peaks rows stand
    neutraliseAmbientEnv();
    await runInit();
    const first = readFileSync(settingsPath(), 'utf8');
    const envelope = await runInit();
    const threshold = envelope.data['harnessThreshold'] as {
      window: { action: string };
      percent: { action: string };
    };
    expect(threshold.window.action).toBe('unchanged');
    expect(threshold.percent.action).toBe('unchanged');
    expect(first).toContain('"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "80"');
    expect(envBlock()[WINDOW_KEY]).toBe('1000000');
    expect(envBlock()[PERCENT_KEY]).toBe('80');
  });

  it('when the project has opted out of harness management, should write NEITHER knob and warn', async () => {
    // given: a rolled-back project (the `--reset` state)
    // when: init runs
    // then: nothing is resurrected, and the user is told why the project is not
    //       configured — silence here would read as "configured"
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify({ env: { PEAKS_HARNESS_WINDOW_SYNC: 'off' } }, null, 2)}\n`,
      'utf8'
    );
    const envelope = await runInit();
    expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    expect(envelope.warnings.join('\n')).toContain('opted-out');
    expect(envelope.warnings.join('\n')).toContain('--reenable');
  });

  it('when the settings file was not JSON, should heal it and still configure both knobs', async () => {
    // given: a .claude/settings.local.json that is not JSON
    // when: init runs
    // then: the init SUCCEEDS (fail-soft) — and the settings materializer heals
    //       the file first, so the threshold write never meets its
    //       `unreadable-settings` state from here. That refusal is pinned at the
    //       module level; what is pinned HERE is that a corrupt file cannot stop
    //       the install.
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(settingsPath(), '{ not json\n', 'utf8');
    const envelope = await runInit();
    expect(envelope.ok).toBe(true);
    expect(readFileSync(settingsPath(), 'utf8')).not.toBe('{ not json\n');
    expect(envBlock()[WINDOW_KEY]).toBe('1000000');
    expect(envBlock()[PERCENT_KEY]).toBe('80');
  });

  it('when a secret-looking string is parked at either key, should not echo it — not even a prefix (MED-2)', async () => {
    // given: a long token mis-parked at a harness key. `init --json` spreads
    //        BOTH sync results, each of which carries the file's RAW value at
    //        that key — before the fix the literal string reached the JSON
    //        envelope, the warnings, and therefore logs.
    // when: init reconciles each key in turn and prints envelope + prose notice
    // then: neither the full string nor any long prefix appears anywhere, the
    //       envelope half carries a bounded note instead of the raw field, and
    //       the value itself is untouched (init refuses a human pin)
    for (const [field, key, secret] of [
      ['percent', PERCENT_KEY, 'sk-live-SECRETMATERIAL-9f8e7d6c5b4a39281706'],
      ['window', WINDOW_KEY, 'ghp_SECRETMATERIAL_a1b2c3d4e5f6a7b8c9']
    ] as const) {
      neutraliseAmbientEnv();
      rmSync(join(ws().path, '.claude'), { recursive: true, force: true });
      mkdirSync(join(ws().path, '.claude'), { recursive: true });
      writeFileSync(
        settingsPath(),
        `${JSON.stringify({ env: { [key]: secret } }, null, 2)}\n`,
        'utf8'
      );
      const { io, captured } = makeCapturedIo();
      const program = new Command();
      registerWorkspaceInitCommand(program.command('workspace'), io);
      await program.parseAsync(['workspace', 'init', '--project', ws().path, '--json'], {
        from: 'user'
      });
      const text = captured.text();
      expect(text).not.toContain(secret);
      expect(text).not.toContain(secret.slice(0, 20));
      const halves = (
        JSON.parse(text) as Envelope & {
          data: { harnessThreshold: Record<string, Record<string, unknown>> };
        }
      ).data.harnessThreshold;
      const half = halves[field] ?? {};
      expect(half['previousRawValue']).toBeUndefined();
      expect(String(half['previousRawNote'])).toContain('not echoed here');
      expect(envBlock()[key]).toBe(secret);
    }
  });

  it('when the threshold notice is rendered, should never ask the user a question', async () => {
    // given: the fresh-project path, which writes and therefore emits the notice
    // when: init runs
    // then: the notices are statements (Human-NL-Choice-Only: no verb-typing
    //       request, no question) and they do name the settings file
    neutraliseAmbientEnv();
    const envelope = await runInit();
    const notice = envelope.nextActions.find((line) => line.includes(PERCENT_KEY)) ?? '';
    expect(notice).toContain(settingsPath());
    expect(notice).not.toContain('?');
    expect(envelope.warnings.join('\n')).not.toContain('?');
  });

  it('when only the WINDOW half is written, should announce that write', async () => {
    // given: a project whose percent is already hand-set (so the percent half
    //        reports `unchanged`) and whose window slot is empty
    // when: init reconciles the pair
    // then: the window write is announced — gating the notice on the percent
    //       alone wrote the file and said nothing about it
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify({ env: { [PERCENT_KEY]: '65' } }, null, 2)}\n`,
      'utf8'
    );
    const envelope = await runInit();
    expect(envBlock()[WINDOW_KEY]).toBe('1000000');
    expect(envBlock()[PERCENT_KEY]).toBe('65');
    const notices = envelope.nextActions.filter((line) => line.includes(WINDOW_KEY));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('WROTE');
    expect(notices[0]).toContain(settingsPath());
    // and: the hand-set percent was not overwritten or claimed
    expect(envBlock()['PEAKS_HARNESS_PERCENT_WRITTEN']).toBeUndefined();
  });

  it('when the percent is REFUSED, should warn as a refusal and say the project is not fully configured', async () => {
    // given: a percent the harness does not accept (`150`), so the percent half
    //        is REFUSED rather than written or unchanged
    // when: init reconciles the pair
    // then: the notice rides `warnings` as a REFUSAL — it says "not managed" and
    //       names the band — and never opens with a write announcement. The
    //       window write is announced on `nextActions` instead, so neither fact
    //       is buried in the other's paragraph.
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify({ env: { [PERCENT_KEY]: '150' } }, null, 2)}\n`,
      'utf8'
    );
    const envelope = await runInit();
    // the window half still landed, and it is announced as a write
    expect(envBlock()[WINDOW_KEY]).toBe('1000000');
    const writeNotice = envelope.nextActions.find((line) => line.includes(WINDOW_KEY)) ?? '';
    expect(writeNotice).toContain('WROTE');
    // the refusal is on the warning channel, and reads as one
    const warning = envelope.warnings.find((line) => line.includes(PERCENT_KEY)) ?? '';
    expect(warning).toContain('NOT fully configured');
    expect(warning).toContain('not managed');
    expect(warning).toContain('outside the 1..100 percent');
    expect(warning).not.toContain('WROTE');
    // the refused value is untouched, and the notice never asks a question
    expect(envBlock()[PERCENT_KEY]).toBe('150');
    expect(envelope.warnings.join('\n')).not.toContain('?');
  });

  it('when BOTH halves are refused, should warn without any write announcement', async () => {
    // given: a rolled-back project — the one state that takes BOTH knobs down at
    //        once, so neither half can contribute a write clause
    // when: init reconciles
    // then: the warning says nothing was managed and carries NO "WROTE …" clause.
    //       Without this control, a warning-only refusal could still arrive
    //       prefixed by the window half's write announcement.
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify({ env: { PEAKS_HARNESS_WINDOW_SYNC: 'off' } }, null, 2)}\n`,
      'utf8'
    );
    const envelope = await runInit();
    const warning = envelope.warnings.find((line) => line.includes('not managed')) ?? '';
    expect(warning).toContain('not managed');
    expect(warning).not.toContain('WROTE');
    expect(envelope.nextActions.join('\n')).not.toContain('WROTE');
    expect(envBlock()[WINDOW_KEY]).toBeUndefined();
    expect(envBlock()[PERCENT_KEY]).toBeUndefined();
  });

  it('when only the WINDOW half is REFUSED, should warn naming the window and why (HIGH-2)', async () => {
    // given: the reviewer's exact fixture — an out-of-band `50000` window and an
    //        empty percent slot. The window half is refused; the percent writes.
    // when: init reconciles the pair
    // then: the refusal reaches `warnings` and NAMES the window and the band.
    //       The old routing checked only the percent's `skipped`, so this file
    //       produced a warning count of 0 and the only line said "WROTE …PCT=80"
    //       — a write announcement about a project that is not configured.
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify({ env: { [WINDOW_KEY]: '50000' } }, null, 2)}\n`,
      'utf8'
    );
    const envelope = await runInit();
    // the warnings channel also carries init's own unrelated notice about
    // missing project-local standards, so the threshold line is picked out by
    // its frame rather than assumed to be the only one
    const warning = envelope.warnings.find((line) => line.includes('NOT fully configured')) ?? '';
    expect(warning).toContain('window');
    expect(warning).toContain('outside the 100000..1000000');
    // and: the percent write is still announced, on its own channel
    expect(envBlock()[PERCENT_KEY]).toBe('80');
    expect(envelope.nextActions.join('\n')).toContain(`${PERCENT_KEY}=80`);
    // and: the refused window is untouched
    expect(envBlock()[WINDOW_KEY]).toBe('50000');
  });

  it('when a refused WINDOW sits beside a hand-set percent, should warn instead of staying silent (HIGH-2)', async () => {
    // given: the reviewer's second fixture — window `50000` AND a hand-set
    //        percent `65`. Neither half writes: the window is out of band and the
    //        percent is `unchanged`.
    // when: init reconciles
    // then: the file's own comment says complete silence about an unconfigured
    //       project must never happen — measured before this fix as NO threshold
    //       warning at all (and no write announcement either). The window
    //       refusal is a warning, and nothing on `nextActions` announces a
    //       threshold write.
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify({ env: { [WINDOW_KEY]: '50000', [PERCENT_KEY]: '65' } }, null, 2)}\n`,
      'utf8'
    );
    const envelope = await runInit();
    const warning = envelope.warnings.find((line) => line.includes('NOT fully configured')) ?? '';
    expect(warning).toContain('window');
    expect(warning).toContain('outside the 100000..1000000');
    expect(envelope.nextActions.join('\n')).not.toContain(WINDOW_KEY);
    // and: the hand-set percent is untouched
    expect(envBlock()[PERCENT_KEY]).toBe('65');
  });

  it('HIGH-3: when a HUMAN `150` is refused, should warn with advice the rollback does not contradict', async () => {
    // given: a no-marker `150` — the value the old notice told the user to clear
    //        with `--reset`, which answered "Kept … your own setting"
    // when: init reconciles
    // then: the warning names the user as the owner and does NOT name `--reset`;
    //       the advice and the command now agree
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify({ env: { [PERCENT_KEY]: '150' } }, null, 2)}\n`,
      'utf8'
    );
    const envelope = await runInit();
    const warning = envelope.warnings.find((line) => line.includes('NOT fully configured')) ?? '';
    expect(warning).toContain('150');
    expect(warning).toContain('yours');
    expect(warning).not.toContain('--reset');
    expect(envBlock()[PERCENT_KEY]).toBe('150');
  });

  it('when --no-claude-hooks is passed, should write NEITHER knob and should say so', async () => {
    // given: the flag that skips the settings materialization, on a fresh project
    // when: init runs
    // then: NEITHER knob is written — those rows live in the very file the flag
    //       says not to touch (`tests/integration/five-new-rids-e2e.test.ts`
    //       pins that the file does not exist afterwards), so the reconcile
    //       stands down and NAMES the omission instead of writing and explaining
    //       it
    neutraliseAmbientEnv();
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    const workspace = program.command('workspace');
    registerWorkspaceInitCommand(workspace, io);
    await program.parseAsync(
      [
        'workspace',
        'init',
        '--project',
        ws().path,
        '--install-hooks',
        'skip',
        '--no-claude-hooks',
        '--json'
      ],
      { from: 'user' }
    );
    const envelope = JSON.parse(captured.text()) as Envelope & {
      data: { claudeSettings?: { action: string } };
    };
    expect(envelope.data.claudeSettings?.action).toBe('skipped');
    // absent, not null: the field is omitted when the reconcile did not run
    expect(envelope.data['harnessThreshold']).toBeUndefined();
    expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    // two lines mention the flag: the materializer's skip notice and ours
    const disclaimer = envelope.nextActions.find((line) => line.includes('NOT written'));
    expect(disclaimer).toBeDefined();
    expect(disclaimer).toContain('NOT written');
    expect(disclaimer).toContain('.claude/settings.local.json');
  });

  it('when --no-claude-hooks is passed and hooks were already installed, should leave its env block untouched', async () => {
    // given: the control for when the file ALREADY exists — the flag must not add
    //        rows to it either, so "does not exist" above is not the only shape
    // when: init runs with the flag over an existing settings file
    // then: the file is byte-identical, so the skip covers the threshold rows too
    neutraliseAmbientEnv();
    mkdirSync(join(ws().path, '.claude'), { recursive: true });
    writeFileSync(
      settingsPath(),
      `${JSON.stringify({ env: { KEEP_ME: 'yes' } }, null, 2)}\n`,
      'utf8'
    );
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    const workspace = program.command('workspace');
    registerWorkspaceInitCommand(workspace, io);
    await program.parseAsync(
      [
        'workspace',
        'init',
        '--project',
        ws().path,
        '--install-hooks',
        'skip',
        '--no-claude-hooks',
        '--json'
      ],
      { from: 'user' }
    );
    expect((JSON.parse(captured.text()) as Envelope).ok).toBe(true);
    expect(envBlock()[PERCENT_KEY]).toBeUndefined();
    expect(envBlock()[WINDOW_KEY]).toBeUndefined();
    expect(envBlock()['KEEP_ME']).toBe('yes');
    // and: the file may still exist (the hooks installer writes it), so the
    //      property is that NO threshold row is in it, not that it is absent
    expect(existsSync(settingsPath())).toBe(true);
  });
});
