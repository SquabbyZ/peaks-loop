import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { backupConfigPath, globalConfigPath } from './config-migration.js';

export interface RollbackPlan {
  available: boolean;
  detectedVersion: string | null;
  backupPath: string;
}

export interface RollbackResult extends RollbackPlan {
  applied: boolean;
  restoredConfigPath?: string;
}

export function planRollback(): RollbackPlan {
  const backup = backupConfigPath();
  if (!existsSync(backup)) {
    return { available: false, detectedVersion: null, backupPath: backup };
  }
  const raw = JSON.parse(readFileSync(backup, 'utf8')) as Record<string, unknown>;
  return {
    available: true,
    detectedVersion: (raw.version as string) ?? null,
    backupPath: backup,
  };
}

export function executeRollback(opts: { apply: boolean }): RollbackResult {
  const plan = planRollback();
  if (!plan.available) {
    throw new Error('NO_BACKUP: ~/.peaks/config.json.1.x.bak not found');
  }
  if (!opts.apply) {
    return { ...plan, applied: false };
  }
  const restored = JSON.parse(readFileSync(plan.backupPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(globalConfigPath(), JSON.stringify(restored, null, 2) + '\n', 'utf8');
  return { ...plan, applied: true, restoredConfigPath: globalConfigPath() };
}
