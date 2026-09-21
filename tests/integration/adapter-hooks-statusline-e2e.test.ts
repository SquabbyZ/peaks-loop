// tests/integration/adapter-hooks-statusline-e2e.test.ts
//
// P2-B.4 adapter/distribution e2e — the `peaks hooks …` and
// `peaks statusline …` surfaces.
//
// Split out of the single 848-line `adapter-commands-e2e.test.ts` by slice
// rid-b1 (that file crossed the 800-line cap `peaks request transition`
// enforces). Its siblings are `adapter-skill-commands-e2e.test.ts` and
// `adapter-dispatch-capability-e2e.test.ts`; the shared spawn helper, payload
// schemas and tmp-project lifecycle live in `_adapter-commands-harness.ts`.
// No assertion was moved or removed by the split.

import { existsSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import {
  BIN_TIMEOUT_MS,
  cleanupProjects,
  expectRegisteredHelp,
  makeProject,
  parseCliEnvelopeWith,
  parseJson,
  runCli,
  hooksInstallPayload,
  hooksStatusPayload,
  hooksUninstallPayload,
  statuslineInstallPayload,
  statuslineRenderPayload,
  statuslineStatusPayload,
  stripAnsi
} from './_adapter-commands-harness.js';

afterEach(cleanupProjects);

interface HookIdeExpectation {
  readonly ide: string;
  readonly install: 'pass' | 'unsupported';
  readonly matcher?: string;
  readonly sentinel?: string;
  readonly statusEntries?: number;
  readonly removed?: boolean;
}

// Sentinel pinned to what each IDE actually writes to disk, not what the
// pre-S7-C4 install command claimed to write. S7's hook-commands.ts C4 fix
// derives `listExpectedEntriesForIde` from `resolveHookEntries(ide)` instead
// of a hard-coded literal. That fixed a self-inconsistency in the previous
// table: for codex and cursor, the install command reported `peaks gate
// enforce` as its first entry while the on-disk file actually contained
// `peaks hook handle`. The install path is now honest; the table must
// match what is on disk, not what the old (lying) summary said.
const HOOK_IDE_EXPECTATIONS: readonly HookIdeExpectation[] = [
  {
    ide: 'trae',
    install: 'pass',
    matcher: 'terminal',
    sentinel: 'peaks hook handle',
    statusEntries: 1,
    removed: true
  },
  {
    ide: 'codex',
    install: 'pass',
    matcher: 'shell',
    sentinel: 'peaks hook handle',
    statusEntries: 0,
    removed: false
  },
  {
    ide: 'cursor',
    install: 'pass',
    matcher: 'Bash',
    sentinel: 'peaks hook handle',
    statusEntries: 0,
    removed: false
  },
  { ide: 'qoder', install: 'unsupported', removed: false },
  { ide: 'tongyi-lingma', install: 'unsupported', removed: false },
  {
    ide: 'hermes',
    install: 'pass',
    matcher: 'Bash',
    sentinel: 'peaks gate enforce',
    statusEntries: 1,
    removed: true
  },
  {
    ide: 'openclaw',
    install: 'pass',
    matcher: 'Bash',
    sentinel: 'peaks gate enforce',
    statusEntries: 1,
    removed: true
  },
  { ide: 'zcode', install: 'unsupported', removed: false }
];

describe('peaks hooks install/status/uninstall --ide variants (P2-B.4 adapter/distribution e2e)', () => {
  test.each(HOOK_IDE_EXPECTATIONS)(
    '$ide returns its actual lifecycle envelope',
    (expected) => {
      const project = makeProject(`peaks-p2b4-hooks-${expected.ide}-`);
      expectRegisteredHelp(['hooks', 'install'], 'peaks hooks install [options]', project);
      expectRegisteredHelp(['hooks', 'status'], 'peaks hooks status [options]', project);
      expectRegisteredHelp(['hooks', 'uninstall'], 'peaks hooks uninstall [options]', project);

      const installResult = runCli(
        ['hooks', 'install', '--project', project, '--ide', expected.ide, '--json'],
        project
      );
      const install = parseCliEnvelopeWith(installResult.stdout, hooksInstallPayload);
      expect(install.command).toBe('hooks.install');

      if (expected.install === 'unsupported') {
        expect(installResult.code).toBe(1);
        expect(install.ok).toBe(false);
        expect(install.code).toBe('HOOKS_INSTALL_FAILED');
        expect(install.data.applied).toBe(false);

        // `status` is the one verb of the three that stays idempotent-success for
        // an IDE with no HOOK_COMMAND_BY_IDE entry. The QUERY succeeded — the disk
        // was read and the answer is "nothing is installed", which is true and
        // permanent — so the exit code says success and the payload carries the
        // finding (`supportsHooks: false`). Carrying "this IDE cannot host hooks"
        // on the exit code would make an ordinary query result look like a failed
        // command, and the caller could not tell the two apart.
        //
        // `install` above is deliberately NOT symmetric: its success would claim
        // an enforcement that cannot exist.
        const statusResult = runCli(
          ['hooks', 'status', '--project', project, '--ide', expected.ide, '--json'],
          project
        );
        const status = parseCliEnvelopeWith(statusResult.stdout, hooksStatusPayload);
        expect(statusResult.code).toBe(0);
        expect(status.ok).toBe(true);
        expect(status.command).toBe('hooks.status');
        expect(status.data.ide).toBe(expected.ide);
        expect(status.data.supportsHooks).toBe(false);
        expect(status.data.installed).toBe(false);
        expect((status.warnings ?? []).join('\n')).toContain(expected.ide);
      } else {
        expect(installResult.code).toBe(0);
        expect(install.ok).toBe(true);
        expect(install.data.applied).toBe(true);
        expect(install.data.entries?.[0]).toEqual({
          matcher: expected.matcher,
          sentinel: expected.sentinel
        });
        expect(install.data.settingsPath && existsSync(install.data.settingsPath)).toBe(true);

        const statusResult = runCli(
          ['hooks', 'status', '--project', project, '--ide', expected.ide, '--json'],
          project
        );
        expect(statusResult.code).toBe(0);
        const status = parseCliEnvelopeWith(statusResult.stdout, hooksStatusPayload);
        expect(status.ok).toBe(true);
        expect(status.command).toBe('hooks.status');
        expect(status.data.installed).toBe(true);
        // Asserted in both directions so `supportsHooks` is not a field that only
        // ever reads `false` — it has to distinguish the two IDE classes.
        expect(status.data.supportsHooks).toBe(true);
        expect(status.data.entries).toHaveLength(expected.statusEntries ?? 0);
      }

      const uninstallResult = runCli(
        ['hooks', 'uninstall', '--project', project, '--ide', expected.ide, '--json'],
        project
      );
      expect(uninstallResult.code).toBe(0);
      const uninstall = parseCliEnvelopeWith(uninstallResult.stdout, hooksUninstallPayload);
      expect(uninstall.ok).toBe(true);
      expect(uninstall.command).toBe('hooks.uninstall');
      expect(uninstall.data.removed).toBe(expected.removed);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks statusline install (P2-B.4 adapter/distribution e2e)', () => {
  test('dry-run returns the install plan without writing settings', () => {
    const project = makeProject('peaks-p2b4-statusline-install-');
    expectRegisteredHelp(['statusline', 'install'], 'peaks statusline install [options]', project);
    const result = runCli(
      [
        'statusline',
        'install',
        '--project',
        project,
        '--ide',
        'claude-code',
        '--dry-run',
        '--json'
      ],
      project
    );
    expect(result.code).toBe(0);
    // Drift: the child --json option currently emits data only, not a
    // ResultEnvelope — so this is `parseJson`, NOT `parseCliEnvelope`.
    const data = parseJson(result.stdout, statuslineInstallPayload);
    expect(data).toMatchObject({ scope: 'project', applied: false, dryRun: true });
    expect(existsSync(data.settingsPath)).toBe(false);
  });
});

describe('peaks statusline status (P2-B.4 adapter/distribution e2e)', () => {
  test('reports an uninstalled data-only status for a fresh project', () => {
    const project = makeProject('peaks-p2b4-statusline-status-');
    expectRegisteredHelp(['statusline', 'status'], 'peaks statusline status [options]', project);
    const result = runCli(
      ['statusline', 'status', '--project', project, '--ide', 'claude-code', '--json'],
      project
    );
    expect(result.code).toBe(0);
    // Data-only, like `statusline install` above: no envelope head to validate.
    const data = parseJson(result.stdout, statuslineStatusPayload);
    expect(data).toMatchObject({
      scope: 'project',
      installed: false,
      ide: 'claude-code',
      command: 'peaks statusline'
    });
  });
});

describe('peaks statusline render (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered as a hidden command and renders one status line', () => {
    const project = makeProject('peaks-p2b4-statusline-render-');
    expectRegisteredHelp(['statusline', 'render'], 'peaks statusline render [options]', project);
    const result = runCli(['statusline', 'render', '--project', project], project);
    expect(result.code).toBe(0);
    // Brand prefix only; the line is ANSI-colored (see `stripAnsi` above) and
    // the mountain glyph now follows the brand instead of preceding it.
    expect(stripAnsi(result.stdout).trim()).toMatch(/^Peaks/);
  });
});

describe('peaks statusline default (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered but the extra positional token falls through to default render', () => {
    const project = makeProject('peaks-p2b4-statusline-default-');
    // Post-Fix-5: `statusline default --help` falls through to peaks statusline --help
    // because 'statusline' is registered (top-level) and 'default' is not in
    // program.commands, so Fix-5's check considers the parent fallback legitimate.
    const help = runCli(['statusline', 'default', '--help'], project);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: peaks statusline [options] [command]');
    expect(help.stdout).not.toMatch(/^Usage: peaks statusline default/m);

    const result = runCli(['statusline', 'default', '--project', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseCliEnvelopeWith(result.stdout, statuslineRenderPayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('statusline.render');
    // `data.text` carries the same SGR bytes as the raw render path.
    expect(stripAnsi(envelope.data.text)).toMatch(/^Peaks/);
  });
});
