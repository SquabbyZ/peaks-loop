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
    // rid 2026-09-13-two-decisions ①: a machine that never migrated has no
    // `.bak`, and that is its normal state — `--apply` on such a machine is
    // "nothing to roll back", not a failure. Returned instead of thrown so the
    // exit status and the `available` key agree on every path; see
    // `config-restore.ts` for the full rationale and the accepted cost.
    return { ...plan, applied: false };
  }
  if (!opts.apply) {
    return { ...plan, applied: false };
  }
  const restored = JSON.parse(readFileSync(plan.backupPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(globalConfigPath(), JSON.stringify(restored, null, 2) + '\n', 'utf8');
  return { ...plan, applied: true, restoredConfigPath: globalConfigPath() };
}
