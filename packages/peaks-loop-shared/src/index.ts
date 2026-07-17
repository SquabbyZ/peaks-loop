/**
 * peaks-loop-shared public surface.
 *
 * Re-exports the four pure-function utils this package owns:
 *  1. fs         — file system primitives (pathExists, isDirectory, ...)
 *  2. paths      — repo-root + skills/schemas/templates dirs + required
 *                  skill + schema name lists
 *  3. result     — ResultEnvelope / ok() / fail() + sensitive-error redaction
 *  4. version    — CLI_VERSION (synced from main package.json by
 *                  scripts/sync-version.mjs)
 *
 * Main peaks-loop package consumes these via `workspace:*` deps:
 *
 *   import { ok, fail } from 'peaks-loop-shared';
 *   import { pathExists } from 'peaks-loop-shared/fs';
 */

export * from './fs.js';
export * from './paths.js';
export * from './result.js';
export * from './version.js';