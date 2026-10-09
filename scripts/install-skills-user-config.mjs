// scripts/install-skills-user-config.mjs
//
// The `~/.peaks/config.json` install: the defaults, the merge that never overwrites a
// key the user wrote, the path validation that keeps the write inside the user root,
// and the atomic write. Includes the record of the DELETED project-config sibling, so
// the next reader does not re-add it.
//
// Split out of `scripts/install-skills.mjs` (rid-043). Every line below was moved
// VERBATIM from that file; only this header, the import block, and the `export`
// keyword on names a sibling imports are new.

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  getPathStats,
  isInsidePath,
  isPlainObject,
  readFileSafely,
  resolvePackageRoot,
  writeFileAtomically
} from './install-skills-fs.mjs';

export function readPackageVersion(packageRoot = resolvePackageRoot()) {
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('package.json version must be a non-empty string');
  }

  return packageJson.version;
}

export function createConfigDefaults(packageRoot) {
  return {
    version: readPackageVersion(packageRoot),
    currentWorkspace: null,
    workspaces: [],
    language: 'en',
    economyMode: true,
    swarmMode: true,
    tokens: {},
    proxy: {}
  };
}

export function createConfigResult(overrides = {}) {
  return { created: false, updated: false, skipped: false, ...overrides };
}

export function mergeMissingConfigValues(existing, defaults) {
  return Object.entries(defaults).reduce(
    (next, [key, defaultValue]) => {
      if (!(key in next)) {
        return { ...next, [key]: defaultValue };
      }

      const existingValue = next[key];
      if (isPlainObject(existingValue) && isPlainObject(defaultValue)) {
        return { ...next, [key]: mergeMissingConfigValues(existingValue, defaultValue) };
      }

      return next;
    },
    { ...existing }
  );
}

export function readConfigFile(configPath, label) {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      readFileSafely(configPath, `${label} config path changed during read`)
    );
    if (!isPlainObject(parsed)) {
      throw new Error(`${label} config must contain a JSON object`);
    }

    return parsed;
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? `${label} config must contain valid JSON`
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(message);
  }
}

export function validateConfigPath(root, peaksRoot, configPath, label) {
  const rootReal = realpathSync(root);
  const peaksStats = lstatSync(peaksRoot);
  const peaksReal = realpathSync(peaksRoot);
  if (
    !peaksStats.isDirectory() ||
    peaksStats.isSymbolicLink() ||
    peaksReal !== resolve(rootReal, '.peaks')
  ) {
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

export function validateUserConfigPaths(userRoot, peaksRoot, configPath) {
  validateConfigPath(userRoot, peaksRoot, configPath, 'User');
}

export function writeUserConfig(userRoot, peaksRoot, configPath, content) {
  writeFileAtomically(configPath, content, 'User config path changed during write', () =>
    validateUserConfigPaths(userRoot, peaksRoot, configPath)
  );
}

export function writeMergedConfig(configPath, label, defaults, writeConfig) {
  const existing = readConfigFile(configPath, label);
  const next = {
    ...(existing === null ? defaults : mergeMissingConfigValues(existing, defaults)),
    version: defaults.version
  };
  const currentJson = existing === null ? null : `${JSON.stringify(existing, null, 2)}\n`;
  const nextJson = `${JSON.stringify(next, null, 2)}\n`;

  if (currentJson === nextJson) {
    return createConfigResult();
  }

  writeConfig(nextJson);
  return createConfigResult(existing === null ? { created: true } : { updated: true });
}

export function installUserConfig(options = {}) {
  if (
    process.env.PEAKS_SKIP_SKILL_INSTALL === '1' ||
    process.env.PEAKS_SKIP_USER_CONFIG_INSTALL === '1'
  ) {
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

  return writeMergedConfig(
    configPath,
    'User',
    createConfigDefaults(options.packageRoot),
    (content) => writeUserConfig(userRoot, peaksRoot, configPath, content)
  );
}

/*
 * D11 (2026-09-15): `installProjectConfig` — plus its two private helpers
 * `writeProjectConfig` and `validateProjectConfigPaths` — was DELETED here.
 *
 * It was dead: definition + `export`, and zero call sites in the whole repo
 * (verified by a repo-wide grep for the identifier, excluding node_modules
 * and dist). The `PEAKS_SKIP_PROJECT_CONFIG_INSTALL` env var existed only to
 * disable it.
 *
 * Deleted rather than wired, because wiring it would be the bigger defect:
 * `npm i -g peaks-loop` executed from inside a user's repo would write
 * `<project>/.peaks/config.json` as a side effect of a GLOBAL install. The
 * project-level config is owned by `peaks workspace init` and the config
 * service at runtime; a postinstall reaching into the current working
 * directory to create project state is the opposite of the "minimal user
 * operation" tenet — an operation the user never asked for.
 *
 * The user-config sibling (`installUserConfig`, below) is live and is what
 * the postinstall actually calls.
 */
