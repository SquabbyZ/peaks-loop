// scripts/install-skills-output-style-default.mjs
//
// `settings.json` registration: after the style file lands, Claude Code still loads no
// Peaks style until `outputStyle` names it. Soft-fails on every error path, because the
// bundled file is already on disk by the time this runs.
//
// Split out of `scripts/install-skills.mjs` (rid-043). Every line below was moved
// VERBATIM from that file; only this header, the import block, and the `export`
// keyword on names a sibling imports are new.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  getPathStats,
  isPlainObject,
  readFileSafely,
  writeFileAtomically
} from './install-skills-fs.mjs';

/**
 * Slice 2026-08-02 — auto-register bundled output style.
 *
 * Real user feedback (2026-08-02): `npm i -g peaks-loop@latest` on a
 * fresh 0-1 project copied `peaks-skill-swarm.md` into
 * `~/.claude/output-styles/` but never wrote
 * `outputStyle: 'peaks-skill-swarm'` into `~/.claude/settings.json`.
 * Result: Claude Code loaded no Peaks output style in new sessions.
 *
 * The fix: when `peaks-skill-swarm.md` is present in the bundled output
 * styles directory AND `~/.claude/settings.json` does NOT yet declare
 * `outputStyle`, merge in `outputStyle: 'peaks-skill-swarm'` while
 * preserving every other key. If the user already set `outputStyle`,
 * leave it alone — the user is the source of truth.
 *
 * Resolution precedence:
 *   1. options.settingsFile  (explicit override / test hook)
 *   2. PEAKS_CLAUDE_SETTINGS_FILE env var  (CI override)
 *   3. homedir-relative `<homedir>/.claude/settings.json`  (default)
 *
 * Soft-fail contract: every error path (missing file, malformed JSON,
 * missing bundled style file, permission denied) is logged to stderr
 * and returns `{ skipped: true, ... }` instead of throwing. The
 * postinstall must never fail on this step because the bundled file
 * itself was already written successfully.
 */
export function resolveSettingsFilePath(options = {}) {
  if (typeof options.settingsFile === 'string' && options.settingsFile.length > 0) {
    return resolve(options.settingsFile);
  }
  const envOverride = process.env.PEAKS_CLAUDE_SETTINGS_FILE;
  if (typeof envOverride === 'string' && envOverride.length > 0) {
    return resolve(envOverride);
  }
  return resolve(homedir(), '.claude', 'settings.json');
}

/** Is `targetPath` a plain single-linked regular file — not a link, not a directory? */
function isRegularFile(targetPath) {
  const stats = getPathStats(targetPath);
  return stats !== null && stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1;
}

/**
 * The existing `settings.json` as an object, or the refusal that stops the write.
 *
 * Read FIRST so a malformed file surfaces as a parse error — more actionable to the
 * user than the generic "bundled style not present" message — and because malformed
 * JSON is a user-authored file this must never clobber.
 *
 * @param {string} settingsPath
 * @returns {{ existing: Record<string, unknown> | null } | { refusal: { skipped: true, reason: string } }}
 */
function readExistingSettings(settingsPath) {
  if (!existsSync(settingsPath)) return { existing: null };
  if (!isRegularFile(settingsPath)) {
    process.stderr.write(
      `peaks install-skills: refusing to overwrite non-regular settings.json at ${settingsPath}\n`
    );
    return { refusal: { skipped: true, reason: 'settings.json is not a regular file' } };
  }
  try {
    const parsed = JSON.parse(
      readFileSafely(settingsPath, 'Claude settings.json path changed during read')
    );
    if (!isPlainObject(parsed)) {
      process.stderr.write(
        `peaks install-skills: refusing to overwrite settings.json that is not a JSON object at ${settingsPath}\n`
      );
      return { refusal: { skipped: true, reason: 'settings.json is not a JSON object' } };
    }
    return { existing: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `peaks install-skills: failed to parse settings.json at ${settingsPath}: ${message}; leaving untouched\n`
    );
    return { refusal: { skipped: true, reason: 'settings.json parse error' } };
  }
}

/**
 * The atomic write, with the same soft-fail shape as the read: the refusal is RETURNED
 * rather than thrown, and the message is written here so both callers cannot drift.
 *
 * @param {string} settingsPath
 * @param {string} nextJson
 * @returns {string | null} the error message on failure, `null` on success
 */
function writeSettingsAtomically(settingsPath, nextJson) {
  try {
    writeFileAtomically(
      settingsPath,
      nextJson,
      'Claude settings.json path changed during write',
      () => {
        if (existsSync(settingsPath) && !isRegularFile(settingsPath)) {
          throw new Error('Claude settings.json path is not a regular file');
        }
      }
    );
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `peaks install-skills: failed to write settings.json at ${settingsPath}: ${message}\n`
    );
    return message;
  }
}

export function installBundledOutputStyleDefault(options = {}) {
  if (
    process.env.PEAKS_SKIP_SKILL_INSTALL === '1' ||
    process.env.PEAKS_SKIP_OUTPUT_STYLE_DEFAULT === '1'
  ) {
    return { skipped: true, reason: 'PEAKS_SKIP_OUTPUT_STYLE_DEFAULT=1' };
  }

  const bundledStylesDir = resolve(
    options.targetRoot ??
      process.env.PEAKS_CLAUDE_OUTPUT_STYLES_DIR ??
      join(homedir(), '.claude', 'output-styles')
  );
  const settingsPath = resolveSettingsFilePath(options);
  const bundledStyleName = 'peaks-skill-swarm.md';
  const bundledStylePath = join(bundledStylesDir, bundledStyleName);

  const read = readExistingSettings(settingsPath);
  if (read.refusal !== undefined) return read.refusal;
  const existing = read.existing;

  // Pre-condition: the bundled style file must be present in the
  // dispatched target. If it's not, we MUST NOT inject
  // `outputStyle: 'peaks-skill-swarm'` — Claude Code would then fail
  // to load the style and fall back to default anyway, leaving the
  // user with broken state. Skipping is the safe default.
  if (!existsSync(bundledStylePath)) {
    return { skipped: true, reason: `bundled output style not present at ${bundledStylePath}` };
  }

  // User-authored outputStyle wins — never overwrite.
  if (
    existing !== null &&
    typeof existing.outputStyle === 'string' &&
    existing.outputStyle.length > 0
  ) {
    return {
      skipped: true,
      reason: `user-defined outputStyle already set: ${existing.outputStyle}`
    };
  }

  const next =
    existing === null
      ? { outputStyle: 'peaks-skill-swarm' }
      : { ...existing, outputStyle: 'peaks-skill-swarm' };

  const existingJson = existing === null ? null : `${JSON.stringify(existing, null, 2)}\n`;
  const nextJson = `${JSON.stringify(next, null, 2)}\n`;
  if (existingJson === nextJson) {
    return { skipped: true, reason: 'no change' };
  }

  const writeError = writeSettingsAtomically(settingsPath, nextJson);
  if (writeError !== null) return { skipped: true, reason: 'write error', error: writeError };

  return {
    installed: true,
    created: existing === null,
    updated: existing !== null,
    settingsPath,
    outputStyle: 'peaks-skill-swarm'
  };
}
