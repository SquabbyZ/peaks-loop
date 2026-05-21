import { existsSync, linkSync, mkdirSync, mkdtempSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

type InstallBundledSkills = (options: { packageRoot: string; targetRoot: string }) => { installed: string[]; skipped: string[] };
type InstallBundledOutputStyles = (options: { packageRoot: string; targetRoot: string }) => { installed: string[]; skipped: string[] };
type InstallProjectConfig = (options?: { projectRoot?: string }) => { created: boolean; updated: boolean; skipped: boolean };

const scriptUrl = pathToFileURL(resolve('scripts/install-skills.mjs')).href;
const { installBundledSkills, installBundledOutputStyles, installProjectConfig } = (await import(scriptUrl)) as {
  installBundledSkills: InstallBundledSkills;
  installBundledOutputStyles: InstallBundledOutputStyles;
  installProjectConfig: InstallProjectConfig;
};

const originalSkip = process.env.PEAKS_SKIP_SKILL_INSTALL;
const originalProjectConfigSkip = process.env.PEAKS_SKIP_PROJECT_CONFIG_INSTALL;

afterEach(() => {
  if (originalSkip === undefined) {
    delete process.env.PEAKS_SKIP_SKILL_INSTALL;
  } else {
    process.env.PEAKS_SKIP_SKILL_INSTALL = originalSkip;
  }

  if (originalProjectConfigSkip === undefined) {
    delete process.env.PEAKS_SKIP_PROJECT_CONFIG_INSTALL;
  } else {
    process.env.PEAKS_SKIP_PROJECT_CONFIG_INSTALL = originalProjectConfigSkip;
  }
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

  test('creates project config during install', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-project-'));

    const result = installProjectConfig({ projectRoot });

    await expect(readFile(join(projectRoot, '.peaks', 'config.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          version: '0.1.0',
          currentWorkspace: null,
          workspaces: [],
          language: 'en',
          model: 'sonnet',
          economyMode: true,
          swarmMode: true,
          tokens: {},
          providers: {
            minimax: {
              model: 'minimax-2.7'
            }
          },
          proxy: {}
        },
        null,
        2
      )}\n`
    );
    expect(result).toEqual({ created: true, updated: false, skipped: false });
  });

  test('adds new project config defaults without overwriting existing values', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-project-'));
    const configPath = join(projectRoot, '.peaks', 'config.json');
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ language: 'zh-CN', economyMode: false }, null, 2), 'utf8');

    const result = installProjectConfig({ projectRoot });

    await expect(readFile(configPath, 'utf8').then(JSON.parse)).resolves.toEqual({
      language: 'zh-CN',
      economyMode: false,
      version: '0.1.0',
      currentWorkspace: null,
      workspaces: [],
      model: 'sonnet',
      swarmMode: true,
      tokens: {},
      providers: {
        minimax: {
          model: 'minimax-2.7'
        }
      },
      proxy: {}
    });
    expect(result).toEqual({ created: false, updated: true, skipped: false });
  });

  test('skips project config installation when requested by environment', async () => {
    process.env.PEAKS_SKIP_PROJECT_CONFIG_INSTALL = '1';
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-project-'));

    const result = installProjectConfig({ projectRoot });

    await expect(readFile(join(projectRoot, '.peaks', 'config.json'), 'utf8')).rejects.toThrow();
    expect(result).toEqual({ created: false, updated: false, skipped: true });
  });

  test('rejects project config installation when .peaks is a symlink', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-project-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-outside-'));
    symlinkSync(outsideRoot, join(projectRoot, '.peaks'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => installProjectConfig({ projectRoot })).toThrow('Project config path must stay inside the project root');
    expect(existsSync(join(outsideRoot, 'config.json'))).toBe(false);
  });

  test('rejects project config installation when config.json is a symlink', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-project-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-outside-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(join(outsideRoot, 'config.json'), 'outside', 'utf8');
    symlinkSync(join(outsideRoot, 'config.json'), join(projectRoot, '.peaks', 'config.json'));

    expect(() => installProjectConfig({ projectRoot })).toThrow('Project config path must not be a symlink');
    await expect(readFile(join(outsideRoot, 'config.json'), 'utf8')).resolves.toBe('outside');
  });

  test('rejects project config installation when config.json is hardlinked', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-project-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-outside-'));
    const outsideConfigPath = join(outsideRoot, 'config.json');
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(outsideConfigPath, '{}', 'utf8');
    linkSync(outsideConfigPath, join(projectRoot, '.peaks', 'config.json'));

    expect(() => installProjectConfig({ projectRoot })).toThrow('Project config path must not be hardlinked');
    await expect(readFile(outsideConfigPath, 'utf8')).resolves.toBe('{}');
  });

  test('preserves malformed project config during direct postinstall', async () => {
    const skillsTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const outputStylesTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-project-'));
    const configPath = join(projectRoot, '.peaks', 'config.json');
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(configPath, '{bad', 'utf8');

    execFileSync(process.execPath, [resolve('scripts/install-skills.mjs')], {
      env: {
        ...process.env,
        PEAKS_CLAUDE_SKILLS_DIR: skillsTargetRoot,
        PEAKS_CLAUDE_OUTPUT_STYLES_DIR: outputStylesTargetRoot,
        PEAKS_PROJECT_ROOT: projectRoot
      },
      stdio: 'pipe'
    });

    await expect(readFile(configPath, 'utf8')).resolves.toBe('{bad');
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

  test('links skills, copies output styles, and creates project config when the postinstall script runs directly', async () => {
    const skillsTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const outputStylesTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-project-'));

    execFileSync(process.execPath, [resolve('scripts/install-skills.mjs')], {
      env: {
        ...process.env,
        PEAKS_CLAUDE_SKILLS_DIR: skillsTargetRoot,
        PEAKS_CLAUDE_OUTPUT_STYLES_DIR: outputStylesTargetRoot,
        PEAKS_PROJECT_ROOT: projectRoot
      },
      stdio: 'pipe'
    });

    const stats = await lstat(join(skillsTargetRoot, 'peaks-rd'));
    expect(stats.isSymbolicLink()).toBe(true);
    await expect(readFile(join(outputStylesTargetRoot, 'peaks-skill-swarm.md'), 'utf8')).resolves.toContain('Peaks Skill Swarm');
    await expect(readFile(join(projectRoot, '.peaks', 'config.json'), 'utf8')).resolves.toContain('"language": "en"');
  });
});
