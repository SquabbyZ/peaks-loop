import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir, homedir as osHomedir } from 'node:os';
const os = { homedir: osHomedir };
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

type InstallBundledSkills = (options: { packageRoot: string; targetRoot: string }) => { installed: string[]; skipped: string[] };
type InstallBundledOutputStyles = (options: { packageRoot: string; targetRoot: string }) => { installed: string[]; skipped: string[] };
type InstallBundledAgents = (options: { packageRoot: string; targetRoot: string }) => { installed: string[]; skipped: string[] };
type InstallBundledAgentsForAllPlatforms = (options: { packageRoot: string; targetRoot: string }) => Array<{ ideId: string; agentsDir: string; installed: string[]; skipped: string[]; error?: string }>;
type InstallConfig = (options?: { packageRoot?: string; projectRoot?: string; userRoot?: string }) => { created: boolean; updated: boolean; skipped: boolean };

const scriptUrl = pathToFileURL(resolve('scripts/install-skills.mjs')).href;
const { installBundledSkills, installBundledOutputStyles, installBundledAgents, installBundledAgentsForAllPlatforms, installProjectConfig, installUserConfig } = (await import(scriptUrl)) as {
  installBundledSkills: InstallBundledSkills;
  installBundledOutputStyles: InstallBundledOutputStyles;
  installBundledAgents: InstallBundledAgents;
  installBundledAgentsForAllPlatforms: InstallBundledAgentsForAllPlatforms;
  installProjectConfig: InstallConfig;
  installUserConfig: InstallConfig;
};

const originalSkip = process.env.PEAKS_SKIP_SKILL_INSTALL;
const originalProjectConfigSkip = process.env.PEAKS_SKIP_PROJECT_CONFIG_INSTALL;
const originalUserConfigSkip = process.env.PEAKS_SKIP_USER_CONFIG_INSTALL;

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

  if (originalUserConfigSkip === undefined) {
    delete process.env.PEAKS_SKIP_USER_CONFIG_INSTALL;
  } else {
    process.env.PEAKS_SKIP_USER_CONFIG_INSTALL = originalUserConfigSkip;
  }
});

function canCreateFileSymlink(): boolean {
  const root = mkdtempSync(join(tmpdir(), 'peaks-symlink-check-'));
  try {
    const target = join(root, 'target.txt');
    const link = join(root, 'link.txt');
    writeFileSync(target, 'target', 'utf8');
    symlinkSync(target, link);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const fileSymlinkTest = canCreateFileSymlink() ? test : test.skip;

function createOutputStyleMarker(sourcePath: string, outputStyleName = 'peaks-skill-swarm.md'): string {
  return `${JSON.stringify({ version: 1, kind: 'output-style', outputStyleName, sourcePath, contentSha256: createHash('sha256').update(readFileSync(sourcePath, 'utf8')).digest('hex') })}\n`;
}

function createAgentMarker(sourcePath: string, agentFileName = 'karpathy-reviewer.md'): string {
  return `${JSON.stringify({ version: 1, kind: 'agent', agentName: agentFileName, sourcePath, contentSha256: createHash('sha256').update(readFileSync(sourcePath, 'utf8')).digest('hex') })}\n`;
}

function createPackageRoot(skillNames: string[], outputStyleNames: string[] = [], agentFileNames: string[] = [], version = '9.8.7') {
  const packageRoot = mkdtempSync(join(tmpdir(), 'peaks-package-'));
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ version }), 'utf8');

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

  for (const agentFileName of agentFileNames) {
    const agentsRoot = join(packageRoot, 'agents');
    mkdirSync(agentsRoot, { recursive: true });
    writeFileSync(join(agentsRoot, agentFileName), `---\nname: ${agentFileName.replace(/\.md$/, '')}\ntools: ["Read", "Bash"]\nmodel: sonnet\n---\n# ${agentFileName}\n`);
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

  test('replaces stale Peaks-managed skill symlinks from older package installs', () => {
    const oldPackageRoot = createPackageRoot(['peaks-rd']);
    const packageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const targetPath = join(targetRoot, 'peaks-rd');
    const oldSourcePath = join(oldPackageRoot, 'skills', 'peaks-rd');
    const sourcePath = join(packageRoot, 'skills', 'peaks-rd');
    mkdirSync(targetRoot, { recursive: true });
    symlinkSync(oldSourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(`${targetPath}.peaks-managed`, `${oldSourcePath}\n`, 'utf8');

    const result = installBundledSkills({ packageRoot, targetRoot });

    expect(readlinkSync(targetPath)).toBe(sourcePath);
    expect(readFileSync(`${targetPath}.peaks-managed`, 'utf8')).toBe(`${sourcePath}\n`);
    expect(result).toEqual({ installed: ['peaks-rd'], skipped: [] });
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

  test('rejects Peaks-managed skill marker hardlinks', () => {
    const packageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const targetPath = join(targetRoot, 'peaks-rd');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-outside-marker-'));
    const outsideMarkerPath = join(outsideRoot, 'marker.txt');
    mkdirSync(targetRoot, { recursive: true });
    writeFileSync(outsideMarkerPath, 'outside', 'utf8');
    linkSync(outsideMarkerPath, `${targetPath}.peaks-managed`);

    expect(() => installBundledSkills({ packageRoot, targetRoot })).toThrow('Peaks managed marker path must not be hardlinked');
    expect(readFileSync(outsideMarkerPath, 'utf8')).toBe('outside');
  });

  test('rejects symlinked skills install roots', () => {
    const packageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = join(tmpdir(), `peaks-skills-link-${Date.now()}`);
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-outside-'));
    symlinkSync(outsideRoot, targetRoot, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => installBundledSkills({ packageRoot, targetRoot })).toThrow('Peaks skills install root must not be a symlink');
    expect(existsSync(join(outsideRoot, 'peaks-rd'))).toBe(false);
  });

  test('removes newly linked skills when marker hardlink validation fails', async () => {
    const packageRoot = createPackageRoot(['peaks-rd']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const targetPath = join(targetRoot, 'peaks-rd');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-outside-'));
    const outsideMarkerPath = join(outsideRoot, 'marker');
    writeFileSync(outsideMarkerPath, 'outside', 'utf8');
    linkSync(outsideMarkerPath, `${targetPath}.peaks-managed`);

    expect(() => installBundledSkills({ packageRoot, targetRoot })).toThrow('Peaks managed marker path must not be hardlinked');
    await expect(lstat(targetPath)).rejects.toThrow();
    await expect(readFile(outsideMarkerPath, 'utf8')).resolves.toBe('outside');
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

  test('creates user config during install', async () => {
    const userRoot = mkdtempSync(join(tmpdir(), 'peaks-user-'));
    const packageRoot = createPackageRoot([]);

    const result = installUserConfig({ userRoot, packageRoot });

    await expect(readFile(join(userRoot, '.peaks', 'config.json'), 'utf8')).resolves.toBe(
      `${JSON.stringify(
        {
          version: '9.8.7',
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

  test('adds new user config defaults and updates version without overwriting existing values', async () => {
    const userRoot = mkdtempSync(join(tmpdir(), 'peaks-user-'));
    const packageRoot = createPackageRoot([], [], [], '9.8.8');
    const configPath = join(userRoot, '.peaks', 'config.json');
    mkdirSync(join(userRoot, '.peaks'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({ version: '1.0.0', language: 'zh-CN', economyMode: false }, null, 2), 'utf8');

    const result = installUserConfig({ userRoot, packageRoot });

    await expect(readFile(configPath, 'utf8').then(JSON.parse)).resolves.toEqual({
      version: '9.8.8',
      language: 'zh-CN',
      economyMode: false,
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

  test('skips user config installation when requested by environment', async () => {
    process.env.PEAKS_SKIP_USER_CONFIG_INSTALL = '1';
    const userRoot = mkdtempSync(join(tmpdir(), 'peaks-user-'));

    const result = installUserConfig({ userRoot });

    await expect(readFile(join(userRoot, '.peaks', 'config.json'), 'utf8')).rejects.toThrow();
    expect(result).toEqual({ created: false, updated: false, skipped: true });
  });

  test('rejects user config installation when .peaks is a symlink', () => {
    const userRoot = mkdtempSync(join(tmpdir(), 'peaks-user-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-outside-'));
    symlinkSync(outsideRoot, join(userRoot, '.peaks'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => installUserConfig({ userRoot })).toThrow('User config path must stay inside the user root');
    expect(existsSync(join(outsideRoot, 'config.json'))).toBe(false);
  });

  fileSymlinkTest('rejects user config installation when config.json is a symlink', async () => {
    const userRoot = mkdtempSync(join(tmpdir(), 'peaks-user-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-outside-'));
    mkdirSync(join(userRoot, '.peaks'), { recursive: true });
    writeFileSync(join(outsideRoot, 'config.json'), 'outside', 'utf8');
    symlinkSync(join(outsideRoot, 'config.json'), join(userRoot, '.peaks', 'config.json'));

    expect(() => installUserConfig({ userRoot })).toThrow('User config path must not be a symlink');
    await expect(readFile(join(outsideRoot, 'config.json'), 'utf8')).resolves.toBe('outside');
  });

  test('rejects user config installation when config.json is hardlinked', async () => {
    const userRoot = mkdtempSync(join(tmpdir(), 'peaks-user-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-outside-'));
    const outsideConfigPath = join(outsideRoot, 'config.json');
    mkdirSync(join(userRoot, '.peaks'), { recursive: true });
    writeFileSync(outsideConfigPath, '{}', 'utf8');
    linkSync(outsideConfigPath, join(userRoot, '.peaks', 'config.json'));

    expect(() => installUserConfig({ userRoot })).toThrow('User config path must not be hardlinked');
    await expect(readFile(outsideConfigPath, 'utf8')).resolves.toBe('{}');
  });

  test('rejects project config installation when .peaks is a symlink', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-project-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-outside-'));
    symlinkSync(outsideRoot, join(projectRoot, '.peaks'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => installProjectConfig({ projectRoot })).toThrow('Project config path must stay inside the project root');
    expect(existsSync(join(outsideRoot, 'config.json'))).toBe(false);
  });

  fileSymlinkTest('rejects project config installation when config.json is a symlink', async () => {
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

  test('preserves malformed user config during direct postinstall', async () => {
    const skillsTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const outputStylesTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const userRoot = mkdtempSync(join(tmpdir(), 'peaks-user-'));
    const configPath = join(userRoot, '.peaks', 'config.json');
    mkdirSync(join(userRoot, '.peaks'), { recursive: true });
    writeFileSync(configPath, '{bad', 'utf8');

    execFileSync(process.execPath, [resolve('scripts/install-skills.mjs')], {
      env: {
        ...process.env,
        HOME: userRoot,
        USERPROFILE: userRoot,
        PEAKS_CLAUDE_SKILLS_DIR: skillsTargetRoot,
        PEAKS_CLAUDE_OUTPUT_STYLES_DIR: outputStylesTargetRoot
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
    await expect(readFile(join(targetRoot, 'peaks-skill-swarm.md.peaks-managed'), 'utf8').then(JSON.parse)).resolves.toMatchObject({
      version: 1,
      kind: 'output-style',
      sourcePath: join(packageRoot, 'output-styles', 'peaks-skill-swarm.md')
    });
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

  test('replaces stale output style markers when the target file is missing', async () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const targetPath = join(targetRoot, 'peaks-skill-swarm.md');
    const sourcePath = join(packageRoot, 'output-styles', 'peaks-skill-swarm.md');
    writeFileSync(`${targetPath}.peaks-managed`, createOutputStyleMarker(sourcePath), 'utf8');

    const result = installBundledOutputStyles({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toContain('name: peaks-skill-swarm');
    await expect(readFile(`${targetPath}.peaks-managed`, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      version: 1,
      kind: 'output-style',
      sourcePath
    });
    expect(result).toEqual({ installed: ['peaks-skill-swarm.md'], skipped: [] });
  });

  test('skips output styles when the package source changes in place', async () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const targetPath = join(targetRoot, 'peaks-skill-swarm.md');
    const sourcePath = join(packageRoot, 'output-styles', 'peaks-skill-swarm.md');
    const oldContent = readFileSync(sourcePath, 'utf8');
    writeFileSync(targetPath, oldContent, 'utf8');
    writeFileSync(`${targetPath}.peaks-managed`, createOutputStyleMarker(sourcePath), 'utf8');
    writeFileSync(sourcePath, `${oldContent}updated`, 'utf8');

    const result = installBundledOutputStyles({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toBe(oldContent);
    expect(result).toEqual({ installed: [], skipped: ['peaks-skill-swarm.md'] });
  });

  test('skips stale output styles when the marker points to a different package path', async () => {
    const oldPackageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const targetPath = join(targetRoot, 'peaks-skill-swarm.md');
    const oldSourcePath = join(oldPackageRoot, 'output-styles', 'peaks-skill-swarm.md');
    const oldContent = readFileSync(oldSourcePath, 'utf8');
    writeFileSync(targetPath, oldContent, 'utf8');
    writeFileSync(`${targetPath}.peaks-managed`, createOutputStyleMarker(oldSourcePath), 'utf8');

    const result = installBundledOutputStyles({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toBe(oldContent);
    expect(result).toEqual({ installed: [], skipped: ['peaks-skill-swarm.md'] });
  });

  test('does not overwrite output styles with spoofed Peaks markers', async () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const targetPath = join(targetRoot, 'peaks-skill-swarm.md');
    writeFileSync(targetPath, 'custom output style', 'utf8');
    writeFileSync(`${targetPath}.peaks-managed`, `${join(targetRoot, 'old-peaks-cli', 'output-styles', 'peaks-skill-swarm.md')}\n`, 'utf8');

    const result = installBundledOutputStyles({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toBe('custom output style');
    expect(result).toEqual({ installed: [], skipped: ['peaks-skill-swarm.md'] });
  });

  test('does not overwrite output styles with forged structured Peaks markers', async () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const targetPath = join(targetRoot, 'peaks-skill-swarm.md');
    const forgedSourcePath = join(targetRoot, 'fake-package', 'output-styles', 'peaks-skill-swarm.md');
    mkdirSync(join(targetRoot, 'fake-package', 'output-styles'), { recursive: true });
    writeFileSync(targetPath, 'custom output style', 'utf8');
    writeFileSync(forgedSourcePath, 'custom output style', 'utf8');
    writeFileSync(`${targetPath}.peaks-managed`, createOutputStyleMarker(forgedSourcePath), 'utf8');

    const result = installBundledOutputStyles({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toBe('custom output style');
    expect(result).toEqual({ installed: [], skipped: ['peaks-skill-swarm.md'] });
  });

  test('does not overwrite output styles with forged current-source structured Peaks markers', async () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const targetPath = join(targetRoot, 'peaks-skill-swarm.md');
    const sourcePath = join(packageRoot, 'output-styles', 'peaks-skill-swarm.md');
    const customContent = 'custom output style';
    writeFileSync(targetPath, customContent, 'utf8');
    writeFileSync(
      `${targetPath}.peaks-managed`,
      `${JSON.stringify({ version: 1, kind: 'output-style', outputStyleName: 'peaks-skill-swarm.md', sourcePath, contentSha256: createHash('sha256').update(customContent).digest('hex') })}\n`,
      'utf8'
    );

    const result = installBundledOutputStyles({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toBe(customContent);
    expect(result).toEqual({ installed: [], skipped: ['peaks-skill-swarm.md'] });
  });

  test('rejects symlinked output styles install roots', () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = join(tmpdir(), `peaks-output-styles-link-${Date.now()}`);
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-outside-'));
    symlinkSync(outsideRoot, targetRoot, process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => installBundledOutputStyles({ packageRoot, targetRoot })).toThrow('Peaks output styles install root must not be a symlink');
    expect(existsSync(join(outsideRoot, 'peaks-skill-swarm.md'))).toBe(false);
  });

  fileSymlinkTest('removes newly written output styles when marker symlink validation fails', async () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const targetPath = join(targetRoot, 'peaks-skill-swarm.md');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-outside-'));
    const markerPath = `${targetPath}.peaks-managed`;
    writeFileSync(join(outsideRoot, 'marker'), 'outside', 'utf8');
    symlinkSync(join(outsideRoot, 'marker'), markerPath);

    expect(() => installBundledOutputStyles({ packageRoot, targetRoot })).toThrow('Peaks managed marker path must not be a symlink');
    await expect(readFile(targetPath, 'utf8')).rejects.toThrow();
    await expect(readFile(join(outsideRoot, 'marker'), 'utf8')).resolves.toBe('outside');
  });

  test('removes newly written output styles when marker hardlink validation fails', async () => {
    const packageRoot = createPackageRoot([], ['peaks-skill-swarm']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const targetPath = join(targetRoot, 'peaks-skill-swarm.md');
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-outside-'));
    const outsideMarkerPath = join(outsideRoot, 'marker');
    writeFileSync(outsideMarkerPath, 'outside', 'utf8');
    linkSync(outsideMarkerPath, `${targetPath}.peaks-managed`);

    expect(() => installBundledOutputStyles({ packageRoot, targetRoot })).toThrow('Peaks managed marker path must not be hardlinked');
    await expect(readFile(targetPath, 'utf8')).rejects.toThrow();
    await expect(readFile(outsideMarkerPath, 'utf8')).resolves.toBe('outside');
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

  test('links skills, copies output styles, and creates user config when the postinstall script runs directly', async () => {
    const skillsTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-skills-'));
    const outputStylesTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-output-styles-'));
    const userRoot = mkdtempSync(join(tmpdir(), 'peaks-user-'));
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-project-'));

    execFileSync(process.execPath, [resolve('scripts/install-skills.mjs')], {
      env: {
        ...process.env,
        HOME: userRoot,
        USERPROFILE: userRoot,
        PEAKS_CLAUDE_SKILLS_DIR: skillsTargetRoot,
        PEAKS_CLAUDE_OUTPUT_STYLES_DIR: outputStylesTargetRoot,
        PEAKS_PROJECT_ROOT: projectRoot
      },
      stdio: 'pipe'
    });

    const stats = await lstat(join(skillsTargetRoot, 'peaks-rd'));
    expect(stats.isSymbolicLink()).toBe(true);
    await expect(readFile(join(outputStylesTargetRoot, 'peaks-skill-swarm.md'), 'utf8')).resolves.toContain('Peaks Skill Swarm');
    await expect(readFile(join(userRoot, '.peaks', 'config.json'), 'utf8')).resolves.toContain('"language": "en"');
    await expect(readFile(join(projectRoot, '.peaks', 'config.json'), 'utf8')).rejects.toThrow();
  });

  // Slice 7/7 — agents (Claude Code sub-agent prompts).
  // Mirrors the output-styles test contract: content-hash drift detection
  // via a `.peaks-managed` JSON marker, atomic write, escape hatch
  // (PEAKS_SKIP_AGENT_INSTALL=1), and user-authored files preserved.

  test('copies bundled agents into the Claude agents directory', async () => {
    const packageRoot = createPackageRoot([], [], ['karpathy-reviewer.md']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-agents-'));

    const result = installBundledAgents({ packageRoot, targetRoot });

    await expect(readFile(join(targetRoot, 'karpathy-reviewer.md'), 'utf8')).resolves.toContain('name: karpathy-reviewer');
    await expect(readFile(join(targetRoot, 'karpathy-reviewer.md.peaks-managed'), 'utf8').then(JSON.parse)).resolves.toMatchObject({
      version: 1,
      kind: 'agent',
      agentName: 'karpathy-reviewer.md',
      sourcePath: join(packageRoot, 'agents', 'karpathy-reviewer.md')
    });
    expect(existsSync(join(targetRoot, 'karpathy-reviewer.md.peaks-managed'))).toBe(true);
    expect(result).toEqual({ installed: ['karpathy-reviewer.md'], skipped: [] });
  });

  test('is idempotent on re-install (replaces when content hash matches, reports installed)', async () => {
    const packageRoot = createPackageRoot([], [], ['karpathy-reviewer.md']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-agents-'));

    installBundledAgents({ packageRoot, targetRoot });
    const result = installBundledAgents({ packageRoot, targetRoot });

    // Output-styles contract: even when content matches, the function
    // unlinks + replaces (atomic write). The user-visible state is the
    // same, but the result reports the file as installed. The atomic
    // write + marker ensure the second install is safe and idempotent.
    expect(result.installed).toEqual(['karpathy-reviewer.md']);
    expect(result.skipped).toEqual([]);
    await expect(readFile(join(targetRoot, 'karpathy-reviewer.md'), 'utf8')).resolves.toContain('name: karpathy-reviewer');
  });

  test('skips the target when the source content hash changes (preserves user-edited file)', async () => {
    const packageRoot = createPackageRoot([], [], ['karpathy-reviewer.md']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-agents-'));
    const sourcePath = join(packageRoot, 'agents', 'karpathy-reviewer.md');
    const targetPath = join(targetRoot, 'karpathy-reviewer.md');

    // First install
    installBundledAgents({ packageRoot, targetRoot });
    const firstContent = readFileSync(targetPath, 'utf8');

    // Upgrade the source content (simulate a new peaks-cli release).
    // The marker still references the old SHA, so the function
    // detects drift and SKIPS to preserve the user's local file.
    writeFileSync(sourcePath, `${firstContent}\nupgraded content`, 'utf8');

    const result = installBundledAgents({ packageRoot, targetRoot });

    expect(result.installed).toEqual([]);
    expect(result.skipped).toEqual(['karpathy-reviewer.md']);
    await expect(readFile(targetPath, 'utf8')).resolves.toBe(firstContent);
  });

  test('does not overwrite user-authored agents (no Peaks-managed marker)', async () => {
    const packageRoot = createPackageRoot([], [], ['karpathy-reviewer.md']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-agents-'));
    const targetPath = join(targetRoot, 'karpathy-reviewer.md');
    writeFileSync(targetPath, '# my custom agent prompt\n', 'utf8');

    const result = installBundledAgents({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toBe('# my custom agent prompt\n');
    expect(result).toEqual({ installed: [], skipped: ['karpathy-reviewer.md'] });
    expect(existsSync(join(targetRoot, 'karpathy-reviewer.md.peaks-managed'))).toBe(false);
  });

  test('does not overwrite agents with spoofed Peaks markers', async () => {
    const packageRoot = createPackageRoot([], [], ['karpathy-reviewer.md']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-agents-'));
    const targetPath = join(targetRoot, 'karpathy-reviewer.md');
    const forgedSourcePath = join(targetRoot, 'fake-package', 'agents', 'karpathy-reviewer.md');
    mkdirSync(join(targetRoot, 'fake-package', 'agents'), { recursive: true });
    writeFileSync(targetPath, 'custom agent prompt', 'utf8');
    writeFileSync(forgedSourcePath, 'custom agent prompt', 'utf8');
    writeFileSync(`${targetPath}.peaks-managed`, createAgentMarker(forgedSourcePath), 'utf8');

    const result = installBundledAgents({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toBe('custom agent prompt');
    expect(result).toEqual({ installed: [], skipped: ['karpathy-reviewer.md'] });
  });

  test('replaces stale agent markers when the target file is missing', async () => {
    const packageRoot = createPackageRoot([], [], ['karpathy-reviewer.md']);
    const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-agents-'));
    const targetPath = join(targetRoot, 'karpathy-reviewer.md');
    const sourcePath = join(packageRoot, 'agents', 'karpathy-reviewer.md');
    writeFileSync(`${targetPath}.peaks-managed`, createAgentMarker(sourcePath), 'utf8');

    const result = installBundledAgents({ packageRoot, targetRoot });

    await expect(readFile(targetPath, 'utf8')).resolves.toContain('name: karpathy-reviewer');
    expect(result).toEqual({ installed: ['karpathy-reviewer.md'], skipped: [] });
  });

  test('skips agent installation when PEAKS_SKIP_AGENT_INSTALL=1', async () => {
    const previousSkipAgent = process.env.PEAKS_SKIP_AGENT_INSTALL;
    process.env.PEAKS_SKIP_AGENT_INSTALL = '1';
    try {
      const packageRoot = createPackageRoot([], [], ['karpathy-reviewer.md']);
      const targetRoot = mkdtempSync(join(tmpdir(), 'peaks-agents-'));

      const result = installBundledAgents({ packageRoot, targetRoot });

      expect(result).toEqual({ installed: [], skipped: [] });
      await expect(lstat(join(targetRoot, 'karpathy-reviewer.md'))).rejects.toThrow();
    } finally {
      if (previousSkipAgent === undefined) {
        delete process.env.PEAKS_SKIP_AGENT_INSTALL;
      } else {
        process.env.PEAKS_SKIP_AGENT_INSTALL = previousSkipAgent;
      }
    }
  });

  test('per-platform fan-out installs all platforms that have an agentsDir profile', async () => {
    const packageRoot = createPackageRoot([], [], ['karpathy-reviewer.md']);
    const claudeTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-agents-claude-'));

    const perPlatform = installBundledAgentsForAllPlatforms({ packageRoot, targetRoot: claudeTargetRoot });

    // Slice 2.6.1.E: 5 platforms now have agentsDir (claude-code + trae + trae-cn + codex + cursor).
    // The other 3 (qoder / tongyi-lingma / hermes / openclaw) are still filtered out.
    expect(perPlatform).toHaveLength(5);
    const ids = perPlatform.map((p) => p.ideId).sort();
    expect(ids).toEqual(['claude-code', 'codex', 'cursor', 'trae', 'trae-cn']);
    for (const p of perPlatform) {
      expect(p.installed).toEqual(['karpathy-reviewer.md']);
      expect(p.skipped).toEqual([]);
    }
    await expect(readFile(join(claudeTargetRoot, 'karpathy-reviewer.md'), 'utf8')).resolves.toContain('name: karpathy-reviewer');
  });

  // Slice 2.6.1.E — cross-platform sanity. The user explicitly asked us
  // NOT to hardcode Unix-style paths. Every agentsDir in the profile
  // table must be derived from `homedir() + join()`, so a Windows user
  // gets `C:\Users\name\.trae\agents` and a Mac user gets
  // `/Users/name/.trae/agents`. The right invariant is that the
  // reported path equals `join(homedir(), '<idename>', 'agents')`
  // for the matching ideId — not that it lacks `/Users/`, since on
  // macOS homedir() itself is `/Users/...`.
  test('agentsDir paths are derived from homedir() (not hardcoded Unix paths)', async () => {
    const packageRoot = createPackageRoot([], [], ['karpathy-reviewer.md']);
    const claudeTargetRoot = mkdtempSync(join(tmpdir(), 'peaks-agents-homedir-'));
    const perPlatform = installBundledAgentsForAllPlatforms({ packageRoot, targetRoot: claudeTargetRoot });

    const expectedByIdeId: Record<string, string> = {
      'claude-code': '.claude',
      'trae': '.trae',
      'trae-cn': '.trae-cn',
      'codex': '.codex',
      'cursor': '.cursor'
    };
    for (const p of perPlatform) {
      const seg = expectedByIdeId[p.ideId] as string;
      // The reported path must equal homedir() + '<seg>' + 'agents'.
      // If a refactor hardcodes '/Users/...' or 'C:\\...' this assertion
      // fails on any platform whose home differs from the hardcode.
      expect(p.agentsDir).toBeDefined();
      expect(p.agentsDir).toBe(join(os.homedir(), seg, 'agents'));
    }
  });
});
