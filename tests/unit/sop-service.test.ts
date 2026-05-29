import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { initSop, lintSop, type SopLintFinding } from '../../src/services/sop/sop-service.js';
import type { SopManifest } from '../../src/services/sop/sop-types.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-sop-'));
}

async function writeManifest(project: string, id: string, manifest: unknown): Promise<void> {
  const dir = join(project, '.peaks', 'sops', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sop.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest), 'utf8');
}

function codes(findings: SopLintFinding[]): string[] {
  return findings.map((f) => f.code);
}

describe('initSop', () => {
  test('previews without writing files by default', async () => {
    const project = await makeProject();
    const result = await initSop({ projectRoot: project, id: 'team-release' });
    expect(result.applied).toBe(false);
    expect(result.manifestPath).toMatch(/[/\\]\.peaks[/\\]sops[/\\]team-release[/\\]sop\.json$/);
    expect(existsSync(result.manifestPath)).toBe(false);
    expect(result.manifest.id).toBe('team-release');
    expect(result.skillContent).toContain('name: team-release');
  });

  test('writes manifest + SKILL.md when applied', async () => {
    const project = await makeProject();
    const result = await initSop({ projectRoot: project, id: 'team-release', name: 'Team Release', apply: true });
    expect(result.applied).toBe(true);
    expect(existsSync(result.manifestPath)).toBe(true);
    expect(existsSync(result.skillPath)).toBe(true);
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as SopManifest;
    expect(manifest.name).toBe('Team Release');
    expect(manifest.phases.length).toBeGreaterThan(0);
    const skill = await readFile(result.skillPath, 'utf8');
    expect(skill).toContain('name: team-release');
  });

  test('the scaffolded SOP lints clean (round-trip)', async () => {
    const project = await makeProject();
    await initSop({ projectRoot: project, id: 'team-release', apply: true });
    const report = await lintSop({ projectRoot: project, id: 'team-release' });
    expect(report?.ok).toBe(true);
    expect(report?.gateCount).toBe(1);
    expect(report?.gateIds).toEqual(['example-gate']);
  });

  test('rejects an invalid id', async () => {
    const project = await makeProject();
    await expect(initSop({ projectRoot: project, id: 'Bad Id!' })).rejects.toThrow(/Invalid SOP id/);
  });

  test('rejects an id in the reserved peaks- namespace', async () => {
    const project = await makeProject();
    await expect(initSop({ projectRoot: project, id: 'peaks-rd' })).rejects.toThrow(/reserved built-in peaks/);
    await expect(initSop({ projectRoot: project, id: 'peaks' })).rejects.toThrow(/reserved built-in peaks/);
  });

  test('rejects re-initializing an existing SOP', async () => {
    const project = await makeProject();
    await initSop({ projectRoot: project, id: 'team-release', apply: true });
    await expect(initSop({ projectRoot: project, id: 'team-release', apply: true })).rejects.toThrow(/already exists/);
  });
});

describe('lintSop', () => {
  test('returns null when the SOP does not exist', async () => {
    const project = await makeProject();
    expect(await lintSop({ projectRoot: project, id: 'missing' })).toBeNull();
  });

  test('reports a valid manifest as ok with gate metadata', async () => {
    const project = await makeProject();
    await writeManifest(project, 'rel', {
      id: 'rel', name: 'Rel', phases: ['build', 'ship'],
      gates: [
        { id: 'docs', phase: 'ship', check: { type: 'file-exists', path: 'CHANGELOG.md' } },
        { id: 'no-fixme', phase: 'build', check: { type: 'grep', file: 'src/x.ts', pattern: 'FIXME' } }
      ]
    });
    const report = await lintSop({ projectRoot: project, id: 'rel' });
    expect(report?.ok).toBe(true);
    expect(report?.gateCount).toBe(2);
    expect(report?.gateIds).toEqual(['docs', 'no-fixme']);
  });

  test('flags invalid JSON', async () => {
    const project = await makeProject();
    await writeManifest(project, 'broken', '{ not json');
    const report = await lintSop({ projectRoot: project, id: 'broken' });
    expect(report?.ok).toBe(false);
    expect(codes(report!.findings)).toContain('INVALID_JSON');
  });

  test('flags duplicate gate ids and unknown phase bindings', async () => {
    const project = await makeProject();
    await writeManifest(project, 'rel', {
      id: 'rel', name: 'Rel', phases: ['build'],
      gates: [
        { id: 'g1', phase: 'build', check: { type: 'file-exists', path: 'a' } },
        { id: 'g1', phase: 'build', check: { type: 'file-exists', path: 'b' } },
        { id: 'g2', phase: 'nope', check: { type: 'file-exists', path: 'c' } }
      ]
    });
    const report = await lintSop({ projectRoot: project, id: 'rel' });
    expect(report?.ok).toBe(false);
    expect(codes(report!.findings)).toContain('DUPLICATE_GATE_ID');
    expect(codes(report!.findings)).toContain('GATE_PHASE_UNKNOWN');
  });

  test('flags empty and duplicate phases', async () => {
    const project = await makeProject();
    await writeManifest(project, 'a', { id: 'a', name: 'A', phases: [], gates: [] });
    expect(codes((await lintSop({ projectRoot: project, id: 'a' }))!.findings)).toContain('EMPTY_PHASES');
    await writeManifest(project, 'b', { id: 'b', name: 'B', phases: ['x', 'x'], gates: [] });
    expect(codes((await lintSop({ projectRoot: project, id: 'b' }))!.findings)).toContain('DUPLICATE_PHASE');
  });

  test('flags invalid gate id and invalid/missing check type', async () => {
    const project = await makeProject();
    await writeManifest(project, 'rel', {
      id: 'rel', name: 'Rel', phases: ['build'],
      gates: [
        { id: 'Bad Id', phase: 'build', check: { type: 'file-exists', path: 'a' } },
        { id: 'g2', phase: 'build', check: { type: 'nonsense' } }
      ]
    });
    const report = await lintSop({ projectRoot: project, id: 'rel' });
    expect(codes(report!.findings)).toContain('INVALID_GATE_ID');
    expect(codes(report!.findings)).toContain('INVALID_CHECK_TYPE');
  });

  test('flags missing required check fields per type', async () => {
    const project = await makeProject();
    await writeManifest(project, 'rel', {
      id: 'rel', name: 'Rel', phases: ['build'],
      gates: [
        { id: 'fe', phase: 'build', check: { type: 'file-exists' } },
        { id: 'gr', phase: 'build', check: { type: 'grep', file: 'x' } }
      ]
    });
    const report = await lintSop({ projectRoot: project, id: 'rel' });
    expect(report!.findings.filter((f) => f.code === 'CHECK_MISSING_FIELD')).toHaveLength(2);
  });

  test('command gates require --allow-commands', async () => {
    const project = await makeProject();
    await writeManifest(project, 'rel', {
      id: 'rel', name: 'Rel', phases: ['build'],
      gates: [{ id: 'tests', phase: 'build', check: { type: 'command', run: ['npm', 'test'] } }]
    });
    const blocked = await lintSop({ projectRoot: project, id: 'rel' });
    expect(blocked?.ok).toBe(false);
    expect(codes(blocked!.findings)).toContain('COMMAND_NOT_ALLOWED');

    const allowed = await lintSop({ projectRoot: project, id: 'rel', allowCommands: true });
    expect(allowed?.ok).toBe(true);
  });

  test('flags command gate with empty run array even when commands allowed', async () => {
    const project = await makeProject();
    await writeManifest(project, 'rel', {
      id: 'rel', name: 'Rel', phases: ['build'],
      gates: [{ id: 'tests', phase: 'build', check: { type: 'command', run: [] } }]
    });
    const report = await lintSop({ projectRoot: project, id: 'rel', allowCommands: true });
    expect(report?.ok).toBe(false);
    expect(codes(report!.findings)).toContain('CHECK_MISSING_FIELD');
  });

  test('flags reserved id and directory mismatch in the manifest body', async () => {
    const project = await makeProject();
    await writeManifest(project, 'rel', { id: 'peaks-rd', name: 'X', phases: ['p'], gates: [] });
    expect(codes((await lintSop({ projectRoot: project, id: 'rel' }))!.findings)).toContain('RESERVED_ID');

    await writeManifest(project, 'dir-id', { id: 'other-id', name: 'X', phases: ['p'], gates: [] });
    expect(codes((await lintSop({ projectRoot: project, id: 'dir-id' }))!.findings)).toContain('ID_MISMATCH');
  });

  test('flags a structurally invalid manifest id', async () => {
    const project = await makeProject();
    await writeManifest(project, 'rel', { id: 'Bad Id', name: 'X', phases: ['p'], gates: [] });
    expect(codes((await lintSop({ projectRoot: project, id: 'rel' }))!.findings)).toContain('INVALID_ID');
  });
});
