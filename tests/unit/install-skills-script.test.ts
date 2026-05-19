import { existsSync, mkdirSync, mkdtempSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

type InstallBundledSkills = (options: { packageRoot: string; targetRoot: string }) => { installed: string[]; skipped: string[] };
type InstallBundledOutputStyles = (options: { packageRoot: string; targetRoot: string }) => { installed: string[]; skipped: string[] };

const scriptUrl = pathToFileURL(resolve('scripts/install-skills.mjs')).href;
const { installBundledSkills, installBundledOutputStyles } = (await import(scriptUrl)) as {
  installBundledSkills: InstallBundledSkills;
  installBundledOutputStyles: InstallBundledOutputStyles;
};

const originalSkip = process.env.PEAKS_SKIP_SKILL_INSTALL;

afterEach(() => {
  if (originalSkip === undefined) {
    delete process.env.PEAKS_SKIP_SKILL_INSTALL;
    return;
  }
  process.env.PEAKS_SKIP_SKILL_INSTALL = originalSkip;
});

function createPackageRoot(skillNames: string[], outputStyleNames: string[] = []) {
  const packageRoot = mkdtempSync(join(tmpdir(), 'peaks-package-'));

  for (const skillName of skillNames) {
    const skillRoot = join(packageRoot, 'skills', skillName);
    mkdirSync(skillRoot, { recursive: true });
    writeFileSync(join(skillRoot, 'SKILL.md'), `# ${skillName}`);
  }

  for (const outputStyleName of outputStyleNames) {
    const outputStylesRoot = join(packageRoot, 'output-styles');
    mkdirSync(outputStylesRoot, { recursive: true });
    writeFileSync(join(outputStylesRoot, `${outputStyleName}.md`), `---\nname: ${outputStyleName}\n---\n`);
  }

  return packageRoot;
}

describe('install skills script', () => {
  test('links bundled skill directories into the Claude skills directory', async () => {
    const packageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));

    const result = installBundledSkills({ packageRoot, targetRoot });

    const targetPath = join(targetRoot, 'peaks-rd');
    const stats = await lstat(targetPath);
    expect(stats.isSymbolicLink()).toBe(true);
    expect(readlinkSync(targetPath)).toBe(join(packageRoot, 'skills', 'peaks-rd'));
    expect(existsSync(`${targetPath}.peaks-managed`)).toBe(true);
    expect(result).toEqual({ installed: ['peaks-rd'], skipped: [] });
  });

  test('replaces existing Peaks symlinks idempotently', async () => {
    const packageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));

    installBundledSkills({ packageRoot, targetRoot });
    const result = installBundledSkills({ packageRoot, targetRoot });

    const stats = await lstat(join(targetRoot, 'peaks-rd'));
    expect(stats.isSymbolicLink()).toBe(true);
    expect(result).toEqual({ installed: ['peaks-rd'], skipped: [] });
  });

  test('does not overwrite existing user-authored skill directories', async () => {
    const packageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const existingSkillRoot = join(targetRoot, 'peaks-rd');
    mkdirSync(existingSkillRoot, { recursive: true });
    writeFileSync(join(existingSkillRoot, 'SKILL.md'), '# custom');

    const result = installBundledSkills({ packageRoot, targetRoot });

    await expect(readFile(join(existingSkillRoot, 'SKILL.md'), 'utf8')).resolves.toBe('# custom');
    expect(result).toEqual({ installed: [], skipped: ['peaks-rd'] });
  });

  test('does not overwrite existing user-authored skill symlinks', () => {
    const packageRoot = createPackageRoot(['peaks-rd']);
    const customPackageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const targetPath = join(targetRoot, 'peaks-rd');
    mkdirSync(targetRoot, { recursive: true });
    symlinkSync(join(customPackageRoot, 'skills', 'peaks-rd'), targetPath, process.platform === 'win32' ? 'junction' : 'dir');

    const result = installBundledSkills({ packageRoot, targetRoot });

    expect(readlinkSync(targetPath)).toBe(join(customPackageRoot, 'skills', 'peaks-rd'));
    expect(result).toEqual({ installed: [], skipped: ['peaks-rd'] });
  });

  test('does not claim existing matching symlinks as managed', () => {
    const packageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const targetPath = join(targetRoot, 'peaks-rd');
    mkdirSync(targetRoot, { recursive: true });
    symlinkSync(join(packageRoot, 'skills', 'peaks-rd'), targetPath, process.platform === 'win32' ? 'junction' : 'dir');

    const result = installBundledSkills({ packageRoot, targetRoot });

    expect(readlinkSync(targetPath)).toBe(join(packageRoot, 'skills', 'peaks-rd'));
    expect(existsSync(`${targetPath}.peaks-managed`)).toBe(false);
    expect(result).toEqual({ installed: ['peaks-rd'], skipped: [] });
  });

  test('replaces stale broken skill symlinks created by Peaks', () => {
    const packageRoot = createPackageRoot(['peaks-rd', 'peaks-qa']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const staleTargetPath = join(targetRoot, 'peaks-rd');
    const stalePeaksCliRoot = join(targetRoot, '-peaks-cli');
    mkdirSync(stalePeaksCliRoot, { recursive: true });
    const staleTarget = join(stalePeaksCliRoot, 'skills', 'peaks-rd');
    symlinkSync(staleTarget, staleTargetPath, process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(`${staleTargetPath}.peaks-managed`, `${staleTarget}\n`, 'utf8');

    const result = installBundledSkills({ packageRoot, targetRoot });

    expect(readlinkSync(staleTargetPath)).toBe(join(packageRoot, 'skills', 'peaks-rd'));
    expect(result.installed).toEqual(expect.arrayContaining(['peaks-rd', 'peaks-qa']));
    expect(result.skipped).toEqual([]);
  });

  test('skips custom broken skill symlinks', () => {
    const packageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const targetPath = join(targetRoot, 'peaks-rd');
    const customTarget = join(targetRoot, 'somewhere-else', 'peaks-rd');
    mkdirSync(targetRoot, { recursive: true });
    symlinkSync(customTarget, targetPath, process.platform === 'win32' ? 'junction' : 'dir');

    const result = installBundledSkills({ packageRoot, targetRoot });

    expect(readlinkSync(targetPath)).toBe(customTarget);
    expect(result).toEqual({ installed: [], skipped: ['peaks-rd'] });
  });

  test('skips custom broken skill symlinks with stale managed markers', () => {
    const packageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const targetPath = join(targetRoot, 'peaks-rd');
    const customTarget = join(targetRoot, 'somewhere-else', 'peaks-rd');
    mkdirSync(targetRoot, { recursive: true });
    symlinkSync(customTarget, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(`${targetPath}.peaks-managed`, `${join(targetRoot, 'old-peaks-cli', 'skills', 'peaks-rd')}\n`, 'utf8');

    const result = installBundledSkills({ packageRoot, targetRoot });

    expect(readlinkSync(targetPath)).toBe(customTarget);
    expect(result).toEqual({ installed: [], skipped: ['peaks-rd'] });
  });

  test('skips installation when requested by environment', async () => {
    process.env.PEAKS_SKIP_SKILL_INSTALL = '1';
    const packageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));

    const result = installBundledSkills({ packageRoot, targetRoot });

    await expect(lstat(join(targetRoot, 'peaks-rd'))).rejects.toThrow();
    expect(result).toEqual({ installed: [], skipped: [] });
  });

  test('returns empty result when bundled skills are absent', async () => {
    const packageRoot = mkdtempSync(join(tmpdir(), 'peaks-package-'));
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));

    const result = installBundledSkills({ packageRoot, targetRoot });

    expect(result).toEqual({ installed: [], skipped: [] });
  });

  test('copies bundled output styles into the Claude output styles directory', async () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));

    const result = installBundledOutputStyles({ packageRoot, targetRoot });

    await expect(readFile(join(targetRoot, 'peaks-skill-swarm.md'), 'utf8')).resolves.toContain('name: peaks-skill-swarm');
    await expect(readFile(join(targetRoot, 'peaks-skill-swarm.md.peaks-managed'), 'utf8')).resolves.toBe(`${join(packageRoot, 'output-styles', 'peaks-skill-swarm.md')}\n`);
    expect(existsSync(join(targetRoot, 'peaks-skill-swarm.md.peaks-managed'))).toBe(true);
    expect(result).toEqual({ installed: ['peaks-skill-swarm.md'], skipped: [] });
  });

  test('does not overwrite existing user-authored output styles', async () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const targetPath = join(targetRoot, 'peaks-skill-swarm.md');
    writeFileSync(targetPath, 'custom output style', 'utf8');

    const result = installBundledOutputStyles({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toBe('custom output style');
    expect(result).toEqual({ installed: [], skipped: ['peaks-skill-swarm.md'] });
  });

  test('replaces stale Peaks-managed output styles', async () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const targetPath = join(targetRoot, 'peaks-skill-swarm.md');
    writeFileSync(targetPath, 'old output style', 'utf8');
    writeFileSync(`${targetPath}.peaks-managed`, `${join(targetRoot, 'old-peaks-cli', 'output-styles', 'peaks-skill-swarm.md')}\n`, 'utf8');

    const result = installBundledOutputStyles({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toContain('name: peaks-skill-swarm');
    expect(result).toEqual({ installed: ['peaks-skill-swarm.md'], skipped: [] });
  });

  test('does not overwrite output styles with non-Peaks managed markers', async () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const targetPath = join(targetRoot, 'peaks-skill-swarm.md');
    writeFileSync(targetPath, 'custom output style', 'utf8');
    writeFileSync(`${targetPath}.peaks-managed`, `${join(targetRoot, 'other-tool', 'peaks-skill-swarm.md')}\n`, 'utf8');

    const result = installBundledOutputStyles({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toBe('custom output style');
    expect(result).toEqual({ installed: [], skipped: ['peaks-skill-swarm.md'] });
  });

  test('skips output style installation when requested by environment', async () => {
    process.env.PEAKS_SKIP_SKILL_INSTALL = '1';
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));

    const result = installBundledOutputStyles({ packageRoot, targetRoot });

    await expect(lstat(join(targetRoot, 'peaks-skill-swarm.md'))).rejects.toThrow();
    expect(result).toEqual({ installed: [], skipped: [] });
  });

  test('links skills and copies output styles when the postinstall script runs directly', async () => {
    const skillsTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const outputStylesTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));

    execFileSync(process.execPath, [resolve('scripts/install-skills.mjs')], {
      env: { ...process.env, PEAKS_CLAUDE_SKILLS_DIR: skillsTargetRoot, PEAKS_CLAUDE_OUTPUT_STYLES_DIR: outputStylesTargetRoot },
      stdio: 'pipe'
    });

    const stats = await lstat(join(skillsTargetRoot, 'peaks-rd'));
    expect(stats.isSymbolicLink()).toBe(true);
    await expect(readFile(join(outputStylesTargetRoot, 'peaks-skill-swarm.md'), 'utf8')).resolves.toContain('Peaks Skill Swarm');
  });
});
