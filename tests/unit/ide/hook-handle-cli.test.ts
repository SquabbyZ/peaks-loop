import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from '../cli-program-test-utils.js';
import { registerSop } from '../../../src/services/sop/sop-registry-service.js';
import type { SopManifest } from '../../../src/services/sop/sop-types.js';

let peaksHome: string;
let project: string;
let savedPeaksHome: string | undefined;

beforeEach(async () => {
  process.exitCode = undefined;
  resetCliProgramMocks();
  writeUserConfig();
  savedPeaksHome = process.env.PEAKS_HOME;
  peaksHome = await mkdtemp(join(tmpdir(), 'peaks-home-'));
  project = await mkdtemp(join(tmpdir(), 'peaks-proj-'));
  process.env.PEAKS_HOME = peaksHome;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (savedPeaksHome === undefined) {
    delete process.env.PEAKS_HOME;
  } else {
    process.env.PEAKS_HOME = savedPeaksHome;
  }
});

async function seedWechat(): Promise<void> {
  const manifest: SopManifest = {
    id: 'wechat',
    name: 'wechat',
    phases: ['draft', 'publish'],
    gates: [
      { id: 'no-todo', phase: 'publish', check: { type: 'grep', file: 'posts/current.md', pattern: 'TODO', absent: true } }
    ],
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

describe('peaks hook handle — Bash dispatch', () => {
  test('emits a deny decision on stdout for a guarded command with a failing gate', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');
    const result = await runCommand(['hook', 'handle', '--project', project], stdin('git push origin main'));
    const out = JSON.parse(result.stdout.join('\n')) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/no-todo/);
  });

  test('emits nothing on stdout when the gate passes (allow)', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'all clean\n', 'utf8');
    const result = await runCommand(['hook', 'handle', '--project', project], stdin('git push'));
    expect(result.stdout.join('').trim()).toBe('');
  });

  test('emits nothing on stdout for a non-Bash, non-Task tool (allow)', async () => {
    await seedWechat();
    const result = await runCommand(['hook', 'handle', '--project', project], stdin('whatever', 'Edit'));
    expect(result.stdout.join('').trim()).toBe('');
  });

  test('emits nothing on stdout for Bash with empty command (allow)', async () => {
    await seedWechat();
    const result = await runCommand(['hook', 'handle', '--project', project], stdin('', 'Bash'));
    expect(result.stdout.join('').trim()).toBe('');
  });

  test('Task tool returns allow without dispatching to gate enforce', async () => {
    await seedWechat();
    const result = await runCommand(['hook', 'handle', '--project', project], stdin('echo hi', 'Task'));
    expect(result.stdout.join('').trim()).toBe('');
  });

  test('fail-open: malformed JSON payload does not crash', async () => {
    await seedWechat();
    const result = await runCommand(['hook', 'handle', '--project', project], {
      PEAKS_HOOK_STDIN: '{ not json'
    });
    expect(result.stdout.join('').trim()).toBe('');
    expect(result.exitCode).toBeUndefined();
  });

  test('fail-open: empty stdin returns allow (no decision needed)', async () => {
    await seedWechat();
    const result = await runCommand(['hook', 'handle', '--project', project], { PEAKS_HOOK_STDIN: '' });
    expect(result.stdout.join('').trim()).toBe('');
  });

  test('--json emits a debug envelope to stderr on deny', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');
    const result = await runCommand(['hook', 'handle', '--project', project, '--json'], stdin('git push'));
    expect(JSON.parse(result.stdout.join('\n')).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(result.stderr.join('')).toMatch(/hook\.handle/);
  });

  test('--json on an allow emits a debug envelope to stdout', async () => {
    // Note: the allow path uses `printResult(io, ok(...), true)` which
    // writes to stdout (per the cli-helpers contract). The deny path
    // writes to stderr explicitly. This asymmetry is intentional in
    // slice #1; the test documents the actual behavior.
    await seedWechat();
    const result = await runCommand(['hook', 'handle', '--project', project, '--json'], stdin('ls -la'));
    expect(result.stdout.join('')).toMatch(/hook\.handle/);
    expect(result.stdout.join('')).toMatch(/allow/);
  });
});
