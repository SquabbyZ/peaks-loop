import { closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
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
