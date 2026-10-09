// scripts/install-skills-fs.mjs
//
// The guarded filesystem and path vocabulary the installers share: every read that must
// not follow a symlink, every write that must be atomic, and the two containments
// (a path stays inside a root; a lock root does not move under a write).
//
// Split out of `scripts/install-skills.mjs` (rid-043). Every line below was moved
// VERBATIM from that file; only this header, the import block, and the `export`
// keyword on names a sibling imports are new.

import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function getPathStats(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

export function validateOpenFile(fd, path, errorMessage) {
  const fdStats = fstatSync(fd);
  const pathStats = lstatSync(path);
  if (
    !fdStats.isFile() ||
    !pathStats.isFile() ||
    fdStats.dev !== pathStats.dev ||
    fdStats.ino !== pathStats.ino
  ) {
    throw new Error(errorMessage);
  }
  if (fdStats.nlink !== 1 || pathStats.nlink !== 1) {
    throw new Error(`${errorMessage}: hardlinked file`);
  }
}

export function getSafeReadOpenFlags() {
  return typeof constants.O_NOFOLLOW === 'number'
    ? constants.O_RDONLY | constants.O_NOFOLLOW
    : constants.O_RDONLY;
}

export function readFileSafely(path, errorMessage) {
  const fd = openSync(path, getSafeReadOpenFlags());
  try {
    validateOpenFile(fd, path, errorMessage);
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

export function validateInstallRoot(targetRoot, label) {
  const rootStats = lstatSync(targetRoot);
  if (rootStats.isSymbolicLink()) {
    throw new Error(`${label} install root must not be a symlink`);
  }
  if (!rootStats.isDirectory()) {
    throw new Error(`${label} install root must be a directory`);
  }
  return rootStats;
}

export function createInstallRootValidator(targetRoot, label) {
  const expectedStats = validateInstallRoot(targetRoot, label);
  return () => {
    const rootStats = validateInstallRoot(targetRoot, label);
    if (rootStats.dev !== expectedStats.dev || rootStats.ino !== expectedStats.ino) {
      throw new Error(`${label} install root changed during write`);
    }
  };
}

export function resolvePackageRoot(options = {}) {
  return resolve(options.packageRoot ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
}

export function isInsidePath(childPath, parentPath) {
  const relativePath = relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getSafeTempOpenFlags() {
  const baseFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL;
  return typeof constants.O_NOFOLLOW === 'number' ? baseFlags | constants.O_NOFOLLOW : baseFlags;
}

export function writeFileAtomically(configPath, content, errorMessage, validateBeforeWrite) {
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
