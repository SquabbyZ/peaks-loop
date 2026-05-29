import { existsSync } from 'node:fs';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getMockedHomeDir, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

const homeDir = getMockedHomeDir();

async function makeProject(name: string): Promise<string> {
  const project = join(homeDir, name);
  if (existsSync(project)) {
    await rm(project, { recursive: true, force: true });
  }
  await mkdir(project, { recursive: true });
  return project;
}

describe('peaks sop init command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('previews without writing, and reports the apply next-action (AC1, AC9)', async () => {
    const project = await makeProject('sop-init-preview');
    const result = await runCommand(['sop', 'init', '--id', 'team-release', '--project', project, '--json']);
    const output = parseJsonOutput<{ applied: boolean; manifestPath: string }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.command).toBe('sop.init');
    expect(output.data.applied).toBe(false);
    expect(existsSync(output.data.manifestPath)).toBe(false);
    expect(output.nextActions?.[0]).toMatch(/Re-run with --apply/);
  });

  test('writes the SOP when --apply is passed (AC1)', async () => {
    const project = await makeProject('sop-init-apply');
    const result = await runCommand(['sop', 'init', '--id', 'team-release', '--project', project, '--apply', '--json']);
    const output = parseJsonOutput<{ applied: boolean; manifestPath: string; skillPath: string }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.applied).toBe(true);
    expect(existsSync(output.data.manifestPath)).toBe(true);
    expect(existsSync(output.data.skillPath)).toBe(true);
  });

  test('fails with a stable code on a reserved id', async () => {
    const project = await makeProject('sop-init-reserved');
    const result = await runCommand(['sop', 'init', '--id', 'peaks-rd', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOP_INIT_FAILED');
    expect(result.exitCode).toBe(1);
  });
});

describe('peaks sop lint command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('passes for a freshly scaffolded SOP (AC2)', async () => {
    const project = await makeProject('sop-lint-ok');
    await runCommand(['sop', 'init', '--id', 'team-release', '--project', project, '--apply', '--json']);
    const result = await runCommand(['sop', 'lint', '--id', 'team-release', '--project', project, '--json']);
    const output = parseJsonOutput<{ ok: boolean; gateCount: number; gateIds: string[] }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.gateCount).toBe(1);
    expect(output.data.gateIds).toEqual(['example-gate']);
  });

  test('returns SOP_NOT_FOUND for a missing SOP', async () => {
    const project = await makeProject('sop-lint-missing');
    const result = await runCommand(['sop', 'lint', '--id', 'ghost', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOP_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('fails with SOP_LINT_FAILED and exit 1 when a command gate is not allowed (AC3)', async () => {
    const project = await makeProject('sop-lint-cmd');
    await runCommand(['sop', 'init', '--id', 'team-release', '--project', project, '--apply', '--json']);
    // Rewrite the manifest to include a command gate.
    const { writeFile } = await import('node:fs/promises');
    const manifestPath = join(project, '.peaks', 'sops', 'team-release', 'sop.json');
    await writeFile(manifestPath, JSON.stringify({
      id: 'team-release', name: 'team-release', phases: ['build'],
      gates: [{ id: 'tests', phase: 'build', check: { type: 'command', run: ['npm', 'test'] } }]
    }), 'utf8');

    const blocked = await runCommand(['sop', 'lint', '--id', 'team-release', '--project', project, '--json']);
    const blockedOut = parseJsonOutput(blocked.stdout);
    expect(blockedOut.ok).toBe(false);
    expect(blockedOut.code).toBe('SOP_LINT_FAILED');
    expect(blocked.exitCode).toBe(1);

    const allowed = await runCommand(['sop', 'lint', '--id', 'team-release', '--project', project, '--allow-commands', '--json']);
    expect(parseJsonOutput(allowed.stdout).ok).toBe(true);
  });
});

describe('peaks sop register / registry commands', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('register records the SOP and registry enumerates it (AC4, AC10)', async () => {
    const project = await makeProject('sop-register');
    await runCommand(['sop', 'init', '--id', 'team-release', '--project', project, '--apply', '--json']);

    const reg = await runCommand(['sop', 'register', '--id', 'team-release', '--project', project, '--json']);
    const regOut = parseJsonOutput<{ gateCount: number }>(reg.stdout);
    expect(regOut.ok).toBe(true);
    expect(regOut.data.gateCount).toBe(1);

    const list = await runCommand(['sop', 'registry', '--project', project, '--json']);
    const listOut = parseJsonOutput<{ gateCount: number; sops: Array<{ id: string }> }>(list.stdout);
    expect(listOut.ok).toBe(true);
    expect(listOut.data.gateCount).toBe(1);
    expect(listOut.data.sops.map((s) => s.id)).toEqual(['team-release']);
  });

  test('register fails with a stable code on an unregistrable SOP', async () => {
    const project = await makeProject('sop-register-bad');
    const result = await runCommand(['sop', 'register', '--id', 'ghost', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOP_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('registry on a fresh project is empty', async () => {
    const project = await makeProject('sop-registry-empty');
    const result = await runCommand(['sop', 'registry', '--project', project, '--json']);
    const output = parseJsonOutput<{ gateCount: number; sops: unknown[] }>(result.stdout);
    expect(output.data.gateCount).toBe(0);
    expect(output.data.sops).toEqual([]);
  });
});

describe('peaks sop check command (AC6)', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns a pass/fail verdict with ok:true', async () => {
    const project = await makeProject('sop-check');
    await runCommand(['sop', 'init', '--id', 'team-release', '--project', project, '--apply', '--json']);
    // The scaffold's example-gate checks file-exists README.md, which is absent here → fail (still ok:true).
    const result = await runCommand(['sop', 'check', '--id', 'team-release', '--gate', 'example-gate', '--project', project, '--json']);
    const output = parseJsonOutput<{ result: string }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.command).toBe('sop.check');
    expect(output.data.result).toBe('fail');
  });

  test('returns GATE_NOT_FOUND (ok:false) for an unknown gate', async () => {
    const project = await makeProject('sop-check-missing');
    await runCommand(['sop', 'init', '--id', 'team-release', '--project', project, '--apply', '--json']);
    const result = await runCommand(['sop', 'check', '--id', 'team-release', '--gate', 'nope', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('GATE_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });
});

describe('peaks sop advance command (AC7 — gates truly block)', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function seedGatedSop(project: string): Promise<void> {
    await runCommand(['sop', 'init', '--id', 'team-release', '--project', project, '--apply', '--json']);
    const manifestPath = join(project, '.peaks', 'sops', 'team-release', 'sop.json');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(manifestPath, JSON.stringify({
      id: 'team-release', name: 'team-release', phases: ['draft', 'ship'],
      gates: [{ id: 'changelog', phase: 'ship', check: { type: 'file-exists', path: 'CHANGELOG.md' } }]
    }), 'utf8');
  }

  test('advancing into a phase with a failing gate is blocked (SOP_GATE_BLOCKED, exit 1)', async () => {
    const project = await makeProject('sop-advance-block');
    await seedGatedSop(project);
    const result = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--json']);
    const output = parseJsonOutput<{ blockedGates: Array<{ gateId: string }> }>(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOP_GATE_BLOCKED');
    expect(output.data.blockedGates.map((g) => g.gateId)).toEqual(['changelog']);
    expect(result.exitCode).toBe(1);
  });

  test('advances once the gate is satisfied', async () => {
    const project = await makeProject('sop-advance-pass');
    await seedGatedSop(project);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(project, 'CHANGELOG.md'), '# changes\n', 'utf8');
    const result = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--json']);
    const output = parseJsonOutput<{ phase: string }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.phase).toBe('ship');
  });

  test('--allow-incomplete requires --reason', async () => {
    const project = await makeProject('sop-advance-noreason');
    await seedGatedSop(project);
    const result = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--allow-incomplete', '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('BYPASS_REASON_REQUIRED');
  });

  test('--allow-incomplete with --reason bypasses the gate', async () => {
    const project = await makeProject('sop-advance-bypass');
    await seedGatedSop(project);
    const result = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--allow-incomplete', '--reason', 'hotfix', '--json']);
    const output = parseJsonOutput<{ phase: string; bypassed: boolean }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.bypassed).toBe(true);
  });

  test('in assisted mode a bypass requires --confirm (presence read from --project)', async () => {
    const project = await makeProject('sop-advance-assisted');
    await seedGatedSop(project);
    const { writeFile, mkdir: mkdirp } = await import('node:fs/promises');
    await mkdirp(join(project, '.peaks'), { recursive: true });
    await writeFile(join(project, '.peaks', '.active-skill.json'), JSON.stringify({ skill: 'team-release', mode: 'assisted', setAt: '2026-05-28T00:00:00Z' }), 'utf8');

    const restricted = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--allow-incomplete', '--reason', 'x', '--json']);
    expect(parseJsonOutput(restricted.stdout).code).toBe('ALLOW_INCOMPLETE_RESTRICTED');

    const confirmed = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--allow-incomplete', '--reason', 'x', '--confirm', '--json']);
    expect(parseJsonOutput(confirmed.stdout).ok).toBe(true);
  });

  test('INVALID_PHASE for an unknown phase', async () => {
    const project = await makeProject('sop-advance-badphase');
    await seedGatedSop(project);
    const result = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'nope', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_PHASE');
  });
});
