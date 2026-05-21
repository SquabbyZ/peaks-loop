#!/usr/bin/env node
import { closeSync, constants, copyFileSync, existsSync, fchmodSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function getPathStats(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function isBrokenSymlink(stats, targetPath) {
  return stats.isSymbolicLink() && !existsSync(targetPath);
}

function getManagedTarget(targetPath) {
  const markerPath = `${targetPath}.peaks-managed`;
  if (!existsSync(markerPath)) {
    return null;
  }
  return readFileSync(markerPath, 'utf8').trim();
}

function markManagedPeaksLink(targetPath, sourcePath) {
  const markerPath = `${targetPath}.peaks-managed`;
  writeFileSync(markerPath, `${sourcePath}\n`, 'utf8');
}

function isManagedPeaksOutputStyle(managedTarget, outputStyleName) {
  if (managedTarget === null) return false;
  return managedTarget.replaceAll('\\', '/').endsWith(`/output-styles/${outputStyleName}`);
}

function createInstallResult() {
  return { installed: [], skipped: [] };
}

function resolvePackageRoot(options = {}) {
  return resolve(options.packageRoot ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
}

function readPackageVersion(packageRoot = resolvePackageRoot()) {
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json version must be a non-empty string');
  }

  return packageJson.version;
}

function createConfigDefaults(packageRoot) {
  return {
    version: readPackageVersion(packageRoot),
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
  };
}

function createConfigResult(overrides = {}) {
  return { created: false, updated: false, skipped: false, ...overrides };
}

function isInsidePath(childPath, parentPath) {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeMissingConfigValues(existing, defaults) {
  return Object.entries(defaults).reduce((next, [key, defaultValue]) => {
    if (!(key in next)) {
      return { ...next, [key]: defaultValue };
    }

    const existingValue = next[key];
    if (isPlainObject(existingValue) && isPlainObject(defaultValue)) {
      return { ...next, [key]: mergeMissingConfigValues(existingValue, defaultValue) };
    }

    return next;
  }, { ...existing });
}

function readConfigFile(configPath, label) {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!isPlainObject(parsed)) {
      throw new Error(`${label} config must contain a JSON object`);
    }

    return parsed;
  } catch (error) {
    const message = error instanceof SyntaxError ? `${label} config must contain valid JSON` : error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
}

function validateConfigPath(root, peaksRoot, configPath, label) {
  const rootReal = realpathSync(root);
  const peaksStats = lstatSync(peaksRoot);
  const peaksReal = realpathSync(peaksRoot);
  if (!peaksStats.isDirectory() || peaksStats.isSymbolicLink() || peaksReal !== resolve(rootReal, '.peaks')) {
    throw new Error(`${label} config path must stay inside the ${label.toLowerCase()} root`);
  }

  const configStats = getPathStats(configPath);
  if (configStats?.isSymbolicLink()) {
    throw new Error(`${label} config path must not be a symlink`);
  }
  if (configStats && !configStats.isFile()) {
    throw new Error(`${label} config path must be a file`);
  }
  if (configStats) {
    const configReal = realpathSync(configPath);
    if (!isInsidePath(configReal, rootReal) || !isInsidePath(configReal, peaksReal)) {
      throw new Error(`${label} config path must stay inside the ${label.toLowerCase()} root`);
    }
  }
}

function validateProjectConfigPaths(projectRoot, peaksRoot, configPath) {
  validateConfigPath(projectRoot, peaksRoot, configPath, 'Project');
}

function validateUserConfigPaths(userRoot, peaksRoot, configPath) {
  validateConfigPath(userRoot, peaksRoot, configPath, 'User');
}

function validateOpenConfigFile(fd, configPath, label) {
  const fdStats = fstatSync(fd);
  const pathStats = lstatSync(configPath);
  if (!fdStats.isFile() || !pathStats.isFile() || fdStats.dev !== pathStats.dev || fdStats.ino !== pathStats.ino) {
    throw new Error(`${label} config path changed during write`);
  }
  if (fdStats.nlink !== 1 || pathStats.nlink !== 1) {
    throw new Error(`${label} config path must not be hardlinked`);
  }
}

function writeConfigFile(configPath, content, label, validateBeforeWrite) {
  validateBeforeWrite();
  if (typeof constants.O_NOFOLLOW !== 'number') {
    throw new Error('Safe config writes require O_NOFOLLOW support');
  }

  const fd = openSync(configPath, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    validateBeforeWrite();
    validateOpenConfigFile(fd, configPath, label);
    fchmodSync(fd, 0o600);
    ftruncateSync(fd, 0);
    writeFileSync(fd, content, 'utf8');
  } finally {
    closeSync(fd);
  }
}

function writeProjectConfig(projectRoot, peaksRoot, configPath, content) {
  writeConfigFile(configPath, content, 'Project', () => validateProjectConfigPaths(projectRoot, peaksRoot, configPath));
}

function writeUserConfig(userRoot, peaksRoot, configPath, content) {
  writeConfigFile(configPath, content, 'User', () => validateUserConfigPaths(userRoot, peaksRoot, configPath));
}

function resolveProjectRoot(options) {
  const projectRoot = options.projectRoot ?? process.env.PEAKS_PROJECT_ROOT ?? process.env.INIT_CWD;
  return projectRoot ? resolve(projectRoot) : null;
}

function writeMergedConfig(configPath, label, defaults, writeConfig) {
  const existing = readConfigFile(configPath, label);
  const next = { ...(existing === null ? defaults : mergeMissingConfigValues(existing, defaults)), version: defaults.version };
  const currentJson = existing === null ? null : `${JSON.stringify(existing, null, 2)}\n`;
  const nextJson = `${JSON.stringify(next, null, 2)}\n`;

  if (currentJson === nextJson) {
    return createConfigResult();
  }

  writeConfig(nextJson);
  return createConfigResult(existing === null ? { created: true } : { updated: true });
}

export function installUserConfig(options = {}) {
  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || process.env.PEAKS_SKIP_USER_CONFIG_INSTALL === '1') {
    return createConfigResult({ skipped: true });
  }

  const userRoot = resolve(options.userRoot ?? homedir());
  const peaksRoot = resolve(userRoot, '.peaks');
  const configPath = resolve(peaksRoot, 'config.json');
  if (!isInsidePath(configPath, userRoot)) {
    throw new Error('User config path must stay inside the user root');
  }

  if (!existsSync(peaksRoot)) {
    mkdirSync(peaksRoot, { recursive: true });
  }
  validateUserConfigPaths(userRoot, peaksRoot, configPath);

  return writeMergedConfig(configPath, 'User', createConfigDefaults(options.packageRoot), (content) => writeUserConfig(userRoot, peaksRoot, configPath, content));
}

export function installProjectConfig(options = {}) {
  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || process.env.PEAKS_SKIP_PROJECT_CONFIG_INSTALL === '1') {
    return createConfigResult({ skipped: true });
  }

  const projectRoot = resolveProjectRoot(options);
  if (!projectRoot) {
    return createConfigResult({ skipped: true });
  }

  const peaksRoot = resolve(projectRoot, '.peaks');
  const configPath = resolve(peaksRoot, 'config.json');
  if (!isInsidePath(configPath, projectRoot)) {
    throw new Error('Project config path must stay inside the project root');
  }

  if (!existsSync(peaksRoot)) {
    mkdirSync(peaksRoot, { recursive: true });
  }
  validateProjectConfigPaths(projectRoot, peaksRoot, configPath);

  return writeMergedConfig(configPath, 'Project', createConfigDefaults(options.packageRoot), (content) => writeProjectConfig(projectRoot, peaksRoot, configPath, content));
}

export function installBundledSkills(options = {}) {
  const packageRoot = resolvePackageRoot(options);
  const skillsRoot = join(packageRoot, 'skills');
  const targetRoot = resolve(options.targetRoot ?? process.env.PEAKS_CLAUDE_SKILLS_DIR ?? join(homedir(), '.claude', 'skills'));

  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || !existsSync(skillsRoot)) {
    return createInstallResult();
  }

  const installed = [];
  const skipped = [];
  mkdirSync(targetRoot, { recursive: true });

  for (const skillName of readdirSync(skillsRoot)) {
    const sourcePath = join(skillsRoot, skillName);
    const skillFile = join(sourcePath, 'SKILL.md');
    const targetPath = join(targetRoot, skillName);

    if (!lstatSync(sourcePath).isDirectory() || !existsSync(skillFile)) {
      continue;
    }

    const current = getPathStats(targetPath);
    if (current) {
      const managedTarget = getManagedTarget(targetPath);
      if (current.isSymbolicLink() && readlinkSync(targetPath) === sourcePath) {
        installed.push(skillName);
        continue;
      }
      if (isBrokenSymlink(current, targetPath) && managedTarget === readlinkSync(targetPath)) {
        unlinkSync(targetPath);
        unlinkSync(`${targetPath}.peaks-managed`);
      } else {
        skipped.push(skillName);
        continue;
      }
    }

    symlinkSync(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
    markManagedPeaksLink(targetPath, sourcePath);
    installed.push(skillName);
  }

  return { installed, skipped };
}

export function installBundledOutputStyles(options = {}) {
  const packageRoot = resolvePackageRoot(options);
  const outputStylesRoot = join(packageRoot, 'output-styles');
  const targetRoot = resolve(options.targetRoot ?? process.env.PEAKS_CLAUDE_OUTPUT_STYLES_DIR ?? join(homedir(), '.claude', 'output-styles'));

  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || !existsSync(outputStylesRoot)) {
    return createInstallResult();
  }

  const installed = [];
  const skipped = [];
  mkdirSync(targetRoot, { recursive: true });

  for (const outputStyleName of readdirSync(outputStylesRoot)) {
    const sourcePath = join(outputStylesRoot, outputStyleName);
    const targetPath = join(targetRoot, outputStyleName);

    if (!lstatSync(sourcePath).isFile() || !outputStyleName.endsWith('.md')) {
      continue;
    }

    const current = getPathStats(targetPath);
    if (current) {
      const managedTarget = getManagedTarget(targetPath);
      if (isManagedPeaksOutputStyle(managedTarget, outputStyleName)) {
        unlinkSync(targetPath);
        unlinkSync(`${targetPath}.peaks-managed`);
      } else {
        skipped.push(outputStyleName);
        continue;
      }
    }

    copyFileSync(sourcePath, targetPath);
    markManagedPeaksLink(targetPath, sourcePath);
    installed.push(outputStyleName);
  }

  return { installed, skipped };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const skillsResult = installBundledSkills();
    const outputStylesResult = installBundledOutputStyles();
    let userConfigResult = createConfigResult({ skipped: true });
    try {
      userConfigResult = installUserConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Peaks user config was not installed: ${message}\n`);
    }
    if (skillsResult.installed.length > 0) {
      process.stdout.write(`Peaks skills linked: ${skillsResult.installed.join(', ')}\n`);
    }
    if (skillsResult.skipped.length > 0) {
      process.stderr.write(`Peaks skills skipped because local files already exist: ${skillsResult.skipped.join(', ')}\n`);
    }
    if (outputStylesResult.installed.length > 0) {
      process.stdout.write(`Peaks output styles installed: ${outputStylesResult.installed.join(', ')}\n`);
    }
    if (outputStylesResult.skipped.length > 0) {
      process.stderr.write(`Peaks output styles skipped because local files already exist: ${outputStylesResult.skipped.join(', ')}\n`);
    }
    if (userConfigResult.created) {
      process.stdout.write('Peaks user config created: ~/.peaks/config.json\n');
    }
    if (userConfigResult.updated) {
      process.stdout.write('Peaks user config updated: ~/.peaks/config.json\n');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Peaks skills and output styles were not installed: ${message}\n`);
    process.exitCode = 1;
  }
}
