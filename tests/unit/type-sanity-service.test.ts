import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkTypeSanity } from '../../src/services/scan/type-sanity-service.js';

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'peaks-typesanity-'));
  execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
  // Initial commit so HEAD exists.
  await writeFile(join(dir, 'README.md'), '# initial\n', 'utf8');
  execFileSync('git', ['-C', dir, 'add', 'README.md']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'initial']);
  return dir;
}

describe('checkTypeSanity', () => {
  test('returns consistent=true and gitAvailable=false when not a git repository', async () => {
    const project = await mkdtemp(join(tmpdir(), 'peaks-typesanity-nogit-'));
    const report = checkTypeSanity({ projectRoot: project, declaredType: 'feature' });
    expect(report.gitAvailable).toBe(false);
    expect(report.consistent).toBe(true);
  });

  test('classifies docs-only diff as docs and flags feature as inconsistent', async () => {
    const project = await makeRepo();
    await writeFile(join(project, 'NOTES.md'), '# notes\n', 'utf8');
    const report = checkTypeSanity({ projectRoot: project, declaredType: 'feature' });
    expect(report.gitAvailable).toBe(true);
    expect(report.changedFiles).toContain('NOTES.md');
    expect(report.consistent).toBe(false);
    expect(report.suggestedTypes).toEqual(['docs']);
  });

  test('classifies source diff as consistent with feature/bugfix/refactor', async () => {
    const project = await makeRepo();
    await mkdir(join(project, 'src'), { recursive: true });
    await writeFile(join(project, 'src/api.ts'), 'export const x = 1;\n', 'utf8');
    const report = checkTypeSanity({ projectRoot: project, declaredType: 'feature' });
    expect(report.consistent).toBe(true);
    expect(report.suggestedTypes).toEqual(['feature', 'bugfix', 'refactor']);
  });

  test('classifies config-only diff as config', async () => {
    const project = await makeRepo();
    await writeFile(join(project, 'tsconfig.json'), '{}\n', 'utf8');
    const report = checkTypeSanity({ projectRoot: project, declaredType: 'docs' });
    expect(report.consistent).toBe(false);
    expect(report.suggestedTypes).toEqual(['config']);
  });

  test('classifies file with unrecognized extension as unknown category', async () => {
    const project = await makeRepo();
    await writeFile(join(project, 'gradle.buildscript'), 'some content\n', 'utf8');
    const report = checkTypeSanity({ projectRoot: project, declaredType: 'feature' });
    expect(report.breakdown).toHaveLength(1);
    expect(report.breakdown[0]?.category).toBe('unknown');
    expect(report.breakdown[0]?.count).toBe(1);
    expect(report.breakdown[0]?.examples).toEqual(['gradle.buildscript']);
  });

  test('returns consistent=true when no changes are detected', async () => {
    const project = await makeRepo();
    const report = checkTypeSanity({ projectRoot: project, declaredType: 'feature' });
    expect(report.gitAvailable).toBe(true);
    expect(report.changedFiles).toEqual([]);
    expect(report.consistent).toBe(true);
    expect(report.rationale).toContain('no changes detected against HEAD');
  });
});
