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
 */

const GUARDED_FIELDS = new Set(['workspaces', 'providers', 'proxy']);

export interface RestoreResult {
  field: string;
  applied: boolean;
  sidecarPath?: string;
}

function readBakContent(): Record<string, unknown> {
  const bak = backupConfigPath();
  if (!existsSync(bak)) {
    throw new Error('NO_BACKUP: ~/.peaks/config.json.1.x.bak not found');
  }
  return JSON.parse(readFileSync(bak, 'utf8')) as Record<string, unknown>;
}

export function listAvailableFields(): string[] {
  const bak = readBakContent();
  return Object.keys(bak).filter((k) => k !== 'version');
}

export function restoreField(opts: { field: string; apply: boolean }): RestoreResult {
  const bak = readBakContent();
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
    return { field: opts.field, applied: false };
  }
  mkdirSync(join(home, '.peaks'), { recursive: true });
  const payload = {
    field: opts.field,
    value: bak[opts.field],
    source: 'config.json.1.x.bak',
    restoredAt: new Date().toISOString(),
  };
  writeFileSync(sidecar, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { field: opts.field, applied: true, sidecarPath: sidecar };
}
