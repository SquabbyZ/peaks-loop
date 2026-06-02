import { closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

export function getUserConfigPath(): string {
  return resolve(homedir(), '.peaks', 'config.json');
}

export function isInsidePath(childPath: string, parentPath: string): boolean {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function isSafeProjectConfigMarker(projectRoot: string): boolean {
  const peaksPath = resolve(projectRoot, '.peaks');
  const markerPath = resolve(peaksPath, 'config.json');
  try {
    const projectRootReal = realpathSync(projectRoot);
    const peaksStats = lstatSync(peaksPath);
    const peaksReal = realpathSync(peaksPath);
    const markerStats = lstatSync(markerPath);
    if (!peaksStats.isDirectory() || peaksStats.isSymbolicLink()) return false;
    if (!markerStats.isFile() || markerStats.isSymbolicLink() || markerStats.nlink !== 1) return false;
    const markerReal = realpathSync(markerPath);
    if (!isInsidePath(peaksReal, projectRootReal)) return false;
    if (!isInsidePath(markerReal, projectRootReal)) return false;
    return isInsidePath(markerReal, peaksReal);
  } catch {
    return false;
  }
}

function normalizeBoundaryPath(path: string): string {
  const resolved = resolve(path);
  let realPath = resolved;
  try {
    realPath = existsSync(resolved) ? realpathSync.native(resolved) : resolved;
  } catch {
    realPath = resolved;
  }
  return process.platform === 'win32' || process.platform === 'darwin' ? realPath.toLowerCase() : realPath;
}

function getHomeBoundaryPaths(): Set<string> {
  return new Set([homedir(), process.env.HOME, process.env.USERPROFILE].filter((path): path is string => typeof path === 'string' && path.length > 0).map(normalizeBoundaryPath));
}

export function findProjectRoot(startPath: string): string | null {
  const homeBoundaryPaths = getHomeBoundaryPaths();
  let current = resolve(startPath);
  let parent = dirname(current);
  let pkgRoot: string | null = null;

  while (current !== parent && !homeBoundaryPaths.has(normalizeBoundaryPath(current))) {
    if (existsSync(resolve(current, '.peaks', 'config.json')) && isSafeProjectConfigMarker(current)) {
      return current;
    }
    // .git is the definitive project root — return immediately
    if (existsSync(resolve(current, '.git'))) {
      return current;
    }
    // package.json alone is ambiguous in monorepos — keep walking up for .git
    if (pkgRoot === null && existsSync(resolve(current, 'package.json'))) {
      pkgRoot = current;
    }
    parent = current;
    current = dirname(parent);
  }

  return pkgRoot;
}

export function resolveProjectRootForConfig(startPath: string): string {
  const start = resolve(startPath);
  const homeBoundaryPaths = getHomeBoundaryPaths();
  let current = start;
  let parent = dirname(current);
  let pkgRoot: string | null = null;

  while (current !== parent && !homeBoundaryPaths.has(normalizeBoundaryPath(current))) {
    if (existsSync(resolve(current, '.peaks', 'config.json')) && isSafeProjectConfigMarker(current)) {
      return current;
    }
    if (existsSync(resolve(current, '.git'))) {
      return current;
    }
    if (pkgRoot === null && existsSync(resolve(current, 'package.json'))) {
      pkgRoot = current;
    }
    parent = current;
    current = dirname(parent);
  }

  return pkgRoot ?? start;
}

/**
 * Canonicalise a user-supplied project root path against git's view of the
 * repository root. This is the fix for the nested-directory regression
 * where peaks-cli would write `.peaks/` under a nested sub-folder
 * (e.g. `prompt-project/prompt-project/.peaks/`) because the LLM passed
 * `$(pwd)` from inside a sub-directory of a real git repo. Without
 * canonicalisation, peaks accepted the cwd as-is, built the .peaks/
 * tree there, and left the team with two parallel state stores.
 *
 * Strategy:
 *   1. If `startPath` (or any ancestor) is inside a git repo, return
 *      `git rev-parse --show-toplevel` from `startPath`. The git root
 *      is the *only* correct answer for "where does the .peaks/ tree
 *      belong?" — sub-folders of a git repo are not their own projects.
 *   2. If `startPath` is not inside a git repo, fall back to
 *      `findProjectRoot` (the existing heuristic) so the CLI still
 *      works for non-git projects.
 *   3. If both fail, return `startPath` unchanged — better to write
 *      to the cwd than to refuse the command.
 *
 * This is intentionally fail-open: it only *promotes* a path towards
 * the git root, it never demotes one. A non-git user is unaffected.
 * The function does NOT throw on a missing git binary or a non-zero
 * `git rev-parse` exit; both fall through to the heuristic.
 */
export function resolveCanonicalProjectRoot(startPath: string): string {
  const start = resolve(startPath);
  const gitRoot = resolveProjectRootFromGit(start);
  if (gitRoot !== null) {
    return gitRoot;
  }
  // Non-git fallback: walk the heuristic up to the home boundary.
  // We do NOT call realpathSync on the heuristic result because the
  // heuristic may legitimately return a path through a symlink that
  // the caller passed in (no canonicalisation needed in that case).
  const heuristicRoot = findProjectRoot(start);
  if (heuristicRoot !== null) {
    return heuristicRoot;
  }
  return start;
}

function resolveProjectRootFromGit(startPath: string): string | null {
  // execFileSync (not execSync) so a malicious `startPath` cannot
  // inject argv into the spawned git invocation. The child only
  // receives `startPath` as the cwd, never as a flag.
  let rawRoot: string;
  try {
    const stdout = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const trimmed = stdout.trim();
    if (trimmed.length === 0) return null;
    rawRoot = resolve(trimmed);
  } catch {
    // git not on PATH, startPath is not in a repo, or some other
    // benign failure — fall through to the heuristic.
    return null;
  }
  // On macOS, /tmp is a symlink to /private/tmp; git returns the
  // realpath. If the caller passed a path through the symlink, the
  // two strings won't match byte-for-byte even though they refer
  // to the same directory. realpathSync the git root and the
  // startPath through the same lens so callers get a canonical
  // answer that compares equal to the path they passed in.
  try {
    return realpathSync(rawRoot);
  } catch {
    return rawRoot;
  }
}

export function getProjectConfigPath(projectRoot: string | null): string | null {
  if (!projectRoot) return null;
  if (!isSafeProjectConfigMarker(projectRoot)) return null;
  return resolve(projectRoot, '.peaks', 'config.json');
}

export function getProjectBootstrapConfigPath(projectRoot: string): string {
  const projectRootPath = resolve(projectRoot);
  const peaksPath = resolve(projectRootPath, '.peaks');
  const configPath = resolve(peaksPath, 'config.json');
  if (!isInsidePath(configPath, projectRootPath)) {
    throw new Error('Project config path must stay inside the project root');
  }

  if (!existsSync(peaksPath)) {
    mkdirSync(peaksPath, { recursive: true });
  }

  validateProjectBootstrapConfigPath(projectRootPath, peaksPath, configPath);
  return configPath;
}

function validateProjectBootstrapConfigPath(projectRootPath: string, peaksPath: string, configPath: string): void {
  const projectRootReal = realpathSync(projectRootPath);
  const peaksStats = lstatSync(peaksPath);
  const peaksReal = realpathSync(peaksPath);
  if (!peaksStats.isDirectory() || peaksStats.isSymbolicLink() || peaksReal !== resolve(projectRootReal, '.peaks')) {
    throw new Error('Project config path must stay inside the project root');
  }

  try {
    const markerStats = lstatSync(configPath);
    if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
      throw new Error('Project config path must stay inside the project root');
    }
    if (markerStats.nlink !== 1) {
      throw new Error('Config path must not be hardlinked');
    }
    const markerReal = realpathSync(configPath);
    if (!isInsidePath(markerReal, projectRootReal) || !isInsidePath(markerReal, peaksReal)) {
      throw new Error('Project config path must stay inside the project root');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export function validateProjectBootstrapConfigPathForWrite(projectRoot: string, configPath: string): void {
  const projectRootPath = resolve(projectRoot);
  validateProjectBootstrapConfigPath(projectRootPath, resolve(projectRootPath, '.peaks'), configPath);
}

export function validateUserConfigPathForWrite(configPath: string): void {
  const userRoot = resolve(homedir());
  const peaksPath = resolve(userRoot, '.peaks');
  const userRootReal = realpathSync(userRoot);
  const peaksStats = lstatSync(peaksPath);
  const peaksReal = realpathSync(peaksPath);
  if (!peaksStats.isDirectory() || peaksStats.isSymbolicLink() || peaksReal !== resolve(userRootReal, '.peaks')) {
    throw new Error('User config path must stay inside the user root');
  }

  try {
    const markerStats = lstatSync(configPath);
    if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
      throw new Error('User config path must stay inside the user root');
    }
    if (markerStats.nlink !== 1) {
      throw new Error('Config path must not be hardlinked');
    }
    const markerReal = realpathSync(configPath);
    if (!isInsidePath(markerReal, userRootReal) || !isInsidePath(markerReal, peaksReal)) {
      throw new Error('User config path must stay inside the user root');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

export function validateArtifactWorkspaceRoot(artifactRoot: string, _workspaceRoot: string): void {
  const artifactStats = lstatSync(artifactRoot);
  if (!artifactStats.isDirectory() || artifactStats.isSymbolicLink()) {
    throw new Error('Artifact workspace marker must stay inside the artifact workspace');
  }
}

export function validateArtifactWorkspaceMarkerPath(artifactRoot: string, peaksPath: string, markerPath: string): void {
  const artifactStats = lstatSync(artifactRoot);
  if (!artifactStats.isDirectory() || artifactStats.isSymbolicLink()) {
    throw new Error('Artifact workspace marker must stay inside the artifact workspace');
  }
  const artifactRootReal = realpathSync(artifactRoot);
  const peaksStats = lstatSync(peaksPath);
  const peaksReal = realpathSync(peaksPath);
  if (!peaksStats.isDirectory() || peaksStats.isSymbolicLink() || peaksReal !== resolve(artifactRootReal, '.peaks')) {
    throw new Error('Artifact workspace marker must stay inside the artifact workspace');
  }

  try {
    const markerStats = lstatSync(markerPath);
    if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
      throw new Error('Artifact workspace marker must stay inside the artifact workspace');
    }
    if (markerStats.nlink !== 1) {
      throw new Error('Config path must not be hardlinked');
    }
    const markerReal = realpathSync(markerPath);
    if (!isInsidePath(markerReal, artifactRootReal) || !isInsidePath(markerReal, peaksReal)) {
      throw new Error('Artifact workspace marker must stay inside the artifact workspace');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function validateOpenConfigFile(fd: number, tempPath: string, errorMessage: string): void {
  const fdStats = fstatSync(fd);
  const pathStats = lstatSync(tempPath);
  if (!fdStats.isFile() || !pathStats.isFile() || fdStats.dev !== pathStats.dev || fdStats.ino !== pathStats.ino) {
    throw new Error(errorMessage);
  }
  if (fdStats.nlink !== 1 || pathStats.nlink !== 1) {
    throw new Error('Config path must not be hardlinked');
  }
}

function getSafeTempOpenFlags(): number {
  const baseFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
  return typeof constants.O_NOFOLLOW === 'number' ? baseFlags | constants.O_NOFOLLOW : baseFlags;
}

function getSafeReadOpenFlags(): number {
  return typeof constants.O_NOFOLLOW === 'number' ? constants.O_RDONLY | constants.O_NOFOLLOW : constants.O_RDONLY;
}

export function readConfigFileSafely(configPath: string, errorMessage: string): string {
  const fd = openSync(configPath, getSafeReadOpenFlags());
  try {
    validateOpenConfigFile(fd, configPath, errorMessage);
    return readFileSync(fd, 'utf-8');
  } finally {
    closeSync(fd);
  }
}

export function writeConfigFileSafely(configPath: string, content: string, validateBeforeWrite: () => void, errorMessage: string): void {
  validateBeforeWrite();

  const tempPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  let fd: number | null = openSync(tempPath, getSafeTempOpenFlags(), 0o600);
  let renamed = false;
  let closeError: unknown;
  try {
    validateOpenConfigFile(fd, tempPath, errorMessage);
    fchmodSync(fd, 0o600);
    writeFileSync(fd, content, 'utf-8');
    const writeFd = fd;
    fd = null;
    closeSync(writeFd);
    validateBeforeWrite();
    const readFd = openSync(tempPath, getSafeReadOpenFlags());
    try {
      validateOpenConfigFile(readFd, tempPath, errorMessage);
    } finally {
      closeSync(readFd);
    }
    renameSync(tempPath, configPath);
    renamed = true;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch (error: unknown) {
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

export function writeProjectConfigFile(projectRoot: string, configPath: string, content: string): void {
  writeConfigFileSafely(configPath, content, () => validateProjectBootstrapConfigPathForWrite(projectRoot, configPath), 'Project config path must stay inside the project root');
}

export function writeUserConfigFile(configPath: string, content: string): void {
  writeConfigFileSafely(configPath, content, () => validateUserConfigPathForWrite(configPath), 'User config path must stay inside the user root');
}
