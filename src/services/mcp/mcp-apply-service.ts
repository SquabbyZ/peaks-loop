import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathExists, readText } from '../../shared/fs.js';
import { planMcpInstall, type PlanMcpInstallOptions, type McpInstallEnvCheck } from './mcp-plan-service.js';
import type { McpInstallSpec } from './mcp-install-registry.js';

export type McpApplyAction = 'add' | 'update' | 'claimed' | 'noop';

export type McpApplyBackupInfo = {
  path: string | null;
  skipped: boolean;
};

export type McpApplyResult = {
  capabilityId: string;
  action: McpApplyAction;
  backup: McpApplyBackupInfo;
  written: {
    settingsPath: string;
    managedMarkerPath: string;
  };
  envCheck: McpInstallEnvCheck;
};

export type McpApplyOptions = PlanMcpInstallOptions & {
  claim?: boolean;
  backupRoot?: string;
  clock?: () => string;
};

export type McpRollbackOptions = {
  backupPath: string;
  globalSettingsPath?: string;
};

export type McpRollbackResult = {
  restoredFrom: string;
  restoredTo: string;
};

function defaultGlobalSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function defaultManagedMarkerPath(): string {
  return join(homedir(), '.peaks', 'mcp-managed.json');
}

function defaultBackupRoot(): string {
  return join(homedir(), '.peaks-artifacts', 'mcp-backups');
}

function defaultClock(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  if (!(await pathExists(path))) {
    return {};
  }
  const raw = await readText(path);
  if (raw.length === 0) {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function buildServerConfig(spec: McpInstallSpec): Record<string, unknown> {
  const env: Record<string, string> = {};
  for (const key of spec.envKeys) {
    env[key] = `\${${key}}`;
  }
  return { command: spec.command, args: [...spec.args], env };
}

async function createBackup(settingsPath: string, backupRoot: string, timestamp: string): Promise<string | null> {
  if (!(await pathExists(settingsPath))) {
    return null;
  }
  const backupPath = join(backupRoot, timestamp, 'settings.json');
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, await readText(settingsPath), 'utf8');
  return backupPath;
}

async function updateManagedMarker(markerPath: string, name: string): Promise<void> {
  const marker = await readJsonFile(markerPath);
  const existing = Array.isArray(marker.servers)
    ? (marker.servers as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : [];
  if (!existing.includes(name)) {
    existing.push(name);
  }
  await writeJsonFile(markerPath, { ...marker, servers: existing });
}

export async function applyMcpInstall(capabilityId: string, options: McpApplyOptions = {}): Promise<McpApplyResult> {
  const plan = await planMcpInstall(capabilityId, options);

  if (plan.action === 'unknown-capability' || plan.spec === null) {
    throw new Error(`No MCP install spec registered for capability ${capabilityId} (unknown-capability)`);
  }
  if (plan.envCheck.missing.length > 0) {
    throw new Error(`Refusing to apply: missing required env vars: ${plan.envCheck.missing.join(', ')}`);
  }
  if (plan.action === 'conflict' && options.claim !== true) {
    throw new Error(`Refusing to apply: server ${plan.spec.name} exists but is not peaks-managed (conflict). Re-run with --claim to take ownership.`);
  }

  const settingsPath = options.globalSettingsPath ?? defaultGlobalSettingsPath();
  const markerPath = options.managedMarkerPath ?? defaultManagedMarkerPath();
  const backupRoot = options.backupRoot ?? defaultBackupRoot();
  const clock = options.clock ?? defaultClock;

  if (plan.action === 'noop') {
    return {
      capabilityId,
      action: 'noop',
      backup: { path: null, skipped: true },
      written: { settingsPath, managedMarkerPath: markerPath },
      envCheck: plan.envCheck
    };
  }

  const backupPath = await createBackup(settingsPath, backupRoot, clock());
  const settings = await readJsonFile(settingsPath);
  const existingServers: Record<string, unknown> =
    settings.mcpServers !== null && typeof settings.mcpServers === 'object' && !Array.isArray(settings.mcpServers)
      ? (settings.mcpServers as Record<string, unknown>)
      : {};
  const nextServers = { ...existingServers, [plan.spec.name]: buildServerConfig(plan.spec) };
  await writeJsonFile(settingsPath, { ...settings, mcpServers: nextServers });
  await updateManagedMarker(markerPath, plan.spec.name);

  const action: McpApplyAction = plan.action === 'conflict' ? 'claimed' : plan.action;

  return {
    capabilityId,
    action,
    backup: { path: backupPath, skipped: false },
    written: { settingsPath, managedMarkerPath: markerPath },
    envCheck: plan.envCheck
  };
}

export async function rollbackMcpInstall(options: McpRollbackOptions): Promise<McpRollbackResult> {
  if (!(await pathExists(options.backupPath))) {
    throw new Error(`Refusing to rollback: backup file not found at ${options.backupPath}`);
  }
  const target = options.globalSettingsPath ?? defaultGlobalSettingsPath();
  const content = await readText(options.backupPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
  return { restoredFrom: options.backupPath, restoredTo: target };
}
