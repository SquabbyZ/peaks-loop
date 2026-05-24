import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathExists, readText } from '../../shared/fs.js';
import { getErrorMessage } from '../../shared/result.js';
import type {
  McpPluginsReport,
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
  pluginsRegistryPath?: string;
};

type ParsedSettings = { parsed: Record<string, unknown> | null; parseError?: string };

function defaultGlobalSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

function defaultManagedMarkerPath(): string {
  return join(homedir(), '.peaks', 'mcp-managed.json');
}

function defaultPluginsRegistryPath(): string {
  return join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
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
  source: McpServerSource,
  pluginName?: string
): McpServerConfig | null {
  const command = raw.command;
  if (typeof command !== 'string' || command.length === 0) {
    return null;
  }
  const config: McpServerConfig = {
    name,
    command,
    args: toStringArray(raw.args),
    envKeys: toEnvKeys(raw.env),
    scope,
    source
  };
  if (pluginName !== undefined && pluginName.length > 0) {
    config.pluginName = pluginName;
  }
  return config;
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

function extractMcpServersBlock(parsed: unknown): Record<string, unknown> | null {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const wrapped = (parsed as { mcpServers?: unknown }).mcpServers;
  if (wrapped !== undefined && wrapped !== null && typeof wrapped === 'object' && !Array.isArray(wrapped)) {
    return wrapped as Record<string, unknown>;
  }
  return parsed as Record<string, unknown>;
}

async function readPluginMcpServers(
  installPath: string,
  pluginName: string
): Promise<McpServerConfig[]> {
  const mcpFilePath = join(installPath, '.mcp.json');
  if (!(await pathExists(mcpFilePath))) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readText(mcpFilePath));
  } catch {
    return [];
  }
  const block = extractMcpServersBlock(parsed);
  if (block === null) {
    return [];
  }
  const servers: McpServerConfig[] = [];
  for (const [name, raw] of Object.entries(block)) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const config = buildServerConfig(name, raw as Record<string, unknown>, 'plugin', 'plugin', pluginName);
    if (config !== null) {
      servers.push(config);
    }
  }
  return servers;
}

async function scanPluginMcpServers(
  registryPath: string
): Promise<{ servers: McpServerConfig[]; report: McpPluginsReport }> {
  const exists = await pathExists(registryPath);
  const baseReport: McpPluginsReport = {
    path: registryPath,
    exists,
    pluginsScanned: 0,
    pluginsWithMcp: 0
  };
  if (!exists) {
    return { servers: [], report: baseReport };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readText(registryPath));
  } catch (error) {
    return { servers: [], report: { ...baseReport, parseError: getErrorMessage(error) } };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { servers: [], report: baseReport };
  }
  const pluginsField = (parsed as { plugins?: unknown }).plugins;
  if (pluginsField === null || typeof pluginsField !== 'object' || Array.isArray(pluginsField)) {
    return { servers: [], report: baseReport };
  }
  const servers: McpServerConfig[] = [];
  let pluginsScanned = 0;
  let pluginsWithMcp = 0;
  for (const [pluginId, entries] of Object.entries(pluginsField as Record<string, unknown>)) {
    if (!Array.isArray(entries) || entries.length === 0) {
      continue;
    }
    const first = entries[0];
    if (first === null || typeof first !== 'object' || Array.isArray(first)) {
      continue;
    }
    const installPath = (first as { installPath?: unknown }).installPath;
    if (typeof installPath !== 'string' || installPath.length === 0) {
      continue;
    }
    pluginsScanned += 1;
    const found = await readPluginMcpServers(installPath, pluginId);
    if (found.length > 0) {
      pluginsWithMcp += 1;
      servers.push(...found);
    }
  }
  return { servers, report: { ...baseReport, pluginsScanned, pluginsWithMcp } };
}

export async function scanMcpServers(options: McpScanOptions = {}): Promise<McpScanReport> {
  const globalPath = options.globalSettingsPath ?? defaultGlobalSettingsPath();
  const managedMarkerPath = options.managedMarkerPath ?? defaultManagedMarkerPath();
  const pluginsRegistryPath = options.pluginsRegistryPath ?? defaultPluginsRegistryPath();
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

  const plugins = await scanPluginMcpServers(pluginsRegistryPath);

  return {
    servers: [...globalServers, ...projectServers, ...plugins.servers],
    scopes: { global: globalScope, project: projectScope, plugins: plugins.report }
  };
}
