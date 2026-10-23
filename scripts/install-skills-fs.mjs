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
  mkdirSync,
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

/**
 * The validator a DRY RUN uses.
 *
 * WHY IT IS NOT THE OTHER ONE. `createInstallRootValidator` exists to catch the
 * install root being swapped under a write — it stats the root before the write
 * and compares after. A dry run writes nothing, so there is no write to catch, and
 * the root may not even EXIST: a dry run must not create it either, because a
 * dry run that leaves a directory behind is not a dry run.
 */
export function createDryRunRootValidator() {
  return () => undefined;
}

/**
 * Prepare the install root for a run, and hand back the validator that guards it.
 *
 * A real run creates the directory and then guards it. A dry run does neither: it
 * creates no directory and guards nothing, because there is no write to guard.
 *
 * WHY IT IS ONE FUNCTION. The choice belongs to the CALLER'S ONE CALL SITE: the
 * install loop is already at the complexity the lint allows, and a second
 * decision here would push it over for a difference that is exactly one branch
 * wide.
 *
 * @param {string} targetRoot
 * @param {string} label
 * @param {boolean} dryRun
 */
export function prepareInstallRoot(targetRoot, label, dryRun) {
  if (dryRun === true) {
    return createDryRunRootValidator();
  }
  mkdirSync(targetRoot, { recursive: true });
  return createInstallRootValidator(targetRoot, label);
}

export function resolvePackageRoot(options = {}) {
  return resolve(options.packageRoot ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
}

/**
 * The version of the package that owns the bundled assets — the one number the
 * canonical store's staleness decision compares against.
 *
 * WHERE IT IS READ. `package.json#version` of the package root, and the package
 * root is wherever THIS script lives: `<install>/scripts/install-skills.mjs`
 * gives `<install>`, which is the globally installed `peaks-loop` package on a
 * user's machine and the repository checkout in a development tree. Both are
 * the package that owns `skills/<name>`, so the same comparison is meaningful
 * in both cases — the difference is only who moves the version.
 *
 * A package.json that is missing, unreadable or versionless answers null, and
 * null means "no version to compare against" — the caller then decides by the
 * bytes alone, which is the behaviour that predates the version stamp.
 *
 * @param {string} packageRoot
 * @returns {string | null}
 */
export function readPackageVersion(packageRoot) {
  const packageJsonPath = join(packageRoot, 'package.json');
  if (!existsSync(packageJsonPath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Peaks install: ${packageJsonPath} could not be read as JSON (${message}); ` +
        'the canonical store cannot compare versions and will decide by content alone.\n'
    );
    return null;
  }
  const version = parsed?.version;
  return typeof version === 'string' && version.length > 0 ? version : null;
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
