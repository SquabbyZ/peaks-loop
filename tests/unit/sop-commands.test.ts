import { existsSync } from 'node:fs';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getMockedHomeDir, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';
import { readRegistry } from '../../src/services/sop/sop-registry-service.js';

const homeDir = getMockedHomeDir();

// SOP definitions + registry are global under the (mocked) home. Clean that
// global state before each test so a reused SOP id does not leak across tests.
async function resetGlobalSops(): Promise<void> {
  await rm(join(homeDir, '.peaks', 'sops'), { recursive: true, force: true });
}

async function makeProject(name: string): Promise<string> {
  const project = join(homeDir, name);
  if (existsSync(project)) {
    await rm(project, { recursive: true, force: true });
  }
  await mkdir(project, { recursive: true });
  return project;
}

/** Global manifest path for a SOP id (definitions live under the home). */
function manifestPathFor(id: string): string {
  return join(homeDir, '.peaks', 'sops', id, 'sop.json');
}

describe('peaks sop init command', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await resetGlobalSops();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('previews without writing, and reports the apply next-action (AC1)', async () => {
    const result = await runCommand(['sop', 'init', '--id', 'team-release', '--json']);
    const output = parseJsonOutput<{ applied: boolean; manifestPath: string }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.command).toBe('sop.init');
    expect(output.data.applied).toBe(false);
    expect(existsSync(output.data.manifestPath)).toBe(false);
    expect(output.nextActions?.[0]).toMatch(/Re-run with --apply/);
  });

  test('writes the SOP into the global home and returns edit/lint next-actions (AC1, AC6)', async () => {
    const result = await runCommand(['sop', 'init', '--id', 'team-release', '--apply', '--json']);
    const output = parseJsonOutput<{ applied: boolean; manifestPath: string; skillPath: string }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.applied).toBe(true);
    expect(output.data.manifestPath.startsWith(homeDir)).toBe(true);
    expect(existsSync(output.data.manifestPath)).toBe(true);
    expect(existsSync(output.data.skillPath)).toBe(true);
    // Applied scaffold points the user at the next steps.
    expect(output.nextActions?.some((a) => /Edit .*sop\.json/.test(a))).toBe(true);
    expect(output.nextActions?.some((a) => /sop lint/.test(a))).toBe(true);
  });

  test('honors --name in the scaffolded manifest', async () => {
    const result = await runCommand(['sop', 'init', '--id', 'team-release', '--name', 'Team Release', '--apply', '--json']);
    const output = parseJsonOutput<{ manifest: { name: string } }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.manifest.name).toBe('Team Release');
  });

  test('fails with a stable code on a reserved id', async () => {
    const result = await runCommand(['sop', 'init', '--id', 'peaks-rd', '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOP_INIT_FAILED');
    expect(result.exitCode).toBe(1);
  });
});

describe('peaks sop lint command', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await resetGlobalSops();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('passes for a freshly scaffolded SOP (AC1)', async () => {
    await runCommand(['sop', 'init', '--id', 'team-release', '--apply', '--json']);
    const result = await runCommand(['sop', 'lint', '--id', 'team-release', '--json']);
    const output = parseJsonOutput<{ ok: boolean; gateCount: number; gateIds: string[] }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.gateCount).toBe(1);
    expect(output.data.gateIds).toEqual(['example-gate']);
  });

  test('returns SOP_NOT_FOUND for a missing SOP', async () => {
    const result = await runCommand(['sop', 'lint', '--id', 'ghost', '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOP_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('fails with SOP_LINT_FAILED and exit 1 when a command gate is not allowed', async () => {
    await runCommand(['sop', 'init', '--id', 'team-release', '--apply', '--json']);
    // Rewrite the (global) manifest to include a command gate.
    await writeFile(manifestPathFor('team-release'), JSON.stringify({
      id: 'team-release', name: 'team-release', phases: ['build'],
      gates: [{ id: 'tests', phase: 'build', check: { type: 'command', run: ['npm', 'test'] } }]
    }), 'utf8');

    const blocked = await runCommand(['sop', 'lint', '--id', 'team-release', '--json']);
    const blockedOut = parseJsonOutput(blocked.stdout);
    expect(blockedOut.ok).toBe(false);
    expect(blockedOut.code).toBe('SOP_LINT_FAILED');
    expect(blocked.exitCode).toBe(1);

    const allowed = await runCommand(['sop', 'lint', '--id', 'team-release', '--allow-commands', '--json']);
    expect(parseJsonOutput(allowed.stdout).ok).toBe(true);
  });

  test('accepts a grep absent gate (AC3)', async () => {
    await runCommand(['sop', 'init', '--id', 'blog-publish', '--apply', '--json']);
    await writeFile(manifestPathFor('blog-publish'), JSON.stringify({
      id: 'blog-publish', name: 'blog-publish', phases: ['draft', 'publish'],
      gates: [{ id: 'no-todo', phase: 'publish', check: { type: 'grep', file: 'post.md', pattern: 'TODO', absent: true } }]
    }), 'utf8');
    const result = await runCommand(['sop', 'lint', '--id', 'blog-publish', '--json']);
    expect(parseJsonOutput(result.stdout).ok).toBe(true);
  });
});

describe('peaks sop register / registry commands', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await resetGlobalSops();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('register records the SOP and registry enumerates it (AC4, AC10)', async () => {
    await runCommand(['sop', 'init', '--id', 'team-release', '--apply', '--json']);

    const reg = await runCommand(['sop', 'register', '--id', 'team-release', '--json']);
    const regOut = parseJsonOutput<{ gateCount: number }>(reg.stdout);
    expect(regOut.ok).toBe(true);
    expect(regOut.data.gateCount).toBe(1);

    const list = await runCommand(['sop', 'registry', '--json']);
    const listOut = parseJsonOutput<{ gateCount: number; sops: Array<{ id: string }> }>(list.stdout);
    expect(listOut.ok).toBe(true);
    expect(listOut.data.gateCount).toBe(1);
    expect(listOut.data.sops.map((s) => s.id)).toEqual(['team-release']);
  });

  test('register --dry-run previews without writing the registry (AC9)', async () => {
    await runCommand(['sop', 'init', '--id', 'team-release', '--apply', '--json']);
    const reg = await runCommand(['sop', 'register', '--id', 'team-release', '--dry-run', '--json']);
    const regOut = parseJsonOutput<{ applied: boolean }>(reg.stdout);
    expect(regOut.ok).toBe(true);
    expect(regOut.data.applied).toBe(false);
    // Registry stays empty after a dry-run.
    const list = await runCommand(['sop', 'registry', '--json']);
    expect(parseJsonOutput<{ gateCount: number }>(list.stdout).data.gateCount).toBe(0);
  });

  test('register --allow-commands validates a command-gate SOP', async () => {
    await runCommand(['sop', 'init', '--id', 'cmd-sop', '--apply', '--json']);
    await writeFile(manifestPathFor('cmd-sop'), JSON.stringify({
      id: 'cmd-sop', name: 'cmd-sop', phases: ['build'],
      gates: [{ id: 'tests', phase: 'build', check: { type: 'command', run: ['true'] } }]
    }), 'utf8');
    // Without --allow-commands the SOP is unregistrable.
    const blocked = await runCommand(['sop', 'register', '--id', 'cmd-sop', '--json']);
    expect(parseJsonOutput(blocked.stdout).ok).toBe(false);
    // With --allow-commands it registers.
    const ok = await runCommand(['sop', 'register', '--id', 'cmd-sop', '--allow-commands', '--json']);
    expect(parseJsonOutput<{ gateCount: number }>(ok.stdout).data.gateCount).toBe(1);
  });

  test('register fails with a stable code on an unregistrable SOP', async () => {
    const result = await runCommand(['sop', 'register', '--id', 'ghost', '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOP_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('registry on a fresh home is empty', async () => {
    const result = await runCommand(['sop', 'registry', '--json']);
    const output = parseJsonOutput<{ gateCount: number; sops: unknown[] }>(result.stdout);
    expect(output.data.gateCount).toBe(0);
    expect(output.data.sops).toEqual([]);
  });

  test('registry without --project defaults to cwd and merges the project layer when present (AC6)', async () => {
    // Seed a project with a registry entry but NO matching global entry, so
    // the assertion distinguishes merged-view (contains the project entry)
    // from global-only (empty).
    const project = await makeProject('sop-registry-cwd-default');
    await mkdir(join(project, '.peaks', 'sops'), { recursive: true });
    await writeFile(
      join(project, '.peaks', 'sops', 'registry.json'),
      JSON.stringify({ sops: [{ id: 'cwd-only', scope: 'project', gates: [] }], updatedAt: new Date().toISOString() }),
      'utf8'
    );

    // Run the CLI from the project root, no --project flag. With the default
    // value in place, this is equivalent to passing --project <cwd>.
    const previousCwd = process.cwd();
    process.chdir(project);
    try {
      const noFlag = await runCommand(['sop', 'registry', '--json']);
      expect(parseJsonOutput<{ sops: Array<{ id: string }> }>(noFlag.stdout).data.sops.map((s) => s.id))
        .toContain('cwd-only');

      // And it should match the explicit --project <cwd> behavior.
      const explicit = await runCommand(['sop', 'registry', '--project', project, '--json']);
      expect(parseJsonOutput<{ sops: Array<{ id: string }> }>(explicit.stdout).data.sops.map((s) => s.id))
        .toContain('cwd-only');
    } finally {
      process.chdir(previousCwd);
    }

    // Service-level guard: readRegistry(<project>) returns the same merged
    // shape that the CLI now produces by default.
    const merged = await readRegistry(project);
    expect(merged.sops.map((s) => s.id)).toContain('cwd-only');
  });

  test('init/register --project use the repo layer and registry --project merges it', async () => {
    const project = await makeProject('sop-project-layer');
    // Global SOP.
    await runCommand(['sop', 'init', '--id', 'personal', '--apply', '--json']);
    await runCommand(['sop', 'register', '--id', 'personal', '--json']);
    // Project (repo) SOP.
    const init = await runCommand(['sop', 'init', '--id', 'team-release', '--project', project, '--apply', '--json']);
    expect(parseJsonOutput<{ manifestPath: string }>(init.stdout).data.manifestPath).toContain(join('.peaks', 'sops', 'team-release'));
    const reg = await runCommand(['sop', 'register', '--id', 'team-release', '--project', project, '--json']);
    expect(parseJsonOutput<{ scope: string }>(reg.stdout).data.scope).toBe('project');
    expect(existsSync(join(project, '.peaks', 'sops', 'registry.json'))).toBe(true);

    // Merged registry (--project) shows both; global-only shows just personal.
    const merged = await runCommand(['sop', 'registry', '--project', project, '--json']);
    expect(parseJsonOutput<{ sops: Array<{ id: string }> }>(merged.stdout).data.sops.map((s) => s.id)).toEqual(['personal', 'team-release']);
    const globalOnly = await runCommand(['sop', 'registry', '--json']);
    expect(parseJsonOutput<{ sops: Array<{ id: string }> }>(globalOnly.stdout).data.sops.map((s) => s.id)).toEqual(['personal']);
  });

  test('registry fails with SOP_REGISTRY_FAILED on a corrupt registry file', async () => {
    await mkdir(join(homeDir, '.peaks', 'sops'), { recursive: true });
    await writeFile(join(homeDir, '.peaks', 'sops', 'registry.json'), '{ not valid json', 'utf8');
    const result = await runCommand(['sop', 'registry', '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOP_REGISTRY_FAILED');
    expect(result.exitCode).toBe(1);
  });
});

describe('peaks sop check command', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await resetGlobalSops();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns a pass/fail verdict with ok:true (evaluates against --project)', async () => {
    const project = await makeProject('sop-check');
    await runCommand(['sop', 'init', '--id', 'team-release', '--apply', '--json']);
    // The scaffold's example-gate checks file-exists README.md, absent in the project → fail (still ok:true).
    const result = await runCommand(['sop', 'check', '--id', 'team-release', '--gate', 'example-gate', '--project', project, '--json']);
    const output = parseJsonOutput<{ result: string }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.command).toBe('sop.check');
    expect(output.data.result).toBe('fail');
  });

  test('returns GATE_NOT_FOUND (ok:false) for an unknown gate', async () => {
    const project = await makeProject('sop-check-missing');
    await runCommand(['sop', 'init', '--id', 'team-release', '--apply', '--json']);
    const result = await runCommand(['sop', 'check', '--id', 'team-release', '--gate', 'nope', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('GATE_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('--allow-commands lets a command gate evaluate (blocked → pass)', async () => {
    const project = await makeProject('sop-check-cmd');
    await runCommand(['sop', 'init', '--id', 'cmd-sop', '--apply', '--json']);
    await writeFile(manifestPathFor('cmd-sop'), JSON.stringify({
      id: 'cmd-sop', name: 'cmd-sop', phases: ['p'],
      gates: [{ id: 'ok', phase: 'p', check: { type: 'command', run: [process.execPath, '-e', 'process.exit(0)'] } }]
    }), 'utf8');
    // Refused without the flag.
    const blocked = await runCommand(['sop', 'check', '--id', 'cmd-sop', '--gate', 'ok', '--project', project, '--json']);
    expect(parseJsonOutput<{ result: string }>(blocked.stdout).data.result).toBe('blocked');
    // Evaluated (and passes) with the flag.
    const allowed = await runCommand(['sop', 'check', '--id', 'cmd-sop', '--gate', 'ok', '--project', project, '--allow-commands', '--json']);
    expect(parseJsonOutput<{ result: string }>(allowed.stdout).data.result).toBe('pass');
  });
});

describe('peaks sop advance command (gates + phase order truly block)', () => {
  beforeEach(async () => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    await resetGlobalSops();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A single-phase SOP whose only phase 'ship' is guarded by a file-exists gate.
  // Single phase keeps the gate (not phase-order) the thing under test.
  async function seedGatedSop(): Promise<void> {
    await runCommand(['sop', 'init', '--id', 'team-release', '--apply', '--json']);
    await writeFile(manifestPathFor('team-release'), JSON.stringify({
      id: 'team-release', name: 'team-release', phases: ['ship'],
      gates: [{ id: 'changelog', phase: 'ship', check: { type: 'file-exists', path: 'CHANGELOG.md' } }]
    }), 'utf8');
  }

  function stateFile(project: string): string {
    return join(project, '.peaks', 'sop-state', 'team-release', 'state.json');
  }

  test('advancing into a phase with a failing gate is blocked (SOP_GATE_BLOCKED, exit 1)', async () => {
    const project = await makeProject('sop-advance-block');
    await seedGatedSop();
    const result = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--json']);
    const output = parseJsonOutput<{ blockedGates: Array<{ gateId: string }> }>(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOP_GATE_BLOCKED');
    expect(output.data.blockedGates.map((g) => g.gateId)).toEqual(['changelog']);
    expect(result.exitCode).toBe(1);
  });

  test('advances once the gate is satisfied', async () => {
    const project = await makeProject('sop-advance-pass');
    await seedGatedSop();
    await writeFile(join(project, 'CHANGELOG.md'), '# changes\n', 'utf8');
    const result = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--json']);
    const output = parseJsonOutput<{ phase: string }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.phase).toBe('ship');
  });

  test('jumping past the next phase is blocked (SOP_PHASE_SKIP, exit 1) (AC5)', async () => {
    const project = await makeProject('sop-advance-skip');
    await runCommand(['sop', 'init', '--id', 'wf', '--apply', '--json']);
    await writeFile(manifestPathFor('wf'), JSON.stringify({
      id: 'wf', name: 'wf', phases: ['draft', 'review', 'publish'], gates: []
    }), 'utf8');
    const result = await runCommand(['sop', 'advance', '--id', 'wf', '--to', 'publish', '--project', project, '--json']);
    const output = parseJsonOutput<{ expectedNext: string }>(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOP_PHASE_SKIP');
    expect(output.data.expectedNext).toBe('draft');
    expect(result.exitCode).toBe(1);
  });

  test('a forward skip can be forced with --allow-incomplete --reason (AC5)', async () => {
    const project = await makeProject('sop-advance-skip-bypass');
    await runCommand(['sop', 'init', '--id', 'wf', '--apply', '--json']);
    await writeFile(manifestPathFor('wf'), JSON.stringify({
      id: 'wf', name: 'wf', phases: ['draft', 'review', 'publish'], gates: []
    }), 'utf8');
    const result = await runCommand(['sop', 'advance', '--id', 'wf', '--to', 'publish', '--project', project, '--allow-incomplete', '--reason', 'skip review', '--json']);
    const output = parseJsonOutput<{ phase: string; bypassed: boolean }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.phase).toBe('publish');
    expect(output.data.bypassed).toBe(true);
  });

  test('--allow-incomplete requires --reason', async () => {
    const project = await makeProject('sop-advance-noreason');
    await seedGatedSop();
    const result = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--allow-incomplete', '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('BYPASS_REASON_REQUIRED');
  });

  test('--allow-incomplete with --reason bypasses the gate', async () => {
    const project = await makeProject('sop-advance-bypass');
    await seedGatedSop();
    const result = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--allow-incomplete', '--reason', 'hotfix', '--json']);
    const output = parseJsonOutput<{ phase: string; bypassed: boolean }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.bypassed).toBe(true);
  });

  test('in assisted mode a bypass requires --confirm (presence read from --project)', async () => {
    const project = await makeProject('sop-advance-assisted');
    await seedGatedSop();
    await mkdir(join(project, '.peaks'), { recursive: true });
    await writeFile(join(project, '.peaks', '.active-skill.json'), JSON.stringify({ skill: 'team-release', mode: 'assisted', setAt: '2026-05-28T00:00:00Z' }), 'utf8');

    const restricted = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--allow-incomplete', '--reason', 'x', '--json']);
    expect(parseJsonOutput(restricted.stdout).code).toBe('ALLOW_INCOMPLETE_RESTRICTED');

    const confirmed = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--allow-incomplete', '--reason', 'x', '--confirm', '--json']);
    expect(parseJsonOutput(confirmed.stdout).ok).toBe(true);
  });

  test('advance --dry-run previews a passing advance without recording state (AC9)', async () => {
    const project = await makeProject('sop-advance-dryrun');
    await seedGatedSop();
    await writeFile(join(project, 'CHANGELOG.md'), '# changes\n', 'utf8');
    const result = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--dry-run', '--json']);
    const output = parseJsonOutput<{ applied: boolean; phase: string }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.applied).toBe(false);
    expect(output.data.phase).toBe('ship');
    expect(existsSync(stateFile(project))).toBe(false);
  });

  test('--allow-commands lets a passing command gate advance', async () => {
    const project = await makeProject('sop-advance-cmd');
    await runCommand(['sop', 'init', '--id', 'cmd-sop', '--apply', '--json']);
    await writeFile(manifestPathFor('cmd-sop'), JSON.stringify({
      id: 'cmd-sop', name: 'cmd-sop', phases: ['ship'],
      gates: [{ id: 'ok', phase: 'ship', check: { type: 'command', run: [process.execPath, '-e', 'process.exit(0)'] } }]
    }), 'utf8');
    const result = await runCommand(['sop', 'advance', '--id', 'cmd-sop', '--to', 'ship', '--project', project, '--allow-commands', '--json']);
    expect(parseJsonOutput<{ phase: string }>(result.stdout).data.phase).toBe('ship');
  });

  test('in assisted mode the per-project bypass cap is enforced', async () => {
    const project = await makeProject('sop-advance-cap');
    await seedGatedSop();
    await mkdir(join(project, '.peaks'), { recursive: true });
    await writeFile(join(project, '.peaks', '.active-skill.json'), JSON.stringify({ skill: 'team-release', mode: 'assisted', setAt: '2026-05-28T00:00:00Z' }), 'utf8');

    // The cap is MAX_BYPASSES_PER_SESSION (3): three confirmed bypasses succeed.
    for (let i = 0; i < 3; i += 1) {
      const ok = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--allow-incomplete', '--reason', 'x', '--confirm', '--json']);
      expect(parseJsonOutput(ok.stdout).ok).toBe(true);
    }
    // The fourth is refused with a stable code.
    const capped = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'ship', '--project', project, '--allow-incomplete', '--reason', 'x', '--confirm', '--json']);
    const output = parseJsonOutput(capped.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('BYPASS_LIMIT_REACHED');
  });

  test('INVALID_PHASE for an unknown phase', async () => {
    const project = await makeProject('sop-advance-badphase');
    await seedGatedSop();
    const result = await runCommand(['sop', 'advance', '--id', 'team-release', '--to', 'nope', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_PHASE');
  });
});
