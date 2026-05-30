import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';
import { registerSop } from '../../src/services/sop/sop-registry-service.js';
import type { SopManifest } from '../../src/services/sop/sop-types.js';

// gate enforce reads its payload from PEAKS_HOOK_STDIN (the documented test seam).
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
    id: 'wechat', name: 'wechat', phases: ['draft', 'publish'],
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

describe('peaks gate enforce', () => {
  test('emits a deny decision when a guarded command has a failing gate', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');
    const result = await runCommand(['gate', 'enforce', '--project', project], stdin('git push origin main'));
    const out = JSON.parse(result.stdout.join('\n')) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/no-todo/);
  });

  test('emits nothing (allow) when the gate passes', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'all clean\n', 'utf8');
    const result = await runCommand(['gate', 'enforce', '--project', project], stdin('git push'));
    expect(result.stdout.join('').trim()).toBe('');
  });

  test('emits nothing for a non-Bash tool', async () => {
    await seedWechat();
    const result = await runCommand(['gate', 'enforce', '--project', project], stdin('whatever', 'Edit'));
    expect(result.stdout.join('').trim()).toBe('');
  });

  test('emits nothing for an unguarded command', async () => {
    await seedWechat();
    const result = await runCommand(['gate', 'enforce', '--project', project], stdin('ls -la'));
    expect(result.stdout.join('').trim()).toBe('');
  });

  test('fail-open: malformed hook payload does not crash or deny', async () => {
    await seedWechat();
    const result = await runCommand(['gate', 'enforce', '--project', project], { PEAKS_HOOK_STDIN: '{ not json' });
    expect(result.stdout.join('').trim()).toBe(''); // no deny emitted → allowed
    expect(result.exitCode).toBeUndefined();
  });

  test('--json emits the debug envelope to stderr on deny', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');
    const result = await runCommand(['gate', 'enforce', '--project', project, '--json'], stdin('git push'));
    // Hook decision still on stdout; debug envelope on stderr.
    expect(JSON.parse(result.stdout.join('\n')).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(result.stderr.join('')).toMatch(/gate\.enforce/);
  });

  test('--json emits an allow/skip envelope to stderr for a non-Bash tool', async () => {
    await seedWechat();
    const result = await runCommand(['gate', 'enforce', '--project', project, '--json'], stdin('x', 'Edit'));
    expect(JSON.parse(result.stdout.join('\n')).data.skipped).toBe(true);
  });
});

describe('peaks gate bypass + enforce closure', () => {
  test('a recorded bypass lets the next guarded command through once', async () => {
    await seedWechat();
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');

    const bypass = await runCommand(['gate', 'bypass', '--sop', 'wechat', '--phase', 'publish', '--reason', 'hotfix', '--project', project, '--json']);
    expect(parseJsonOutput(bypass.stdout).ok).toBe(true);

    // First guarded command after bypass → allowed (no deny output).
    const first = await runCommand(['gate', 'enforce', '--project', project], stdin('git push'));
    expect(first.stdout.join('').trim()).toBe('');

    // Token consumed → next guarded command denied again.
    const second = await runCommand(['gate', 'enforce', '--project', project], stdin('git push'));
    const out = JSON.parse(second.stdout.join('\n')) as { hookSpecificOutput: { permissionDecision: string } };
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  test('bypass rejects an empty reason', async () => {
    await seedWechat();
    const result = await runCommand(['gate', 'bypass', '--sop', 'wechat', '--phase', 'publish', '--reason', '   ', '--project', project, '--json']);
    const out = parseJsonOutput(result.stdout);
    expect(out.ok).toBe(false);
    expect(out.code).toBe('BYPASS_REASON_REQUIRED');
  });

  test('bypass enforces the per-SOP cap', async () => {
    await seedWechat();
    for (let i = 0; i < 3; i += 1) {
      const ok = await runCommand(['gate', 'bypass', '--sop', 'wechat', '--phase', 'publish', '--reason', 'x', '--project', project, '--json']);
      expect(parseJsonOutput(ok.stdout).ok).toBe(true);
    }
    const capped = await runCommand(['gate', 'bypass', '--sop', 'wechat', '--phase', 'publish', '--reason', 'x', '--project', project, '--json']);
    const out = parseJsonOutput(capped.stdout);
    expect(out.ok).toBe(false);
    expect(out.code).toBe('BYPASS_LIMIT_REACHED');
  });
});
