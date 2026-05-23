import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathExists, readText } from '../../shared/fs.js';
import { getErrorMessage } from '../../shared/result.js';
import type {
  McpScanReport,
  McpServerConfig,
  McpServerScope,
  McpServerSource,
  McpSettingsScopeReport
} from './mcp-types.js';

export type McpScanOptions = {
  globalSettingsPath?: string;
  projectRoot?: string;
  managedMarkerPath?: string;
};

type ParsedSettings = { parsed: Record<string, unknown> | null; parseError?: string };

function defaultGlobalSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function defaultManagedMarkerPath(): string {
  return join(homedir(), '.peaks', 'mcp-managed.json');
}

function projectSettingsPath(projectRoot: string): string {
  return join(projectRoot, '.claude', 'settings.json');
}

async function readSettings(path: string): Promise<{ exists: boolean; parsed: ParsedSettings }> {
  if (!(await pathExists(path))) {
    return { exists: false, parsed: { parsed: null } };
  }
  try {
    const raw = await readText(path);
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { exists: true, parsed: { parsed: null } };
    }
    return { exists: true, parsed: { parsed: value as Record<string, unknown> } };
  } catch (error) {
    return { exists: true, parsed: { parsed: null, parseError: getErrorMessage(error) } };
  }
}

async function loadManagedNames(path: string): Promise<Set<string>> {
  if (!(await pathExists(path))) {
    return new Set();
  }
  try {
    const value: unknown = JSON.parse(await readText(path));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return new Set();
    }
    const servers = (value as { servers?: unknown }).servers;
    if (!Array.isArray(servers)) {
      return new Set();
    }
    return new Set(servers.filter((entry): entry is string => typeof entry === 'string'));
  } catch {
    return new Set();
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function toEnvKeys(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>);
}

function buildServerConfig(
  name: string,
  raw: Record<string, unknown>,
  scope: McpServerScope,
  source: McpServerSource
): McpServerConfig | null {
  const command = raw.command;
  if (typeof command !== 'string' || command.length === 0) {
    return null;
  }
  return {
    name,
    command,
    args: toStringArray(raw.args),
    envKeys: toEnvKeys(raw.env),
    scope,
    source
  };
}

function resolveServers(
  settings: Record<string, unknown> | null,
  scope: McpServerScope,
  managedNames: Set<string>
): McpServerConfig[] {
  if (settings === null) {
    return [];
  }
  const mcpServers = settings.mcpServers;
  if (mcpServers === null || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) {
    return [];
  }
  const servers: McpServerConfig[] = [];
  for (const [name, raw] of Object.entries(mcpServers as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const source: McpServerSource = managedNames.has(name) ? 'peaks' : 'unknown';
    const config = buildServerConfig(name, raw as Record<string, unknown>, scope, source);
    if (config !== null) {
      servers.push(config);
    }
  }
  return servers;
}

function toScopeReport(path: string, exists: boolean, parseError?: string): McpSettingsScopeReport {
  return parseError === undefined ? { path, exists } : { path, exists, parseError };
}

export async function scanMcpServers(options: McpScanOptions = {}): Promise<McpScanReport> {
  const globalPath = options.globalSettingsPath ?? defaultGlobalSettingsPath();
  const managedMarkerPath = options.managedMarkerPath ?? defaultManagedMarkerPath();
  const managedNames = await loadManagedNames(managedMarkerPath);

  const globalSettings = await readSettings(globalPath);
  const globalScope = toScopeReport(globalPath, globalSettings.exists, globalSettings.parsed.parseError);
  const globalServers = resolveServers(globalSettings.parsed.parsed, 'global', managedNames);

  let projectScope: McpSettingsScopeReport | null = null;
  const projectServers: McpServerConfig[] = [];
  if (options.projectRoot !== undefined) {
    const projectPath = projectSettingsPath(options.projectRoot);
    const projectSettings = await readSettings(projectPath);
    projectScope = toScopeReport(projectPath, projectSettings.exists, projectSettings.parsed.parseError);
    projectServers.push(...resolveServers(projectSettings.parsed.parsed, 'project', managedNames));
  }

  return {
    servers: [...globalServers, ...projectServers],
    scopes: { global: globalScope, project: projectScope }
  };
}
