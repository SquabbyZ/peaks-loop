#!/usr/bin/env node
import { closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
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

function validateManagedMarkerPath(markerPath) {
  const markerStats = getPathStats(markerPath);
  if (!markerStats) return;
  if (markerStats.isSymbolicLink()) {
    throw new Error('Peaks managed marker path must not be a symlink');
  }
  if (!markerStats.isFile()) {
    throw new Error('Peaks managed marker path must be a file');
  }
  if (markerStats.nlink !== 1) {
    throw new Error('Peaks managed marker path must not be hardlinked');
  }
}

function validateOpenFile(fd, path, errorMessage) {
  const fdStats = fstatSync(fd);
  const pathStats = lstatSync(path);
  if (!fdStats.isFile() || !pathStats.isFile() || fdStats.dev !== pathStats.dev || fdStats.ino !== pathStats.ino) {
    throw new Error(errorMessage);
  }
  if (fdStats.nlink !== 1 || pathStats.nlink !== 1) {
    throw new Error(`${errorMessage}: hardlinked file`);
  }
}

function createFileIdentity(path) {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    return null;
  }
  return { dev: stats.dev, ino: stats.ino };
}

function isSameFileIdentity(path, identity) {
  if (identity === null) return false;
  const stats = getPathStats(path);
  return Boolean(stats?.isFile() && !stats.isSymbolicLink() && stats.nlink === 1 && stats.dev === identity.dev && stats.ino === identity.ino);
}

function getSafeReadOpenFlags() {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_RDONLY | constants.O_NOFOLLOW : constants.O_RDONLY;
}

function readFileSafely(path, errorMessage) {
  const fd = openSync(path, getSafeReadOpenFlags());
  try {
    validateOpenFile(fd, path, errorMessage);
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

function getManagedTarget(targetPath) {
  const markerPath = `${targetPath}.peaks-managed`;
  validateManagedMarkerPath(markerPath);
  if (!existsSync(markerPath)) {
    return null;
  }
  return readFileSafely(markerPath, 'Peaks managed marker path changed during read').trim();
}

function markManagedPeaksLink(targetPath, sourcePath) {
  const markerPath = `${targetPath}.peaks-managed`;
  validateManagedMarkerPath(markerPath);
  writeFileAtomically(markerPath, `${sourcePath}\n`, 'Peaks managed marker path changed during write', () => validateManagedMarkerPath(markerPath));
}

function readPackageSourceFile(path) {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Peaks package source path must be a file');
  }
  return readFileSync(path, 'utf8');
}

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex');
}

function hashFileContent(path) {
  return hashContent(readFileSafely(path, 'Peaks managed file path changed during read'));
}

function createManagedOutputStyleMarker(sourcePath, outputStyleName) {
  const content = readPackageSourceFile(sourcePath);
  return `${JSON.stringify({ version: 1, kind: 'output-style', outputStyleName, sourcePath, contentSha256: hashContent(content) })}\n`;
}

function parseManagedOutputStyleMarker(managedTarget) {
  if (managedTarget === null) return null;
  try {
    const marker = JSON.parse(managedTarget);
    if (marker?.version !== 1 || marker?.kind !== 'output-style' || typeof marker.outputStyleName !== 'string' || typeof marker.sourcePath !== 'string' || typeof marker.contentSha256 !== 'string') {
      return null;
    }
    return marker;
  } catch {
    return null;
  }
}

function isTrustedOutputStyleSource(marker, sourcePath, outputStyleName) {
  return marker.outputStyleName === outputStyleName && resolve(marker.sourcePath) === resolve(sourcePath) && basename(resolve(marker.sourcePath)) === outputStyleName;
}

function getManagedPeaksOutputStyleIdentity(managedTarget, targetPath, sourcePath, outputStyleName) {
  const marker = parseManagedOutputStyleMarker(managedTarget);
  const sourceHash = hashContent(readPackageSourceFile(sourcePath));
  if (marker === null || !isTrustedOutputStyleSource(marker, sourcePath, outputStyleName) || !existsSync(targetPath) || hashFileContent(targetPath) !== sourceHash || marker.contentSha256 !== sourceHash) {
    return null;
  }
  return createFileIdentity(targetPath);
}

function validateInstallRoot(targetRoot, label) {
  const rootStats = lstatSync(targetRoot);
  if (rootStats.isSymbolicLink()) {
    throw new Error(`${label} install root must not be a symlink`);
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`${label} install root must be a directory`);
  }
  return rootStats;
}

function createInstallRootValidator(targetRoot, label) {
  const expectedStats = validateInstallRoot(targetRoot, label);
  return () => {
    const rootStats = validateInstallRoot(targetRoot, label);
    if (rootStats.dev !== expectedStats.dev || rootStats.ino !== expectedStats.ino) {
      throw new Error(`${label} install root changed during write`);
    }
  };
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
    const parsed = JSON.parse(readFileSafely(configPath, `${label} config path changed during read`));
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
    if (configStats.nlink !== 1) {
      throw new Error(`${label} config path must not be hardlinked`);
    }
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

function getSafeTempOpenFlags() {
  const baseFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
  return typeof constants.O_NOFOLLOW === 'number' ? baseFlags | constants.O_NOFOLLOW : baseFlags;
}

function writeFileExclusively(path, content, errorMessage, validateBeforeWrite) {
  validateBeforeWrite();
  let fd = openSync(path, getSafeTempOpenFlags(), 0o600);
  let closeError = null;
  let identity = null;
  try {
    validateOpenFile(fd, path, errorMessage);
    validateBeforeWrite();
    validateOpenFile(fd, path, errorMessage);
    identity = createFileIdentity(path);
    if (identity === null) {
      throw new Error(errorMessage);
    }
    fchmodSync(fd, 0o600);
    writeFileSync(fd, content, 'utf8');
    const writeFd = fd;
    fd = null;
    closeSync(writeFd);
    return identity;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch (error) {
        closeError = error;
      }
    }
    if (closeError) {
      throw closeError;
    }
  }
}

function writeFileAtomically(configPath, content, errorMessage, validateBeforeWrite) {
  validateBeforeWrite();

  const tempPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  let fd = openSync(tempPath, getSafeTempOpenFlags(), 0o600);
  let renamed = false;
  let closeError = null;
  try {
    validateOpenFile(fd, tempPath, errorMessage);
    fchmodSync(fd, 0o600);
    writeFileSync(fd, content, 'utf8');
    const writeFd = fd;
    fd = null;
    closeSync(writeFd);
    validateBeforeWrite();
    const readFd = openSync(tempPath, getSafeReadOpenFlags());
    try {
      validateOpenFile(readFd, tempPath, errorMessage);
    } finally {
      closeSync(readFd);
    }
    renameSync(tempPath, configPath);
    renamed = true;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch (error) {
        closeError = error;
      }
    }
    try {
      if (!renamed && existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } finally {
      if (closeError) {
        throw closeError;
      }
    }
  }
}

function writeProjectConfig(projectRoot, peaksRoot, configPath, content) {
  writeFileAtomically(configPath, content, 'Project config path changed during write', () => validateProjectConfigPaths(projectRoot, peaksRoot, configPath));
}

function writeUserConfig(userRoot, peaksRoot, configPath, content) {
  writeFileAtomically(configPath, content, 'User config path changed during write', () => validateUserConfigPaths(userRoot, peaksRoot, configPath));
}

function resolveProjectRoot(options) {
  const projectRoot = options.projectRoot ?? process.env.PEAKS_PROJECT_ROOT ?? process.env.INIT_CWD;
  return projectRoot ? resolve(projectRoot) : null;
}

/**
 * Slice #011: Detect the installed IDE for the postinstall dispatch layer.
 *
 * Mirrors `src/services/ide/ide-detector.ts:detectInstalledIde` (cwd heuristic)
 * but inlined here because `install-skills.mjs` is a plain `.mjs` script and
 * cannot import the TS service at runtime. The dispatch:
 *   - Look for `.claude`, `.trae`, `.codex`, `.cursor`, `.qoder`,
 *     `.tongyi-lingma` in the project root in that insertion order
 *     (matches the registry's adapter order in `src/services/ide/ide-registry.ts`).
 *   - Returns the first match, or `null` if no adapter's directory is present.
 *
 * If the resolved IDE has no `skillInstall` declared (Trae in slice 1.3.2),
 * the caller falls back to the legacy `~/.claude/{skills,output-styles}` path
 * + emits a stderr warning. The dispatch is conservative: the env-var
 * overrides `PEAKS_CLAUDE_SKILLS_DIR` / `PEAKS_CLAUDE_OUTPUT_STYLES_DIR`
 * continue to work, and the legacy default is preserved.
 */
const IDE_DETECTION_DIRS = [
  { id: 'claude-code', dir: '.claude' },
  { id: 'trae', dir: '.trae' },
  { id: 'codex', dir: '.codex' },
  { id: 'cursor', dir: '.cursor' },
  { id: 'qoder', dir: '.qoder' },
  { id: 'tongyi-lingma', dir: '.tongyi-lingma' },
];

const IDE_SKILL_INSTALL_PROFILES = {
  'claude-code': {
    skillsDir: join(homedir(), '.claude', 'skills'),
    outputStylesDir: join(homedir(), '.claude', 'output-styles'),
    envVar: 'PEAKS_CLAUDE_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_CLAUDE_OUTPUT_STYLES_DIR',
  },
  'trae': null,
  'codex': null,
  'cursor': null,
  'qoder': null,
  'tongyi-lingma': null,
};

function detectInstalledIdeId(projectRoot) {
  if (!projectRoot) return null;
  for (const { id, dir } of IDE_DETECTION_DIRS) {
    if (existsSync(join(projectRoot, dir))) {
      return id;
    }
  }
  return null;
}

function resolveIdeSkillInstallProfile(ideId) {
  if (ideId === null) return null;
  return IDE_SKILL_INSTALL_PROFILES[ideId] ?? null;
}

function warnUnverifiedIde(ideId, projectRoot) {
  process.stderr.write(
    `peaks install-skills: IDE '${ideId}' has no skillInstall profile declared; ` +
      `falling back to the legacy Claude Code path (~/.claude/skills + ~/.claude/output-styles) ` +
      `for project '${projectRoot}'. This is a slice #011 follow-up gap; ` +
      `see .peaks/memory/ide-adapter-resource-profile-framework.md.\n`
  );
}

function warnNoIdeDetected(projectRoot) {
  process.stderr.write(
    `peaks install-skills: no IDE detected in '${projectRoot ?? '(project root unknown)'}'; ` +
      `installing to the legacy Claude Code path (~/.claude/skills + ~/.claude/output-styles). ` +
      `Set PEAKS_CLAUDE_SKILLS_DIR / PEAKS_CLAUDE_OUTPUT_STYLES_DIR to override.\n`
  );
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

  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || !existsSync(skillsRoot)) {
    return createInstallResult();
  }

  // Slice #011: IDE-aware dispatch. Precedence (highest first):
  //   1. explicit options.targetRoot            (test / hook override)
  //   2. options.ideId skillInstall.skillsDir   (per-IDE dispatch)
  //   3. PEAKS_CLAUDE_SKILLS_DIR env var        (legacy back-compat)
  //   4. detected IDE's skillInstall.skillsDir  (auto-detect from projectRoot)
  //   5. legacy default (~/.claude/skills)      (no-IDE fallback)
  const projectRoot = resolveProjectRoot(options);
  const detectedIdeId = detectInstalledIdeId(projectRoot);
  const detectedProfile = resolveIdeSkillInstallProfile(detectedIdeId);

  if (options.targetRoot === undefined && options.ideId === undefined && detectedProfile === null && detectedIdeId !== null) {
    warnUnverifiedIde(detectedIdeId, projectRoot ?? '(project root unknown)');
  }
  if (options.targetRoot === undefined && options.ideId === undefined && detectedIdeId === null && projectRoot !== null) {
    warnNoIdeDetected(projectRoot);
  }

  const profileSkillsDir = detectedProfile?.skillsDir ?? null;
  const targetRoot = resolve(
    options.targetRoot
      ?? (options.ideId !== undefined ? resolveIdeSkillInstallProfile(options.ideId)?.skillsDir ?? null : null)
      ?? process.env.PEAKS_CLAUDE_SKILLS_DIR
      ?? profileSkillsDir
      ?? join(homedir(), '.claude', 'skills')
  );

  const installed = [];
  const skipped = [];
  mkdirSync(targetRoot, { recursive: true });
  const validateSkillsRoot = createInstallRootValidator(targetRoot, 'Peaks skills');

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
      const linkTarget = current.isSymbolicLink() ? readlinkSync(targetPath) : null;
      if (linkTarget === sourcePath) {
        installed.push(skillName);
        continue;
      }
      if ((current.isSymbolicLink() || isBrokenSymlink(current, targetPath)) && managedTarget === linkTarget) {
        validateSkillsRoot();
        unlinkSync(targetPath);
        validateSkillsRoot();
        unlinkSync(`${targetPath}.peaks-managed`);
      } else {
        skipped.push(skillName);
        continue;
      }
    }

    validateSkillsRoot();
    symlinkSync(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      validateSkillsRoot();
      markManagedPeaksLink(targetPath, sourcePath);
    } catch (error) {
      validateSkillsRoot();
      const created = getPathStats(targetPath);
      if (created?.isSymbolicLink() && readlinkSync(targetPath) === sourcePath) {
        unlinkSync(targetPath);
      }
      throw error;
    }
    installed.push(skillName);
  }

  return { installed, skipped };
}

export function installBundledOutputStyles(options = {}) {
  const packageRoot = resolvePackageRoot(options);
  const outputStylesRoot = join(packageRoot, 'output-styles');

  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || !existsSync(outputStylesRoot)) {
    return createInstallResult();
  }

  // Slice #011: IDE-aware dispatch. Same precedence as installBundledSkills.
  const projectRoot = resolveProjectRoot(options);
  const detectedIdeId = detectInstalledIdeId(projectRoot);
  const detectedProfile = resolveIdeSkillInstallProfile(detectedIdeId);

  const profileOutputStylesDir = detectedProfile?.outputStylesDir ?? null;
  const targetRoot = resolve(
    options.targetRoot
      ?? (options.ideId !== undefined ? resolveIdeSkillInstallProfile(options.ideId)?.outputStylesDir ?? null : null)
      ?? process.env.PEAKS_CLAUDE_OUTPUT_STYLES_DIR
      ?? profileOutputStylesDir
      ?? join(homedir(), '.claude', 'output-styles')
  );

  const installed = [];
  const skipped = [];
  mkdirSync(targetRoot, { recursive: true });
  const validateOutputStylesRoot = createInstallRootValidator(targetRoot, 'Peaks output styles');

  for (const outputStyleName of readdirSync(outputStylesRoot)) {
    const sourcePath = join(outputStylesRoot, outputStyleName);
    const targetPath = join(targetRoot, outputStyleName);

    if (!lstatSync(sourcePath).isFile() || !outputStyleName.endsWith('.md')) {
      continue;
    }

    const current = getPathStats(targetPath);
    if (current) {
      const managedTarget = getManagedTarget(targetPath);
      const managedTargetIdentity = getManagedPeaksOutputStyleIdentity(managedTarget, targetPath, sourcePath, outputStyleName);
      if (isSameFileIdentity(targetPath, managedTargetIdentity)) {
        validateOutputStylesRoot();
        if (!isSameFileIdentity(targetPath, managedTargetIdentity)) {
          throw new Error('Peaks output style path changed during unlink');
        }
        unlinkSync(targetPath);
        validateOutputStylesRoot();
        unlinkSync(`${targetPath}.peaks-managed`);
      } else {
        skipped.push(outputStyleName);
        continue;
      }
    }

    const markerPath = `${targetPath}.peaks-managed`;
    validateManagedMarkerPath(markerPath);
    if (!current && existsSync(markerPath)) {
      validateOutputStylesRoot();
      unlinkSync(markerPath);
    }
    const createdTargetIdentity = writeFileExclusively(targetPath, readPackageSourceFile(sourcePath), 'Peaks output style path changed during write', validateOutputStylesRoot);
    try {
      writeFileExclusively(markerPath, createManagedOutputStyleMarker(sourcePath, outputStyleName), 'Peaks managed marker path changed during write', () => {
        validateOutputStylesRoot();
        validateManagedMarkerPath(markerPath);
      });
    } catch (error) {
      validateOutputStylesRoot();
      if (isSameFileIdentity(targetPath, createdTargetIdentity)) {
        unlinkSync(targetPath);
      }
      throw error;
    }
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
