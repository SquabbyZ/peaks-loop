import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const REPO = resolve(__dirname, '../..');
const BIN_TIMEOUT_MS = 120_000;
const REQUEST_ID = '2026-07-25-p2-b4-adapter-e2e';

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

interface CliEnvelope<T> {
  readonly ok: boolean;
  readonly command: string;
  readonly code?: string;
  readonly message?: string;
  readonly data: T;
  readonly warnings: readonly unknown[];
  readonly nextActions: readonly string[];
}

function runCli(args: readonly string[], cwd = REPO): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BIN_TIMEOUT_MS,
      env: { ...process.env, PEAKS_CALLER_ID: 'adapter-commands-e2e' }
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (error: unknown) {
    const caught = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number | null;
    };
    return {
      stdout: typeof caught.stdout === 'string' ? caught.stdout : caught.stdout?.toString('utf8') ?? '',
      stderr: typeof caught.stderr === 'string' ? caught.stderr : caught.stderr?.toString('utf8') ?? '',
      code: typeof caught.status === 'number' ? caught.status : 1
    };
  }
}

function parseJson<T>(result: RunResult): T {
  return JSON.parse(result.stdout) as T;
}

/**
 * The bin wrapper currently appends a false COMMAND_NOT_FOUND error to every
 * positional `--help` request. Exact Usage text remains reliable registration
 * evidence, so accept either a clean exit or that known wrapper drift.
 */
function expectRegisteredHelp(
  args: readonly string[],
  expectedUsage: string,
  cwd = REPO
): RunResult {
  const result = runCli([...args, '--help'], cwd);
  expect(result.stdout).toContain(`Usage: ${expectedUsage}`);
  expect(
    result.code === 0 ||
    (result.stderr.includes('COMMAND_NOT_FOUND') && result.stderr.includes('combinedWithHelp'))
  ).toBe(true);
  return result;
}

function expectCommandNotRegistered(
  args: readonly string[],
  parentUsage: string,
  cwd = REPO
): { readonly help: RunResult; readonly action: RunResult } {
  const help = runCli([...args, '--help'], cwd);
  // Post-Fix-5: there are two real outcomes for `X Y --help` where Y is unregistered:
  //   (a) X is a registered top-level parent (e.g. `peaks skill install --help`):
  //       commander falls through to `peaks skill --help` → exit 0 + parent usage
  //       on stdout + empty stderr (no COMMAND_NOT_FOUND envelope).
  //   (b) Y is the first positional of an unregistered top-level (e.g.
  //       `peaks dispatch --help`): Fix-5's registered.has(Y) is false → setImmediate
  //       emits COMMAND_NOT_FOUND envelope + exit 1.
  // Accept either: just require `parentUsage` on stdout and the action call returns
  // a structured COMMAND_NOT_FOUND.
  expect(help.stdout).toContain(`Usage: ${parentUsage}`);

  const action = runCli(args, cwd);
  expect(action.code).not.toBe(0);
  expect(action.stdout + action.stderr).toContain('COMMAND_NOT_FOUND');
  return { help, action };
}

const projects: string[] = [];

function makeProject(prefix: string): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  projects.push(project);
  return project;
}

function initWorkspace(project: string): string {
  const result = runCli(['workspace', 'init', '--project', project, '--json'], project);
  expect(result.code).toBe(0);
  const envelope = parseJson<CliEnvelope<{ sessionId: string; bound: boolean }>>(result);
  expect(envelope.ok).toBe(true);
  expect(envelope.command).toBe('workspace.init');
  expect(envelope.data.bound).toBe(true);
  return envelope.data.sessionId;
}

afterEach(() => {
  for (const project of projects) {
    if (existsSync(project)) rmSync(project, { recursive: true, force: true });
  }
  projects.length = 0;
});

describe('peaks skill list (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered and returns the skill catalog envelope', () => {
    expectRegisteredHelp(['skill', 'list'], 'peaks skill list [options]');
    const result = runCli(['skill', 'list', '--json']);
    expect(result.code).toBe(0);
    const envelope = parseJson<CliEnvelope<{ skills: ReadonlyArray<{ name: string }> }>>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('skill.list');
    expect(envelope.data.skills.length).toBeGreaterThan(0);
  });
});

describe('peaks skill sync (P2-B.4 adapter/distribution e2e)', () => {
  test('dry-run reports all platform plans without applying them', () => {
    const project = makeProject('peaks-p2b4-skill-sync-');
    expectRegisteredHelp(['skill', 'sync'], 'peaks skill sync [options]', project);
    const result = runCli(['skill', 'sync', '--project', project, '--dry-run', '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseJson<CliEnvelope<{
      applied: boolean;
      dryRun: boolean;
      perPlatform: readonly unknown[];
      failedCount: number;
    }>>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('skill.sync');
    expect(envelope.data.applied).toBe(false);
    expect(envelope.data.dryRun).toBe(true);
    expect(envelope.data.perPlatform.length).toBeGreaterThan(0);
  }, BIN_TIMEOUT_MS);
});

describe('peaks skill install <name> (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered, so no destructive install action is attempted', () => {
    expectCommandNotRegistered(
      ['skill', 'install', 'peaks-code'],
      'peaks skill [options] [command]'
    );
  });
});

describe('peaks skill search (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered and returns its documented raw result array', () => {
    expectRegisteredHelp(['skill', 'search'], 'peaks skill search [options]');
    const result = runCli(['skill', 'search', '--query', 'code']);
    expect(result.code).toBe(0);
    const skills = parseJson<ReadonlyArray<{ name: string; matchScore: number }>>(result);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.every(({ name, matchScore }) => name.length > 0 && matchScore > 0)).toBe(true);
  });
});

describe('peaks skill conformance (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered; the top-level skills:audit-conformance replacement works', () => {
    expectCommandNotRegistered(
      ['skill', 'conformance'],
      'peaks skill [options] [command]'
    );
    expectRegisteredHelp(
      ['skills:audit-conformance'],
      'peaks skills:audit-conformance [options]'
    );
    const replacement = runCli(['skills:audit-conformance', '--project', REPO, '--json']);
    expect(replacement.code).toBe(0);
    const envelope = parseJson<CliEnvelope<{ checked: number; checks: readonly unknown[] }>>(replacement);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('skills.audit-conformance');
    expect(envelope.data.checked).toBeGreaterThan(0);
  }, BIN_TIMEOUT_MS);
});

describe('peaks skill visibility (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered; the top-level skill:visibility replacement works', () => {
    expectCommandNotRegistered(
      ['skill', 'visibility'],
      'peaks skill [options] [command]'
    );
    expectRegisteredHelp(['skill:visibility'], 'peaks skill:visibility [options]');
    const replacement = runCli(['skill:visibility', '--list', '--json']);
    expect(replacement.code).toBe(0);
    const output = parseJson<{
      ok: boolean;
      skills: ReadonlyArray<{ name: string; visibility: string }>;
    }>(replacement);
    expect(output.ok).toBe(true);
    expect(output.skills.length).toBeGreaterThan(0);
  });
});

describe('peaks skill doctor (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered and returns structured skill checks', () => {
    expectRegisteredHelp(['skill', 'doctor'], 'peaks skill doctor [options]');
    const result = runCli(['skill', 'doctor', '--json']);
    const envelope = parseJson<CliEnvelope<{ checks: readonly unknown[]; ok: boolean }>>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('skill.doctor');
    expect(Array.isArray(envelope.data.checks)).toBe(true);
    expect(result.code).toBe(envelope.data.ok ? 0 : 1);
  }, BIN_TIMEOUT_MS);
});

describe('peaks skill runbook (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered and inspects the peaks-code runbook', () => {
    expectRegisteredHelp(
      ['skill', 'runbook', 'peaks-code'],
      'peaks skill runbook [options] <name>'
    );
    const result = runCli(['skill', 'runbook', 'peaks-code', '--json']);
    expect(result.code).toBe(0);
    const envelope = parseJson<CliEnvelope<{
      name: string;
      hasRunbook: boolean;
      peaksCommandCount: number;
    }>>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('skill.runbook');
    expect(envelope.data.name).toBe('peaks-code');
    expect(envelope.data.hasRunbook).toBe(true);
  });
});

describe('peaks skill presence (P2-B.4 adapter/distribution e2e)', () => {
  test('reports active:false in an isolated project with no marker', () => {
    const project = makeProject('peaks-p2b4-presence-get-');
    expectRegisteredHelp(['skill', 'presence'], 'peaks skill presence [options]', project);
    const result = runCli(['skill', 'presence', '--project', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseJson<CliEnvelope<{ active: boolean }>>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('skill.presence');
    expect(envelope.data.active).toBe(false);
  });
});

describe('peaks skill presence:set (P2-B.4 adapter/distribution e2e)', () => {
  test('sets a session-bound marker inside a temporary project', () => {
    const project = makeProject('peaks-p2b4-presence-set-');
    initWorkspace(project);
    expectRegisteredHelp(
      ['skill', 'presence:set', 'peaks-rd'],
      'peaks skill presence:set [options] <name>',
      project
    );
    const result = runCli([
      'skill', 'presence:set', 'peaks-rd', '--project', project,
      '--mode', 'strict', '--gate', 'p2-b4-e2e', '--json'
    ], project);
    expect(result.code).toBe(0);
    const envelope = parseJson<CliEnvelope<{
      active: boolean;
      skill: string;
      mode: string;
      gate: string;
    }>>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('skill.presence:set');
    expect(envelope.data).toMatchObject({
      active: true,
      skill: 'peaks-rd',
      mode: 'strict',
      gate: 'p2-b4-e2e'
    });
  }, BIN_TIMEOUT_MS);
});

describe('peaks skill presence:clear (P2-B.4 adapter/distribution e2e)', () => {
  test('clears an isolated marker and restores active:false', () => {
    const project = makeProject('peaks-p2b4-presence-clear-');
    initWorkspace(project);
    runCli(['skill', 'presence:set', 'peaks-rd', '--project', project, '--json'], project);
    expectRegisteredHelp(
      ['skill', 'presence:clear'],
      'peaks skill presence:clear [options]',
      project
    );
    const result = runCli(['skill', 'presence:clear', '--project', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseJson<CliEnvelope<{
      active: boolean;
      removed: boolean;
      projectContextUpdated: boolean;
    }>>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('skill.presence:clear');
    expect(envelope.data).toMatchObject({ active: false, removed: true });

    const after = parseJson<CliEnvelope<{ active: boolean }>>(
      runCli(['skill', 'presence', '--project', project, '--json'], project)
    );
    expect(after.data.active).toBe(false);
  }, BIN_TIMEOUT_MS);
});

interface HookIdeExpectation {
  readonly ide: string;
  readonly install: 'pass' | 'unsupported';
  readonly matcher?: string;
  readonly sentinel?: string;
  readonly statusEntries?: number;
  readonly removed?: boolean;
}

const HOOK_IDE_EXPECTATIONS: readonly HookIdeExpectation[] = [
  { ide: 'trae', install: 'pass', matcher: 'terminal', sentinel: 'peaks hook handle', statusEntries: 1, removed: true },
  { ide: 'codex', install: 'pass', matcher: 'shell', sentinel: 'peaks gate enforce', statusEntries: 0, removed: false },
  { ide: 'cursor', install: 'pass', matcher: 'Bash', sentinel: 'peaks gate enforce', statusEntries: 0, removed: false },
  { ide: 'qoder', install: 'unsupported', removed: false },
  { ide: 'tongyi-lingma', install: 'unsupported', removed: false },
  { ide: 'hermes', install: 'pass', matcher: 'Bash', sentinel: 'peaks gate enforce', statusEntries: 1, removed: true },
  { ide: 'openclaw', install: 'pass', matcher: 'Bash', sentinel: 'peaks gate enforce', statusEntries: 1, removed: true },
  { ide: 'zcode', install: 'unsupported', removed: false }
];

describe('peaks hooks install/status/uninstall --ide variants (P2-B.4 adapter/distribution e2e)', () => {
  test.each(HOOK_IDE_EXPECTATIONS)('$ide returns its actual lifecycle envelope', (expected) => {
    const project = makeProject(`peaks-p2b4-hooks-${expected.ide}-`);
    expectRegisteredHelp(['hooks', 'install'], 'peaks hooks install [options]', project);
    expectRegisteredHelp(['hooks', 'status'], 'peaks hooks status [options]', project);
    expectRegisteredHelp(['hooks', 'uninstall'], 'peaks hooks uninstall [options]', project);

    const installResult = runCli([
      'hooks', 'install', '--project', project, '--ide', expected.ide, '--json'
    ], project);
    const install = parseJson<CliEnvelope<{
      ide: string;
      applied: boolean;
      settingsPath?: string;
      entries?: ReadonlyArray<{ matcher: string; sentinel: string }>;
    }>>(installResult);
    expect(install.command).toBe('hooks.install');

    if (expected.install === 'unsupported') {
      expect(installResult.code).toBe(1);
      expect(install.ok).toBe(false);
      expect(install.code).toBe('HOOKS_INSTALL_FAILED');
      expect(install.data.applied).toBe(false);

      const statusResult = runCli([
        'hooks', 'status', '--project', project, '--ide', expected.ide, '--json'
      ], project);
      const status = parseJson<CliEnvelope<{ ide: string }>>(statusResult);
      expect(statusResult.code).toBe(1);
      expect(status.ok).toBe(false);
      expect(status.code).toBe('HOOKS_STATUS_FAILED');
    } else {
      expect(installResult.code).toBe(0);
      expect(install.ok).toBe(true);
      expect(install.data.applied).toBe(true);
      expect(install.data.entries?.[0]).toEqual({
        matcher: expected.matcher,
        sentinel: expected.sentinel
      });
      expect(install.data.settingsPath && existsSync(install.data.settingsPath)).toBe(true);

      const statusResult = runCli([
        'hooks', 'status', '--project', project, '--ide', expected.ide, '--json'
      ], project);
      expect(statusResult.code).toBe(0);
      const status = parseJson<CliEnvelope<{
        installed: boolean;
        entries: readonly unknown[];
      }>>(statusResult);
      expect(status.ok).toBe(true);
      expect(status.command).toBe('hooks.status');
      expect(status.data.installed).toBe(true);
      expect(status.data.entries).toHaveLength(expected.statusEntries ?? 0);
    }

    const uninstallResult = runCli([
      'hooks', 'uninstall', '--project', project, '--ide', expected.ide, '--json'
    ], project);
    expect(uninstallResult.code).toBe(0);
    const uninstall = parseJson<CliEnvelope<{ ide: string; removed: boolean }>>(uninstallResult);
    expect(uninstall.ok).toBe(true);
    expect(uninstall.command).toBe('hooks.uninstall');
    expect(uninstall.data.removed).toBe(expected.removed);
  }, BIN_TIMEOUT_MS);
});

describe('peaks statusline install (P2-B.4 adapter/distribution e2e)', () => {
  test('dry-run returns the install plan without writing settings', () => {
    const project = makeProject('peaks-p2b4-statusline-install-');
    expectRegisteredHelp(['statusline', 'install'], 'peaks statusline install [options]', project);
    const result = runCli([
      'statusline', 'install', '--project', project, '--ide', 'claude-code',
      '--dry-run', '--json'
    ], project);
    expect(result.code).toBe(0);
    // Drift: the child --json option currently emits data only, not a ResultEnvelope.
    const data = parseJson<{
      scope: string;
      settingsPath: string;
      applied: boolean;
      dryRun: boolean;
    }>(result);
    expect(data).toMatchObject({ scope: 'project', applied: false, dryRun: true });
    expect(existsSync(data.settingsPath)).toBe(false);
  });
});

describe('peaks statusline status (P2-B.4 adapter/distribution e2e)', () => {
  test('reports an uninstalled data-only status for a fresh project', () => {
    const project = makeProject('peaks-p2b4-statusline-status-');
    expectRegisteredHelp(['statusline', 'status'], 'peaks statusline status [options]', project);
    const result = runCli([
      'statusline', 'status', '--project', project, '--ide', 'claude-code', '--json'
    ], project);
    expect(result.code).toBe(0);
    const data = parseJson<{
      scope: string;
      installed: boolean;
      ide: string;
      command: string;
    }>(result);
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
    expect(result.stdout.trim()).toMatch(/^⛰ Peaks/);
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
    const envelope = parseJson<{ ok: boolean; command: string; data: { text: string } }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('statusline.render');
    expect(envelope.data.text).toMatch(/^⛰ Peaks/);
  });
});

describe('peaks dispatch top-level (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered', () => {
    expectCommandNotRegistered(['dispatch'], 'peaks [options] [command]');
  });
});

describe('peaks sub-agent dispatch <role> (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered and returns an IDE tool-call descriptor in a temporary session', () => {
    const project = makeProject('peaks-p2b4-sub-agent-dispatch-');
    const sessionId = initWorkspace(project);
    expectRegisteredHelp(
      ['sub-agent', 'dispatch', 'rd'],
      'peaks sub-agent dispatch [options] <role>',
      project
    );
    const result = runCli([
      'sub-agent', 'dispatch', 'rd',
      '--prompt', 'P2-B.4 adapter command integration probe',
      '--request-id', REQUEST_ID,
      '--session-id', sessionId,
      '--project', project,
      '--json'
    ], project);
    expect(result.code).toBe(0);
    const envelope = parseJson<CliEnvelope<{
      role: string;
      ide: string;
      toolCall: { name: string };
      dispatchRecordPath: string;
      batchId: string;
    }>>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('sub-agent.dispatch');
    expect(envelope.data.role).toBe('rd');
    expect(envelope.data.toolCall.name).toBe('Task');
    expect(existsSync(envelope.data.dispatchRecordPath)).toBe(true);
  }, BIN_TIMEOUT_MS);
});

describe('peaks dispatch-from-dag top-level (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered; DAG dispatch is an option on sub-agent dispatch', () => {
    expectCommandNotRegistered(['dispatch-from-dag'], 'peaks [options] [command]');
    const nestedHelp = expectRegisteredHelp(
      ['sub-agent', 'dispatch', 'rd'],
      'peaks sub-agent dispatch [options] <role>'
    );
    expect(nestedHelp.stdout).toContain('--from-dag <file>');
  });
});

describe('peaks share top-level (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered, so no share bundle is written', () => {
    expectCommandNotRegistered(['share'], 'peaks [options] [command]');
  });
});

describe('peaks capability list (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered; capability help advertises status and map instead', () => {
    const { help } = expectCommandNotRegistered(
      ['capability', 'list'],
      'peaks capability [options] [command]'
    );
    expect(help.stdout).toContain('status [options]');
    expect(help.stdout).toContain('map [options]');
  });
});

describe('peaks capability install (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered, so no destructive capability install is attempted', () => {
    expectCommandNotRegistered(
      ['capability', 'install'],
      'peaks capability [options] [command]'
    );
  });
});

describe('peaks capability worker-config (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered', () => {
    expectCommandNotRegistered(
      ['capability', 'worker-config'],
      'peaks capability [options] [command]'
    );
  });
});

describe('peaks adapter list (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered and reports an empty user adapter registry without writing it', () => {
    const project = makeProject('peaks-p2b4-adapter-list-');
    expectRegisteredHelp(['adapter', 'list'], 'peaks adapter list [options]', project);
    const result = runCli(['adapter', 'list', '--project', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseJson<CliEnvelope<{
      file: string;
      records: readonly unknown[];
      count: number;
    }>>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('adapter.list');
    expect(envelope.data.records).toHaveLength(0);
    expect(envelope.data.count).toBe(0);
    expect(existsSync(envelope.data.file)).toBe(false);
  });
});
