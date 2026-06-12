import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { savePreferences } from '../preferences/preferences-service.js';

export const CONFIG_SCHEMA_VERSION_V2 = '2.0.0';
const BACKUP_NAME = 'config.json.1.x.bak';

/**
 * Per-project fields that the 1.x → 2.0 migration moves
 * from `~/.peaks/config.json` (global) to `<project>/.peaks/preferences.json`
 * (per-project). Per spec §10.4 line 1215: "economyMode / swarmMode
 * 字段从 global 迁移到当前 workspace 的 .peaks/preferences.json".
 */
const PER_PROJECT_FIELDS = ['economyMode', 'swarmMode'] as const;
type PerProjectField = (typeof PER_PROJECT_FIELDS)[number];

export interface MigrationOptions {
  currentProjectRoot: string;
}

export interface MigrationPlan {
  alreadyAtV2: boolean;
  detectedSchemaVersion: string | null;
  newConfigSchemaVersion: string;
  /** Field names that would be migrated on apply (1.x → 2.0). */
  willMigrateFields: readonly PerProjectField[];
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

/**
 * Inspect the on-disk 1.x config and return the subset of
 * per-project fields that are present and would be migrated on
 * apply. The list is used both by `planMigration` (to populate
 * `willMigrateFields`) and by `executeMigration` (to know which
 * fields to forward to `savePreferences`).
 */
function discoverMigratableFields(raw: Record<string, unknown>): readonly PerProjectField[] {
  const out: PerProjectField[] = [];
  for (const f of PER_PROJECT_FIELDS) {
    if (typeof raw[f] === 'boolean') out.push(f);
  }
  return out;
}

export function planMigration(opts: MigrationOptions): MigrationPlan {
  const configPath = globalConfigPath();
  let detectedSchemaVersion: string | null = null;
  let willMigrateFields: readonly PerProjectField[] = [];
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    detectedSchemaVersion = (raw.version as string) ?? null;
    willMigrateFields = discoverMigratableFields(raw);
  }
  if (detectedSchemaVersion === CONFIG_SCHEMA_VERSION_V2) {
    return {
      alreadyAtV2: true,
      detectedSchemaVersion,
      newConfigSchemaVersion: CONFIG_SCHEMA_VERSION_V2,
      willMigrateFields: [],
    };
  }
  return {
    alreadyAtV2: false,
    detectedSchemaVersion,
    newConfigSchemaVersion: CONFIG_SCHEMA_VERSION_V2,
    willMigrateFields,
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
  // 2. Forward per-project fields to <projectRoot>/.peaks/preferences.json
  //    (per spec §10.4). The preferences service merges over the existing
  //    schema-valid preferences.json; boolean fields only, with the
  //    discoverMigratableFields() allowlist as the source of truth.
  if (plan.willMigrateFields.length > 0) {
    const overrides: Record<string, boolean> = {};
    for (const f of plan.willMigrateFields) {
      const v = original[f];
      if (typeof v === 'boolean') overrides[f] = v;
    }
    savePreferences(opts.currentProjectRoot, overrides);
  }
  // 3. Slim config.json — schema version + discoverable ocr.llm placeholders.
  //    Per the 2.0.1 slim spec, the on-disk `~/.peaks/config.json` is
  //    `{ "version": "2.0.1", "ocr": { "llm": { ... } } }`. Legacy fields
  //    (language, model, economyMode, swarmMode, tokens, providers,
  //    proxy) live in <project>/.peaks/preferences.json. peaks-cli writes
  //    the `ocr.llm.*` placeholders so the user has a discoverable spot
  //    to paste their endpoint; the placeholders are empty strings, not
  //    auto-configured values, so the post-migration file MUST contain
  //    the `ocr.llm.*` block with empty defaults.
  mkdirSync(join(homedir(), '.peaks'), { recursive: true });
  writeFileSync(configPath, JSON.stringify({
    version: CONFIG_SCHEMA_VERSION_V2,
    ocr: {
      llm: {
        url: '',
        authToken: '',
        model: '',
        useAnthropic: false,
        authHeader: 'authorization'
      }
    }
  }, null, 2) + '\n', 'utf8');
  return { ...plan, applied: true, backupPath: bak, newConfigPath: configPath };
}
