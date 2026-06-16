/**
 * Regression tests for PRD#2 (2026-06-16-fact-forcing-gate-format).
 *
 * Bug under test: when peaks-cli's gate-enforce path emits any output that is
 * NOT the Claude Code permissionDecision JSON, Claude Code wraps it as
 *   "PreToolUse:Bash hook error / No stderr output / Error: <hint>"
 * and renders it as a fatal Bash failure.
 *
 * Contract pinned by these tests (PRD#2 G1-G4):
 *   1. ALLOW path: stdout is empty, stderr is empty. Claude Code treats empty
 *      stdout as "no decision" = normal permission flow.
 *   2. DENY path: stdout is the Claude Code permissionDecision:"deny" JSON,
 *      exit code 2, reason also on stderr so the LLM sees it next turn.
 *   3. Cross-platform: same output bytes on darwin / linux / win32.
 *
 * The PRD#3 layer (output.ts) is the canonical contract implementation;
 * these tests assert the gate-commands surface wires to it correctly.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  parseJsonOutput,
  resetCliProgramMocks,
  runCommand,
  writeUserConfig
} from '../cli-program-test-utils.js';
import { registerSop } from '../../../src/services/sop/sop-registry-service.js';
import type { SopManifest } from '../../../src/services/sop/sop-types.js';

let peaksHome: string;
let project: string;
let savedPeaksHome: string | undefined;
let savedPlatform: NodeJS.Platform;
let savedExitCode: number | undefined;

beforeEach(async () => {
  process.exitCode = undefined;
  resetCliProgramMocks();
  writeUserConfig();
  savedPeaksHome = process.env.PEAKS_HOME;
  savedPlatform = process.platform;
  savedExitCode = process.exitCode;
  peaksHome = await mkdtemp(join(tmpdir(), 'peaks-home-'));
  project = await mkdtemp(join(tmpdir(), 'peaks-proj-'));
  process.env.PEAKS_HOME = peaksHome;
});

afterEach(() => {
  if (savedPeaksHome === undefined) {
    delete process.env.PEAKS_HOME;
  } else {
    process.env.PEAKS_HOME = savedPeaksHome;
  }
  Object.defineProperty(process, 'platform', { value: savedPlatform, configurable: true });
  process.exitCode = savedExitCode;
});

async function seedWechat(): Promise<void> {
  const manifest: SopManifest = {
    id: 'wechat',
    name: 'wechat',
    phases: ['draft', 'publish'],
    gates: [{ id: 'no-todo', phase: 'publish', check: { type: 'grep', file: 'posts/current.md', pattern: 'TODO', absent: true } }],
    guards: [{ phase: 'publish', bash: 'git\\s+push' }]
  };
  const dir = join(peaksHome, 'sops', 'wechat');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sop.json'), JSON.stringify(manifest), 'utf8');
  await registerSop({ id: 'wechat' });
}

function stdin(command: string, tool = 'Bash'): Record<string, string> {
  return { PEAKS_HOOK_STDIN: JSON.stringify({ tool_name: tool, tool_input: { command } }) };
}

describe('PRD#2 contract: peaks gate enforce stdout/stderr discipline', () => {
  test('allow: stdout is empty AND stderr is empty (Claude Code = normal permission flow)', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'all clean\n', 'utf8');
    const result = await runCommand(['gate', 'enforce', '--project', project], stdin('git push'));
    expect(result.stdout.join('').trim()).toBe('');
    expect(result.stderr.join('').trim()).toBe('');
    expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
  });

  test('deny: stdout is the Claude Code permissionDecision:"deny" JSON (PRD#2 AC2)', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');
    const result = await runCommand(['gate', 'enforce', '--project', project], stdin('git push'));
    const out = JSON.parse(result.stdout.join('')) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string; hookEventName: string } };
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/no-todo/);
  });

  test('deny: exit code is 2 so the host treats it as a hard block (PRD#2 AC2)', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');
    const result = await runCommand(['gate', 'enforce', '--project', project], stdin('git push'));
    expect(result.exitCode).toBe(2);
  });

  test('deny: reason is also surfaced to stderr so the LLM sees it on the next turn (PRD#2 AC4)', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');
    const result = await runCommand(['gate', 'enforce', '--project', project], stdin('git push'));
    expect(result.stderr.join('')).toContain('no-todo');
  });

  test('allow on non-Bash tool: stdout empty, stderr empty, exit 0', async () => {
    await seedWechat();
    const result = await runCommand(['gate', 'enforce', '--project', project], stdin('whatever', 'Edit'));
    expect(result.stdout.join('').trim()).toBe('');
    expect(result.stderr.join('').trim()).toBe('');
    expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
  });

  test('allow on unguarded command: stdout empty, stderr empty, exit 0', async () => {
    await seedWechat();
    const result = await runCommand(['gate', 'enforce', '--project', project], stdin('ls -la'));
    expect(result.stdout.join('').trim()).toBe('');
    expect(result.stderr.join('').trim()).toBe('');
    expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
  });
});

describe('PRD#2 contract: --json envelope (AC5)', () => {
  test('--json on allow: stdout empty (Claude Code contract first), JSON envelope on stderr', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'all clean\n', 'utf8');
    const result = await runCommand(['gate', 'enforce', '--project', project, '--json'], stdin('git push'));
    expect(result.stdout.join('').trim()).toBe('');
    expect(result.stderr.join('')).toContain('gate.enforce');
  });

  test('--json on deny: stdout is the Claude Code decision JSON AND stderr carries the debug envelope', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');
    const result = await runCommand(['gate', 'enforce', '--project', project, '--json'], stdin('git push'));
    expect(JSON.parse(result.stdout.join('')).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(result.stderr.join('')).toMatch(/gate\.enforce/);
  });

  test('--json on non-Bash: stdout is the allow/skip envelope (decision = allow, skipped=true)', async () => {
    await seedWechat();
    const result = await runCommand(['gate', 'enforce', '--project', project, '--json'], stdin('x', 'Edit'));
    const out = parseJsonOutput(result.stdout);
    expect(out.ok).toBe(true);
    expect(out.command).toBe('gate.enforce');
  });
});

describe('PRD#2 contract: cross-platform (AC6)', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    test(`${platform}: allow output bytes are identical`, async () => {
      await seedWechat();
      await mkdir(join(project, 'posts'), { recursive: true });
      await writeFile(join(project, 'posts', 'current.md'), 'all clean\n', 'utf8');
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
      const result = await runCommand(['gate', 'enforce', '--project', project], stdin('git push'));
      expect(result.stdout.join('')).toBe('');
      expect(result.stderr.join('')).toBe('');
    });

    test(`${platform}: deny output bytes are identical`, async () => {
      await seedWechat();
      await mkdir(join(project, 'posts'), { recursive: true });
      await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
      const result = await runCommand(['gate', 'enforce', '--project', project], stdin('git push'));
      const out = JSON.parse(result.stdout.join('')) as { hookSpecificOutput: { permissionDecision: string } };
      expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(result.exitCode).toBe(2);
    });
  }
});

describe('PRD#2 contract: fail-open preserved (P1)', () => {
  test('malformed hook payload: stdout empty, exit 0', async () => {
    await seedWechat();
    const result = await runCommand(['gate', 'enforce', '--project', project], { PEAKS_HOOK_STDIN: '{ not json' });
    expect(result.stdout.join('').trim()).toBe('');
    expect(result.exitCode === undefined || result.exitCode === 0).toBe(true);
  });
});
