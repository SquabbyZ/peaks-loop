import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { initSop, lintSop, type SopLintFinding } from '../../src/services/sop/sop-service.js';
import type { SopManifest } from '../../src/services/sop/sop-types.js';

// SOP definitions are global (~/.peaks/sops). PEAKS_HOME redirects that root to
// a per-test temp dir so a unit test never touches the real home directory.
let peaksHome: string;
let savedPeaksHome: string | undefined;

beforeEach(async () => {
  savedPeaksHome = process.env.PEAKS_HOME;
  peaksHome = await mkdtemp(join(tmpdir(), 'peaks-home-'));
  process.env.PEAKS_HOME = peaksHome;
});

afterEach(() => {
  if (savedPeaksHome === undefined) {
    delete process.env.PEAKS_HOME;
  } else {
    process.env.PEAKS_HOME = savedPeaksHome;
  }
});

async function writeManifest(id: string, manifest: unknown): Promise<void> {
  const dir = join(peaksHome, 'sops', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sop.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest), 'utf8');
}

function codes(findings: SopLintFinding[]): string[] {
  return findings.map((f) => f.code);
}

describe('initSop', () => {
  test('previews without writing files by default', async () => {
    const result = await initSop({ id: 'team-release' });
    expect(result.applied).toBe(false);
    expect(result.manifestPath).toMatch(/[/\\]sops[/\\]team-release[/\\]sop\.json$/);
    expect(existsSync(result.manifestPath)).toBe(false);
    expect(result.manifest.id).toBe('team-release');
    expect(result.skillContent).toContain('name: team-release');
  });

  test('writes manifest + SKILL.md into the global home when applied', async () => {
    const result = await initSop({ id: 'team-release', name: 'Team Release', apply: true });
    expect(result.applied).toBe(true);
    expect(result.manifestPath.startsWith(peaksHome)).toBe(true);
    expect(existsSync(result.manifestPath)).toBe(true);
    expect(existsSync(result.skillPath)).toBe(true);
    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8')) as SopManifest;
    expect(manifest.name).toBe('Team Release');
    expect(manifest.phases.length).toBeGreaterThan(0);
    const skill = await readFile(result.skillPath, 'utf8');
    expect(skill).toContain('name: team-release');
  });

  test('the scaffolded SOP lints clean (round-trip)', async () => {
    await initSop({ id: 'team-release', apply: true });
    const report = await lintSop({ id: 'team-release' });
    expect(report?.ok).toBe(true);
    expect(report?.gateCount).toBe(1);
    expect(report?.gateIds).toEqual(['example-gate']);
  });

  test('rejects an invalid id', async () => {
    await expect(initSop({ id: 'Bad Id!' })).rejects.toThrow(/Invalid SOP id/);
  });

  test('rejects an id in the reserved peaks- namespace', async () => {
    await expect(initSop({ id: 'peaks-rd' })).rejects.toThrow(/reserved built-in peaks/);
    await expect(initSop({ id: 'peaks' })).rejects.toThrow(/reserved built-in peaks/);
  });

  test('rejects re-initializing an existing SOP', async () => {
    await initSop({ id: 'team-release', apply: true });
    await expect(initSop({ id: 'team-release', apply: true })).rejects.toThrow(/already exists/);
  });
});

describe('lintSop', () => {
  test('returns null when the SOP does not exist', async () => {
    expect(await lintSop({ id: 'missing' })).toBeNull();
  });

  test('reports a valid manifest as ok with gate metadata', async () => {
    await writeManifest('rel', {
      id: 'rel', name: 'Rel', phases: ['build', 'ship'],
      gates: [
        { id: 'docs', phase: 'ship', check: { type: 'file-exists', path: 'CHANGELOG.md' } },
        { id: 'no-fixme', phase: 'build', check: { type: 'grep', file: 'src/x.ts', pattern: 'FIXME' } }
      ]
    });
    const report = await lintSop({ id: 'rel' });
    expect(report?.ok).toBe(true);
    expect(report?.gateCount).toBe(2);
    expect(report?.gateIds).toEqual(['docs', 'no-fixme']);
  });

  test('accepts a grep check with absent:true', async () => {
    await writeManifest('rel', {
      id: 'rel', name: 'Rel', phases: ['ship'],
      gates: [{ id: 'no-todo', phase: 'ship', check: { type: 'grep', file: 'post.md', pattern: 'TODO', absent: true } }]
    });
    const report = await lintSop({ id: 'rel' });
    expect(report?.ok).toBe(true);
    expect(report?.gateIds).toEqual(['no-todo']);
  });

  test('flags invalid JSON', async () => {
    await writeManifest('broken', '{ not json');
    const report = await lintSop({ id: 'broken' });
    expect(report?.ok).toBe(false);
    expect(codes(report!.findings)).toContain('INVALID_JSON');
  });

  test('flags duplicate gate ids and unknown phase bindings', async () => {
    await writeManifest('rel', {
      id: 'rel', name: 'Rel', phases: ['build'],
      gates: [
        { id: 'g1', phase: 'build', check: { type: 'file-exists', path: 'a' } },
        { id: 'g1', phase: 'build', check: { type: 'file-exists', path: 'b' } },
        { id: 'g2', phase: 'nope', check: { type: 'file-exists', path: 'c' } }
      ]
    });
    const report = await lintSop({ id: 'rel' });
    expect(report?.ok).toBe(false);
    expect(codes(report!.findings)).toContain('DUPLICATE_GATE_ID');
    expect(codes(report!.findings)).toContain('GATE_PHASE_UNKNOWN');
  });

  test('flags empty and duplicate phases', async () => {
    await writeManifest('a', { id: 'a', name: 'A', phases: [], gates: [] });
    expect(codes((await lintSop({ id: 'a' }))!.findings)).toContain('EMPTY_PHASES');
    await writeManifest('b', { id: 'b', name: 'B', phases: ['x', 'x'], gates: [] });
    expect(codes((await lintSop({ id: 'b' }))!.findings)).toContain('DUPLICATE_PHASE');
  });

  test('flags invalid gate id and invalid/missing check type', async () => {
    await writeManifest('rel', {
      id: 'rel', name: 'Rel', phases: ['build'],
      gates: [
        { id: 'Bad Id', phase: 'build', check: { type: 'file-exists', path: 'a' } },
        { id: 'g2', phase: 'build', check: { type: 'nonsense' } }
      ]
    });
    const report = await lintSop({ id: 'rel' });
    expect(codes(report!.findings)).toContain('INVALID_GATE_ID');
    expect(codes(report!.findings)).toContain('INVALID_CHECK_TYPE');
  });

  test('flags missing required check fields per type', async () => {
    await writeManifest('rel', {
      id: 'rel', name: 'Rel', phases: ['build'],
      gates: [
        { id: 'fe', phase: 'build', check: { type: 'file-exists' } },
        { id: 'gr', phase: 'build', check: { type: 'grep', file: 'x' } }
      ]
    });
    const report = await lintSop({ id: 'rel' });
    expect(report!.findings.filter((f) => f.code === 'CHECK_MISSING_FIELD')).toHaveLength(2);
  });

  test('command gates require --allow-commands', async () => {
    await writeManifest('rel', {
      id: 'rel', name: 'Rel', phases: ['build'],
      gates: [{ id: 'tests', phase: 'build', check: { type: 'command', run: ['npm', 'test'] } }]
    });
    const blocked = await lintSop({ id: 'rel' });
    expect(blocked?.ok).toBe(false);
    expect(codes(blocked!.findings)).toContain('COMMAND_NOT_ALLOWED');

    const allowed = await lintSop({ id: 'rel', allowCommands: true });
    expect(allowed?.ok).toBe(true);
  });

  test('flags command gate with empty run array even when commands allowed', async () => {
    await writeManifest('rel', {
      id: 'rel', name: 'Rel', phases: ['build'],
      gates: [{ id: 'tests', phase: 'build', check: { type: 'command', run: [] } }]
    });
    const report = await lintSop({ id: 'rel', allowCommands: true });
    expect(report?.ok).toBe(false);
    expect(codes(report!.findings)).toContain('CHECK_MISSING_FIELD');
  });

  test('flags reserved id and directory mismatch in the manifest body', async () => {
    await writeManifest('rel', { id: 'peaks-rd', name: 'X', phases: ['p'], gates: [] });
    expect(codes((await lintSop({ id: 'rel' }))!.findings)).toContain('RESERVED_ID');

    await writeManifest('dir-id', { id: 'other-id', name: 'X', phases: ['p'], gates: [] });
    expect(codes((await lintSop({ id: 'dir-id' }))!.findings)).toContain('ID_MISMATCH');
  });

  test('flags a structurally invalid manifest id', async () => {
    await writeManifest('rel', { id: 'Bad Id', name: 'X', phases: ['p'], gates: [] });
    expect(codes((await lintSop({ id: 'rel' }))!.findings)).toContain('INVALID_ID');
  });

  test('accepts a valid Bash guard', async () => {
    await writeManifest('rel', {
      id: 'rel', name: 'Rel', phases: ['draft', 'publish'], gates: [],
      guards: [{ phase: 'publish', bash: 'git\\s+push' }]
    });
    expect((await lintSop({ id: 'rel' }))?.ok).toBe(true);
  });

  test('flags a guard bound to an unknown phase', async () => {
    await writeManifest('rel', {
      id: 'rel', name: 'Rel', phases: ['draft'], gates: [],
      guards: [{ phase: 'nope', bash: 'git push' }]
    });
    expect(codes((await lintSop({ id: 'rel' }))!.findings)).toContain('GUARD_PHASE_UNKNOWN');
  });

  test('flags a guard with an empty or invalid regex', async () => {
    await writeManifest('a', { id: 'a', name: 'A', phases: ['p'], gates: [], guards: [{ phase: 'p', bash: '' }] });
    expect(codes((await lintSop({ id: 'a' }))!.findings)).toContain('GUARD_MISSING_PATTERN');
    await writeManifest('b', { id: 'b', name: 'B', phases: ['p'], gates: [], guards: [{ phase: 'p', bash: '(' }] });
    expect(codes((await lintSop({ id: 'b' }))!.findings)).toContain('GUARD_INVALID_PATTERN');
  });
});
