import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_SCHEMA_VERSION_V2 = '2.0.0';
const BACKUP_NAME = 'config.json.1.x.bak';

export interface MigrationOptions {
  currentProjectRoot: string;
}

export interface MigrationPlan {
  alreadyAtV2: boolean;
  detectedSchemaVersion: string | null;
  newConfigSchemaVersion: string;
}

export interface MigrationResult extends MigrationPlan {
  applied: boolean;
  backupPath?: string;
  newConfigPath?: string;
  error?: string;
}

export function globalConfigPath(): string {
  return join(homedir(), '.peaks', 'config.json');
}

export function backupConfigPath(): string {
  return join(homedir(), '.peaks', BACKUP_NAME);
}

export function planMigration(opts: MigrationOptions): MigrationPlan {
  const configPath = globalConfigPath();
  let detectedSchemaVersion: string | null = null;
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    detectedSchemaVersion = (raw.version as string) ?? null;
  }
  if (detectedSchemaVersion === CONFIG_SCHEMA_VERSION_V2) {
    return {
      alreadyAtV2: true,
      detectedSchemaVersion,
      newConfigSchemaVersion: CONFIG_SCHEMA_VERSION_V2,
    };
  }
  return {
    alreadyAtV2: false,
    detectedSchemaVersion,
    newConfigSchemaVersion: CONFIG_SCHEMA_VERSION_V2,
  };
}

export function executeMigration(opts: MigrationOptions & { apply: boolean }): MigrationResult {
  const configPath = globalConfigPath();
  if (!existsSync(configPath)) {
    throw new Error('NO_CONFIG: ~/.peaks/config.json not found');
  }
  const plan = planMigration(opts);
  if (plan.alreadyAtV2) {
    return { ...plan, applied: false };
  }
  if (!opts.apply) {
    return { ...plan, applied: false };
  }
  const original = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  // 1. Backup
  const bak = backupConfigPath();
  writeFileSync(bak, JSON.stringify(original, null, 2) + '\n', 'utf8');
  // 2. Slim config.json — only the schema version remains.
  mkdirSync(join(homedir(), '.peaks'), { recursive: true });
  writeFileSync(configPath, JSON.stringify({ version: CONFIG_SCHEMA_VERSION_V2 }, null, 2) + '\n', 'utf8');
  return { ...plan, applied: true, backupPath: bak, newConfigPath: configPath };
}
