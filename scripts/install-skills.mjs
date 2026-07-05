#!/usr/bin/env node
import { closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
  { id: 'trae-cn', dir: '.trae-cn' },
  { id: 'codex', dir: '.codex' },
  { id: 'cursor', dir: '.cursor' },
  { id: 'qoder', dir: '.qoder' },
  { id: 'tongyi-lingma', dir: '.tongyi-lingma' },
];

/**
 * Per-IDE skill install paths. Per peaks-loop tenet
 * "minimal-user-operation" (2026-06-11), the user should
 * never have to run a per-platform install command — the
 * `npm i -g peaks-loop` postinstall iterates ALL of these
 * and symlinks the peaks-* skill family to every platform
 * the user might be on.
 *
 * 1.x had only `claude-code` (the other 5 entries were
 * `null`); real Trae users reported the Trae skill
 * directory was never populated. 2.0 fixes this by giving
 * all 8 platforms canonical install paths.
 */
const IDE_SKILL_INSTALL_PROFILES = {
  'claude-code': {
    skillsDir: join(homedir(), '.claude', 'skills'),
    outputStylesDir: join(homedir(), '.claude', 'output-styles'),
    agentsDir: join(homedir(), '.claude', 'agents'),
    envVar: 'PEAKS_CLAUDE_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_CLAUDE_OUTPUT_STYLES_DIR',
    agentsEnvVar: 'PEAKS_CLAUDE_AGENTS_DIR',
  },
  'trae': {
    skillsDir: join(homedir(), '.trae', 'skills'),
    outputStylesDir: join(homedir(), '.trae', 'output-styles'),
    agentsDir: join(homedir(), '.trae', 'agents'),
    envVar: 'PEAKS_TRAE_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_TRAE_OUTPUT_STYLES_DIR',
    agentsEnvVar: 'PEAKS_TRAE_AGENTS_DIR',
  },
  'trae-cn': {
    skillsDir: join(homedir(), '.trae-cn', 'skills'),
    outputStylesDir: join(homedir(), '.trae-cn', 'output-styles'),
    agentsDir: join(homedir(), '.trae-cn', 'agents'),
    envVar: 'PEAKS_TRAE_CN_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_TRAE_CN_OUTPUT_STYLES_DIR',
    agentsEnvVar: 'PEAKS_TRAE_CN_AGENTS_DIR',
  },
  'codex': {
    skillsDir: join(homedir(), '.codex', 'skills'),
    outputStylesDir: join(homedir(), '.codex', 'output-styles'),
    agentsDir: join(homedir(), '.codex', 'agents'),
    envVar: 'PEAKS_CODEX_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_CODEX_OUTPUT_STYLES_DIR',
    agentsEnvVar: 'PEAKS_CODEX_AGENTS_DIR',
  },
  'cursor': {
    skillsDir: join(homedir(), '.cursor', 'skills'),
    outputStylesDir: join(homedir(), '.cursor', 'output-styles'),
    agentsDir: join(homedir(), '.cursor', 'agents'),
    envVar: 'PEAKS_CURSOR_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_CURSOR_OUTPUT_STYLES_DIR',
    agentsEnvVar: 'PEAKS_CURSOR_AGENTS_DIR',
  },
  'qoder': {
    skillsDir: join(homedir(), '.qoder', 'skills'),
    outputStylesDir: join(homedir(), '.qoder', 'output-styles'),
    envVar: 'PEAKS_QODER_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_QODER_OUTPUT_STYLES_DIR',
  },
  'tongyi-lingma': {
    skillsDir: join(homedir(), '.tongyi-lingma', 'skills'),
    outputStylesDir: join(homedir(), '.tongyi-lingma', 'output-styles'),
    envVar: 'PEAKS_TONGYI_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_TONGYI_OUTPUT_STYLES_DIR',
  },
  'hermes': {
    skillsDir: join(homedir(), '.hermes', 'skills'),
    outputStylesDir: join(homedir(), '.hermes', 'output-styles'),
    envVar: 'PEAKS_HERMES_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_HERMES_OUTPUT_STYLES_DIR',
  },
  'openclaw': {
    skillsDir: join(homedir(), '.openclaw', 'skills'),
    outputStylesDir: join(homedir(), '.openclaw', 'output-styles'),
    envVar: 'PEAKS_OPENCLAW_SKILLS_DIR',
    outputStylesEnvVar: 'PEAKS_OPENCLAW_OUTPUT_STYLES_DIR',
  },
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

  // After the v2.13.0 bee-demote (commit de0872b), the role skills
  // (peaks-prd, peaks-rd, peaks-qa, peaks-ui, peaks-sc, peaks-txt)
  // moved under `skills/bee/<role>/` while user-facing helpers stayed
  // at `skills/<name>/`. Build the install candidate list by walking
  // top-level entries (user-facing helpers) AND `skills/bee/<role>`
  // (demoted role skills). Each candidate is installed under its
  // basename so the postinstall links `~/.claude/skills/peaks-rd`
  // to `skills/bee/peaks-rd` (rather than `skills/bee`).
  const beeRoot = join(skillsRoot, 'bee');
  /** @type {Array<{ skillName: string, sourcePath: string }>} */
  const candidates = [];
  for (const skillName of readdirSync(skillsRoot)) {
    if (skillName === 'bee') continue;
    const sourcePath = join(skillsRoot, skillName);
    const skillFile = join(sourcePath, 'SKILL.md');
    if (!lstatSync(sourcePath).isDirectory() || !existsSync(skillFile)) continue;
    candidates.push({ skillName, sourcePath });
  }
  if (existsSync(beeRoot) && lstatSync(beeRoot).isDirectory()) {
    for (const skillName of readdirSync(beeRoot)) {
      const sourcePath = join(beeRoot, skillName);
      const skillFile = join(sourcePath, 'SKILL.md');
      if (!lstatSync(sourcePath).isDirectory() || !existsSync(skillFile)) continue;
      // De-dupe: a top-level helper with the same name wins (preserves
      // the existing install contract for any helper that shares a name
      // with a demoted role skill, e.g. legacy overlap).
      if (candidates.some((c) => c.skillName === skillName)) continue;
      candidates.push({ skillName, sourcePath });
    }
  }

  for (const { skillName, sourcePath } of candidates) {
    const targetPath = join(targetRoot, skillName);

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

/**
 * Slice 7/7 — bundled agents (Claude Code sub-agent prompts).
 *
 * Mirrors `installBundledOutputStyles` but writes to
 * `~/.claude/agents/` (Claude Code's sub-agent loader directory). Each
 * agent file ships under `agents/*.md` in the peaks-loop tarball and is
 * copied on `npm i -g peaks-loop@latest` with content-hash drift detection
 * via a `.peaks-managed` marker (SHA-256 of the source content).
 *
 * Drift policy (mirrors output-styles):
 *   - file missing, marker missing       → install (write file + marker)
 *   - file missing, marker present       → install (replace stale marker)
 *   - file present, marker present,
 *     SHA matches, sourcePath matches    → skip (idempotent re-install)
 *   - file present, marker present,
 *     SHA matches, sourcePath differs    → skip (stale package path;
 *                                            preserve user's local file)
 *   - file present, marker present,
 *     SHA differs                        → overwrite (package upgrade)
 *   - file present, no marker            → skip (user-authored file;
 *                                            preserve)
 */
function createManagedAgentMarker(sourcePath, agentName) {
  const content = readPackageSourceFile(sourcePath);
  return `${JSON.stringify({ version: 1, kind: 'agent', agentName, sourcePath, contentSha256: hashContent(content) })}\n`;
}

function parseManagedAgentMarker(managedTarget) {
  if (managedTarget === null) return null;
  try {
    const marker = JSON.parse(managedTarget);
    if (marker?.version !== 1 || marker?.kind !== 'agent' || typeof marker.agentName !== 'string' || typeof marker.sourcePath !== 'string' || typeof marker.contentSha256 !== 'string') {
      return null;
    }
    return marker;
  } catch {
    return null;
  }
}

function isTrustedAgentSource(marker, sourcePath, agentName) {
  return marker.agentName === agentName && resolve(marker.sourcePath) === resolve(sourcePath) && basename(resolve(marker.sourcePath)) === agentName;
}

function getManagedPeaksAgentIdentity(managedTarget, targetPath, sourcePath, agentName) {
  const marker = parseManagedAgentMarker(managedTarget);
  const sourceHash = hashContent(readPackageSourceFile(sourcePath));
  if (marker === null || !isTrustedAgentSource(marker, sourcePath, agentName) || !existsSync(targetPath) || hashFileContent(targetPath) !== sourceHash || marker.contentSha256 !== sourceHash) {
    return null;
  }
  return createFileIdentity(targetPath);
}

export function installBundledAgents(options = {}) {
  const packageRoot = resolvePackageRoot(options);
  const agentsRoot = join(packageRoot, 'agents');

  // Per-IDE env-var override (claude-code only today): PEAKS_CLAUDE_AGENTS_DIR.
  // Universal escape hatch: PEAKS_SKIP_AGENT_INSTALL=1 (parallel to
  // PEAKS_SKIP_SKILL_INSTALL).
  if (process.env.PEAKS_SKIP_SKILL_INSTALL === '1' || process.env.PEAKS_SKIP_AGENT_INSTALL === '1' || !existsSync(agentsRoot)) {
    return createInstallResult();
  }

  // Slice #011: IDE-aware dispatch. Same precedence as installBundledOutputStyles.
  const projectRoot = resolveProjectRoot(options);
  const detectedIdeId = detectInstalledIdeId(projectRoot);
  const detectedProfile = resolveIdeSkillInstallProfile(detectedIdeId);

  const profileAgentsDir = detectedProfile?.agentsDir ?? null;
  const targetRoot = resolve(
    options.targetRoot
      ?? (options.ideId !== undefined ? resolveIdeSkillInstallProfile(options.ideId)?.agentsDir ?? null : null)
      ?? process.env.PEAKS_CLAUDE_AGENTS_DIR
      ?? profileAgentsDir
      ?? join(homedir(), '.claude', 'agents')
  );

  const installed = [];
  const skipped = [];
  mkdirSync(targetRoot, { recursive: true });
  const validateAgentsRoot = createInstallRootValidator(targetRoot, 'Peaks agents');

  for (const agentFileName of readdirSync(agentsRoot)) {
    const sourcePath = join(agentsRoot, agentFileName);
    const targetPath = join(targetRoot, agentFileName);

    if (!lstatSync(sourcePath).isFile() || !agentFileName.endsWith('.md')) {
      continue;
    }

    const current = getPathStats(targetPath);
    if (current) {
      const managedTarget = getManagedTarget(targetPath);
      const managedTargetIdentity = getManagedPeaksAgentIdentity(managedTarget, targetPath, sourcePath, agentFileName);
      if (isSameFileIdentity(targetPath, managedTargetIdentity)) {
        validateAgentsRoot();
        if (!isSameFileIdentity(targetPath, managedTargetIdentity)) {
          throw new Error('Peaks agent path changed during unlink');
        }
        unlinkSync(targetPath);
        validateAgentsRoot();
        unlinkSync(`${targetPath}.peaks-managed`);
      } else {
        skipped.push(agentFileName);
        continue;
      }
    }

    const markerPath = `${targetPath}.peaks-managed`;
    validateManagedMarkerPath(markerPath);
    if (!current && existsSync(markerPath)) {
      validateAgentsRoot();
      unlinkSync(markerPath);
    }
    const createdTargetIdentity = writeFileExclusively(targetPath, readPackageSourceFile(sourcePath), 'Peaks agent path changed during write', validateAgentsRoot);
    try {
      writeFileExclusively(markerPath, createManagedAgentMarker(sourcePath, agentFileName), 'Peaks managed marker path changed during write', () => {
        validateAgentsRoot();
        validateManagedMarkerPath(markerPath);
      });
    } catch (error) {
      validateAgentsRoot();
      if (isSameFileIdentity(targetPath, createdTargetIdentity)) {
        unlinkSync(targetPath);
      }
      throw error;
    }
    installed.push(agentFileName);
  }

  return { installed, skipped };
}

/**
 * Per-platform fan-out — iterate ALL 8 IdeIds and call
 * `installBundledAgents` for each platform that has an `agentsDir` profile
 * field. Only `claude-code` ships with `agentsDir` set today; the other 7
 * platforms return `installed: []` from their profile lookup. Future
 * platforms can add an `agentsDir` field to their `IDE_SKILL_INSTALL_PROFILES`
 * entry to opt in.
 *
 * Per peaks-loop tenet "minimal-user-operation" (2026-06-11): the user
 * should never have to run a per-platform install command. Symlink /
 * copy failures are soft (logged to stderr, never throw) so one platform's
 * failure doesn't block the others.
 */
export function installBundledAgentsForAllPlatforms(options = {}) {
  const platforms = Object.entries(IDE_SKILL_INSTALL_PROFILES)
    .filter(([, profile]) => typeof profile.agentsDir === 'string');
  const perPlatform = [];
  for (const [ideId, profile] of platforms) {
    try {
      // Per-platform env-var override (claude-code only today):
      // PEAKS_CLAUDE_AGENTS_DIR. This is the same precedence as
      // installBundledSkillsForAllPlatforms (slice #011). For the
      // claude-code iteration, if the env var is set, use it as
      // `targetRoot` (so the env var takes priority over the profile).
      // For test mode, options.targetRoot also wins.
      const envOverride = ideId === 'claude-code'
        ? process.env.PEAKS_CLAUDE_AGENTS_DIR
        : undefined;
      const platformOpts = (envOverride !== undefined && envOverride.length > 0)
        ? { ...options, ideId, targetRoot: envOverride }
        : (options.targetRoot !== undefined
          ? { ...options, ideId, targetRoot: options.targetRoot }
          : { ...options, ideId });
      const result = installBundledAgents(platformOpts);
      perPlatform.push({
        ideId,
        agentsDir: profile.agentsDir,
        installed: result.installed,
        skipped: result.skipped,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `peaks install-agents: ${ideId} platform failed (continuing): ${message}\n`
      );
      perPlatform.push({
        ideId,
        agentsDir: profile.agentsDir,
        installed: [],
        skipped: [],
        error: message,
      });
    }
  }
  return perPlatform;
}

/**
 * Per-platform fan-out — iterate ALL 8 IdeIds and call
 * `installBundledSkills` for each. Per peaks-loop tenet
 * "minimal-user-operation" (2026-06-11): the user should
 * never have to run a per-platform install command. The
 * 1.x postinstall only handled the auto-detected single
 * IDE; 2.0 fixes this so the peaks-* skill family is
 * symlinked to every platform the user might be on.
 *
 * Returns an array of { ideId, skillsDir, installed, skipped }
 * per platform. Symlink failures are soft (logged to stderr,
 * never throw) so one platform's failure doesn't block the
 * other 7.
 */
export function installBundledSkillsForAllPlatforms(options = {}) {
  const platforms = Object.keys(IDE_SKILL_INSTALL_PROFILES);
  const perPlatform = [];
  // Back-compat precedence (regression fix 2026-06-12,
  // slice 2026-06-12-postinstall-1x-detector-tdd):
  // when iterating the 8 platforms, the claude-code install
  // must still honor the PEAKS_CLAUDE_SKILLS_DIR env var
  // (the legacy back-compat surface from 1.x). The other 7
  // platforms use their per-IDE profile paths unconditionally.
  // Without this fix the 8-IDE fan-out regresses the
  // `peaks install-skills` env-var override contract that
  // user CI / 1.x → 2.0 migration scripts depend on.
  const claudeEnv = process.env.PEAKS_CLAUDE_SKILLS_DIR;
  for (const ideId of platforms) {
    try {
      const platformOpts =
        ideId === 'claude-code' && claudeEnv !== undefined && claudeEnv.length > 0
          ? { ...options, ideId, targetRoot: claudeEnv }
          : { ...options, ideId };
      const result = installBundledSkills(platformOpts);
      perPlatform.push({
        ideId,
        skillsDir: IDE_SKILL_INSTALL_PROFILES[ideId]?.skillsDir ?? '(unknown)',
        installed: result.installed,
        skipped: result.skipped,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `peaks install-skills: ${ideId} platform failed (continuing): ${message}\n`
      );
      perPlatform.push({
        ideId,
        skillsDir: IDE_SKILL_INSTALL_PROFILES[ideId]?.skillsDir ?? '(unknown)',
        installed: [],
        skipped: [],
        error: message,
      });
    }
  }
  return perPlatform;
}

/**
 * 1.x → 2.0 detection — sniff for legacy 1.x project state
 * in `cwd`. Returns a 1.x detection envelope with the
 * detected signals (so the postinstall can decide whether
 * to auto-upgrade).
 *
 * 1.x signals (any one fires the detection):
 *   - `~/.peaks/config.json` exists with `version: '1.4.2'` (or
 *     any '1.x' version that predates the 2.0 schema)
 *   - `.claude/rules/common/dev-preference.md` exists and
 *     references "peaks progress" (the 1.x CLI surface
 *     removed in slice #014)
 *   - `<cwd>/.peaks/preferences.json` missing OR has no
 *     `schema_version: '2.0.0'` field
 *
 * Returns:
 *   { isOneX: boolean, signals: string[], projectRoot: string|null,
 *     configPath: string|null }
 */
export function detect1xProjectState(cwd = process.cwd()) {
  const home = homedir();
  const signals = [];
  let projectRoot = null;
  let configPath = null;

  // Walk up from cwd looking for .peaks/_runtime (signals
  // we're inside a peaks project).
  let dir = cwd;
  for (let i = 0; i < 8; i += 1) {
    const peaksRuntime = join(dir, '.peaks', '_runtime');
    if (existsSync(peaksRuntime)) {
      projectRoot = dir;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Signal 1: ~/.peaks/config.json with 1.x version
  const globalConfig = join(home, '.peaks', 'config.json');
  if (existsSync(globalConfig)) {
    try {
      const raw = JSON.parse(readFileSync(globalConfig, 'utf8'));
      if (typeof raw.version === 'string' && /^1\./.test(raw.version)) {
        signals.push(`global config at ${globalConfig} is 1.x (${raw.version})`);
        if (configPath === null) configPath = globalConfig;
      }
    } catch {
      // ignore parse error — the 1.x detection is best-effort
    }
  }

  // Signal 2: .claude/rules/common/dev-preference.md with peaks progress
  if (projectRoot !== null) {
    const devPref = join(projectRoot, '.claude', 'rules', 'common', 'dev-preference.md');
    if (existsSync(devPref)) {
      try {
        const body = readFileSync(devPref, 'utf8');
        if (/peaks progress/i.test(body)) {
          signals.push(`${devPref} references "peaks progress" (1.x CLI surface, removed in slice #014)`);
        }
      } catch {
        // ignore
      }
    }
    // Signal 3: project preferences.json missing or 1.x
    const prefs = join(projectRoot, '.peaks', 'preferences.json');
    if (!existsSync(prefs)) {
      signals.push(`${prefs} does not exist (1.x project never migrated)`);
    } else {
      try {
        const raw = JSON.parse(readFileSync(prefs, 'utf8'));
        if (raw.schema_version !== '2.0.0') {
          signals.push(`${prefs} has schema_version ${JSON.stringify(raw.schema_version)}, expected '2.0.0'`);
        }
      } catch {
        signals.push(`${prefs} exists but is not valid JSON`);
      }
    }
  }

  return {
    isOneX: signals.length > 0,
    signals,
    projectRoot,
    configPath,
  };
}

/**
 * Postinstall auto-upgrade — when the user just ran
 * `npm i -g peaks-loop@2.0` and `cwd` is a 1.x peaks-loop
 * project, this shells out to the installed `peaks`
 * binary to run the umbrella `peaks upgrade --to 2.0 --auto`.
 *
 * Per the "minimal-user-operation" tenet, the user should
 * never have to run a second command after `npm i -g`. The
 * upgrade CLI (if installed) is at the resolved `peaks`
 * binary path; if not, the user gets a hint to run it
 * manually.
 *
 * The auto-upgrade is opt-out via:
 *   PEAKS_SKIP_AUTO_UPGRADE=1
 * (so a CI box that installs 2.0 but never wants the
 * project-level migration can suppress the auto-step).
 */
export async function autoUpgrade1xProjectIfPresent(options = {}) {
  if (process.env.PEAKS_SKIP_AUTO_UPGRADE === '1') {
    return { ran: false, reason: 'PEAKS_SKIP_AUTO_UPGRADE=1' };
  }
  const state = detect1xProjectState(options.cwd ?? process.cwd());
  if (!state.isOneX) {
    return { ran: false, reason: 'no 1.x project state detected' };
  }
  if (state.projectRoot === null) {
    return { ran: false, reason: 'cwd is not a peaks project (no .peaks/_runtime/)' };
  }
  // The peaks binary should be on PATH after `npm i -g`.
  // We shell out via spawnSync (synchronous; the postinstall
  // is already synchronous and the umbrella is fast).
  try {
    const result = spawnSync('peaks', ['upgrade', '--to', '2.0', '--auto', '--project', state.projectRoot], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    return {
      ran: true,
      reason: 'auto-upgrade dispatched',
      signals: state.signals,
      projectRoot: state.projectRoot,
      exitCode: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  } catch (err) {
    return {
      ran: true,
      reason: 'auto-upgrade dispatched but failed',
      signals: state.signals,
      projectRoot: state.projectRoot,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    // 2.0 fix for the 1.x Trae bug (per real user feedback
    // 2026-06-11): iterate ALL 8 platforms, not just the
    // auto-detected one. Per the "minimal-user-operation"
    // tenet, the user should never have to run a
    // per-platform install command.
    const perPlatform = installBundledSkillsForAllPlatforms();
    let totalInstalled = 0;
    for (const p of perPlatform) {
      totalInstalled += p.installed.length;
    }
    if (totalInstalled > 0) {
      process.stdout.write(
        `Peaks skills linked across ${perPlatform.length} platforms ` +
          `(${totalInstalled} total symlinks)\n`
      );
    }
    const outputStylesResult = installBundledOutputStyles();
    // Slice 7/7 — bundled agents (Claude Code sub-agent prompts) ship
    // under `agents/*.md` in the peaks-loop tarball and are auto-installed
    // to `~/.claude/agents/` on `npm i -g peaks-loop@latest`. Drift
    // detection is content-hash + `.peaks-managed` marker (mirrors the
    // output-styles contract).
    const agentsPerPlatform = installBundledAgentsForAllPlatforms();
    let totalAgentsInstalled = 0;
    for (const p of agentsPerPlatform) {
      totalAgentsInstalled += p.installed.length;
    }
    if (totalAgentsInstalled > 0) {
      process.stdout.write(
        `Peaks agents installed across ${agentsPerPlatform.length} platforms ` +
          `(${totalAgentsInstalled} total files)\n`
      );
    }
    let userConfigResult = createConfigResult({ skipped: true });
    try {
      userConfigResult = installUserConfig();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Peaks user config was not installed: ${message}\n`);
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

    // 2.0 postinstall: auto-detect 1.x project state in cwd
    // and dispatch the upgrade umbrella. This makes the
    // user's `npm i -g peaks-loop@2.0` truly one-key.
    if (process.env.PEAKS_SKIP_AUTO_UPGRADE !== '1') {
      // Fire-and-forget; the upgrade is async by design so
      // the npm install output isn't blocked. We print a
      // one-line hint so the user knows the auto-step
      // happened.
      autoUpgrade1xProjectIfPresent().then((result) => {
        if (result.ran) {
          process.stdout.write(
            `\n✓ Detected 1.x peaks-loop project at ${result.projectRoot}\n` +
              `  → auto-upgraded to 2.0 (${result.signals?.length ?? 0} signals resolved)\n` +
              `  Run \`peaks audit red-lines --project .\` to verify.\n`
          );
        }
        // When !result.ran we say nothing — silent on success.
      });
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
