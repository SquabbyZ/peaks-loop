import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { backupConfigPath } from './config-migration.js';

/**
 * Spec §8.6 — restore a single archived field from `config.json.1.x.bak`.
 * Does NOT modify `config.json` itself (which is now slim v2).
 * Instead writes a sidecar `config.json.restore-<field>.json` so the user
 * can review before adopting. Fields in the deferred-design set
 * (workspaces, providers, proxy) throw RESTORE_GUARDED so the user has
 * to acknowledge explicitly.
 *
 * MISSING BACKUP IS NOT A FAILURE (rid 2026-09-13-two-decisions ①, user-
 * decided). `~/.peaks/config.json.1.x.bak` only exists on a machine that ran
 * `peaks config migrate --apply`; a machine that never did is in its NORMAL
 * initial state, not in an error state. Both subcommands therefore report it
 * as a SUCCESS carrying `available: false` rather than throwing — the sibling
 * `rollback` already did, and `restore` exited 1 for the same state, so a
 * script could not ask either one "was there ever a backup?" without knowing
 * which subcommand it was talking to.
 *
 * ⚠️ THE COST, ACCEPTED BY THE USER: an existing script that read exit 1 as
 * "never backed up" loses that signal. The replacement is `available` — it is
 * on EVERY envelope this module produces, on the success path (`false` ⇒
 * nothing to restore, exit 0) and on the failure path (`true` ⇒ a backup IS
 * there and the field/guard was the problem, exit 1), so one JSON key answers
 * the question that used to take the exit code, and it distinguishes "no
 * backup" from "backup exists but the field is not in it".
 */

const GUARDED_FIELDS = new Set(['workspaces', 'providers', 'proxy']);

export interface RestoreListResult {
  /**
   * True when `~/.peaks/config.json.1.x.bak` exists — i.e. whether there is
   * anything to restore from at all. Meaning is identical to
   * `RollbackPlan.available`.
   */
  available: boolean;
  fields: string[];
}

export interface RestoreResult {
  /** See `RestoreListResult.available`. */
  available: boolean;
  field: string;
  applied: boolean;
  sidecarPath?: string;
}

/**
 * The parsed `.bak`, or `null` when there is none. `null` is the normal
 * "nothing was ever migrated" state (see the module comment), not an error.
 *
 * A `.bak` that exists but does not parse still throws: `available` means
 * "the backup file is present", and a present-but-malformed one is a real
 * failure the caller must surface.
 */
function readBakContent(): Record<string, unknown> | null {
  const bak = backupConfigPath();
  if (!existsSync(bak)) {
    return null;
  }
  return JSON.parse(readFileSync(bak, 'utf8')) as Record<string, unknown>;
}

export function listAvailableFields(): RestoreListResult {
  const bak = readBakContent();
  if (bak === null) {
    return { available: false, fields: [] };
  }
  return { available: true, fields: Object.keys(bak).filter((k) => k !== 'version') };
}

export function restoreField(opts: { field: string; apply: boolean }): RestoreResult {
  const bak = readBakContent();
  if (bak === null) {
    return { available: false, field: opts.field, applied: false };
  }
  if (!(opts.field in bak)) {
    throw new Error(`FIELD_NOT_FOUND: ${opts.field} is not in config.json.1.x.bak`);
  }
  if (GUARDED_FIELDS.has(opts.field)) {
    throw new Error(
      `RESTORE_GUARDED: restoring "${opts.field}" is discouraged because the deferred design intentionally avoids it; add it to config.json manually if you really need it`
    );
  }
  const home = homedir();
  const sidecar = join(home, '.peaks', `config.json.restore-${opts.field}.json`);
  if (!opts.apply) {
    return { available: true, field: opts.field, applied: false };
  }
  mkdirSync(join(home, '.peaks'), { recursive: true });
  const payload = {
    field: opts.field,
    value: bak[opts.field],
    source: 'config.json.1.x.bak',
    restoredAt: new Date().toISOString(),
  };
  writeFileSync(sidecar, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { available: true, field: opts.field, applied: true, sidecarPath: sidecar };
}
