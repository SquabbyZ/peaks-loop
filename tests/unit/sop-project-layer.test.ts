import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { initSop, lintSop, readSopManifest } from '../../src/services/sop/sop-service.js';
import { registerSop, readRegistry } from '../../src/services/sop/sop-registry-service.js';
import { enforceBashCommand } from '../../src/services/sop/gate-enforce-service.js';
import type { SopManifest } from '../../src/services/sop/sop-types.js';

// Slice 2: SOPs can live in the repo (<project>/.peaks/sops, committed) so a
// teammate who clones — and has nothing in their global ~/.peaks — is enforced.
let peaksHome: string;
let project: string;
let savedPeaksHome: string | undefined;

beforeEach(async () => {
  savedPeaksHome = process.env.PEAKS_HOME;
  peaksHome = await mkdtemp(join(tmpdir(), 'peaks-home-'));
  project = await mkdtemp(join(tmpdir(), 'peaks-proj-'));
  process.env.PEAKS_HOME = peaksHome;
});

afterEach(() => {
  if (savedPeaksHome === undefined) delete process.env.PEAKS_HOME;
  else process.env.PEAKS_HOME = savedPeaksHome;
});

function guardedManifest(id: string, todoMarker: string): SopManifest {
  return {
    id, name: id, phases: ['draft', 'publish'],
    gates: [{ id: 'no-todo', phase: 'publish', check: { type: 'grep', file: 'posts/current.md', pattern: todoMarker, absent: true } }],
    guards: [{ phase: 'publish', bash: 'git +push' }]
  };
}

describe('init/register into the project layer', () => {
  test('init --project writes into <project>/.peaks/sops, not global', async () => {
    const result = await initSop({ id: 'team-release', apply: true, projectRoot: project });
    expect(result.manifestPath.startsWith(project)).toBe(true);
    expect(existsSync(join(project, '.peaks', 'sops', 'team-release', 'sop.json'))).toBe(true);
    expect(existsSync(join(peaksHome, 'sops', 'team-release', 'sop.json'))).toBe(false);
  });

  test('register --project writes the project registry and reports scope', async () => {
    await writeFile(await seedProjectManifest('team-release'), JSON.stringify(guardedManifest('team-release', 'TODO')), 'utf8');
    const result = await registerSop({ id: 'team-release', projectRoot: project });
    expect(result.scope).toBe('project');
    expect(existsSync(join(project, '.peaks', 'sops', 'registry.json'))).toBe(true);
    expect(existsSync(join(peaksHome, 'sops', 'registry.json'))).toBe(false);
  });

  async function seedProjectManifest(id: string): Promise<string> {
    const dir = join(project, '.peaks', 'sops', id);
    await mkdir(dir, { recursive: true });
    return join(dir, 'sop.json');
  }
});

describe('precedence: project wins over global for the same id', () => {
  async function seedManifestAt(root: string, id: string, manifest: SopManifest): Promise<void> {
    const dir = join(root, 'sops', id);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'sop.json'), JSON.stringify(manifest), 'utf8');
  }

  test('readSopManifest returns the project manifest when both layers exist', async () => {
    await seedManifestAt(peaksHome, 'dup', { id: 'dup', name: 'global', phases: ['p'], gates: [] });
    await seedManifestAt(join(project, '.peaks'), 'dup', { id: 'dup', name: 'project', phases: ['p'], gates: [] });
    expect((await readSopManifest('dup', project))?.name).toBe('project');
    // Without a projectRoot, only global is seen.
    expect((await readSopManifest('dup'))?.name).toBe('global');
  });

  test('readRegistry merges, with the project entry winning by id', async () => {
    // global has "shared" + "personal"; project re-registers "shared" + adds "team".
    await seedManifestAt(peaksHome, 'shared', { id: 'shared', name: 'g', phases: ['p'], gates: [{ id: 'g1', phase: 'p', check: { type: 'file-exists', path: 'a' } }] });
    await registerSop({ id: 'shared' });
    await seedManifestAt(peaksHome, 'personal', { id: 'personal', name: 'g', phases: ['p'], gates: [] });
    await registerSop({ id: 'personal' });
    await seedManifestAt(join(project, '.peaks'), 'shared', { id: 'shared', name: 'p', phases: ['p'], gates: [{ id: 'g1', phase: 'p', check: { type: 'file-exists', path: 'a' } }, { id: 'g2', phase: 'p', check: { type: 'file-exists', path: 'b' } }] });
    await registerSop({ id: 'shared', projectRoot: project });
    await seedManifestAt(join(project, '.peaks'), 'team', { id: 'team', name: 'p', phases: ['p'], gates: [] });
    await registerSop({ id: 'team', projectRoot: project });

    const merged = await readRegistry(project);
    expect(merged.sops.map((s) => s.id)).toEqual(['personal', 'shared', 'team']);
    // The "shared" entry is the project one (2 gates), not the global one (1 gate).
    expect(merged.sops.find((s) => s.id === 'shared')!.gates).toHaveLength(2);
  });
});

describe('team enforcement: a teammate with ONLY the repo is enforced', () => {
  test('a project-layer guarded SOP denies git push even with an empty global home', async () => {
    // Simulate a fresh clone: global ~/.peaks is empty; the repo carries the SOP.
    const dir = join(project, '.peaks', 'sops', 'release');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'sop.json'), JSON.stringify(guardedManifest('release', 'TODO')), 'utf8');
    await registerSop({ id: 'release', projectRoot: project });

    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');

    // Nothing in global — enforcement still fires from the project layer.
    expect(existsSync(join(peaksHome, 'sops', 'registry.json'))).toBe(false);
    const decision = await enforceBashCommand(project, 'git push origin main');
    expect(decision.decision).toBe('deny');

    // Clean the marker → allowed.
    await writeFile(join(project, 'posts', 'current.md'), 'clean\n', 'utf8');
    expect((await enforceBashCommand(project, 'git push')).decision).toBe('allow');
  });

  test('lint --project validates the repo-layer manifest', async () => {
    const dir = join(project, '.peaks', 'sops', 'release');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'sop.json'), JSON.stringify(guardedManifest('release', 'TODO')), 'utf8');
    expect((await lintSop({ id: 'release', projectRoot: project }))?.ok).toBe(true);
    // The same id is absent from global.
    expect(await lintSop({ id: 'release' })).toBeNull();
  });
});
