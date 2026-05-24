import { scanMcpServers, type McpScanOptions } from './mcp-scan-service.js';
import { findMcpInstallSpec, type McpInstallSpec } from './mcp-install-registry.js';
import type { McpServerConfig } from './mcp-types.js';

export type McpInstallAction = 'add' | 'update' | 'noop' | 'conflict' | 'unknown-capability';

export type McpInstallEnvCheck = {
  missing: string[];
};

export type McpInstallDiffEntry<T> = {
  before: T;
  after: T;
};

export type McpInstallDiff = {
  command?: McpInstallDiffEntry<string>;
  args?: McpInstallDiffEntry<string[]>;
  envKeys?: McpInstallDiffEntry<string[]>;
};

export type McpInstallPlan = {
  capabilityId: string;
  action: McpInstallAction;
  spec: McpInstallSpec | null;
  current: McpServerConfig | null;
  envCheck: McpInstallEnvCheck;
  diff: McpInstallDiff | null;
  nextActions: string[];
};

export type PlanMcpInstallOptions = McpScanOptions & {
  env?: Record<string, string | undefined>;
};

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function buildEnvCheck(spec: McpInstallSpec, env: Record<string, string | undefined>): McpInstallEnvCheck {
  const missing = spec.envKeys.filter((key) => {
    const value = env[key];
    return value === undefined || value.length === 0;
  });
  return { missing };
}

function buildDiff(spec: McpInstallSpec, current: McpServerConfig): McpInstallDiff | null {
  const diff: McpInstallDiff = {};
  if (current.command !== spec.command) {
    diff.command = { before: current.command, after: spec.command };
  }
  if (!arraysEqual(current.args, spec.args)) {
    diff.args = { before: current.args, after: spec.args };
  }
  if (!arraysEqual(current.envKeys, spec.envKeys)) {
    diff.envKeys = { before: current.envKeys, after: spec.envKeys };
  }
  return Object.keys(diff).length === 0 ? null : diff;
}

function buildNextActions(action: McpInstallAction, capabilityId: string, envMissing: string[]): string[] {
  const actions: string[] = [];
  if (action === 'unknown-capability') {
    actions.push(`No MCP install spec registered for capability ${capabilityId}`);
    return actions;
  }
  if (envMissing.length > 0) {
    actions.push(`Set required env vars before apply: ${envMissing.join(', ')}`);
  }
  if (action === 'add') {
    actions.push(`Run peaks mcp apply --capability ${capabilityId} --yes to write the new server`);
  } else if (action === 'update') {
    actions.push(`Run peaks mcp apply --capability ${capabilityId} --yes to update the existing peaks-managed server`);
  } else if (action === 'conflict') {
    actions.push(`Re-run with --claim to take ownership of the existing non-peaks-managed entry, or rename the conflicting server`);
  } else if (action === 'noop') {
    actions.push(`Server already matches the install spec; nothing to apply`);
  }
  return actions;
}

export async function planMcpInstall(capabilityId: string, options: PlanMcpInstallOptions = {}): Promise<McpInstallPlan> {
  const spec = findMcpInstallSpec(capabilityId);
  if (spec === null) {
    return {
      capabilityId,
      action: 'unknown-capability',
      spec: null,
      current: null,
      envCheck: { missing: [] },
      diff: null,
      nextActions: buildNextActions('unknown-capability', capabilityId, [])
    };
  }

  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const envCheck = buildEnvCheck(spec, env);

  const scanOptions: McpScanOptions = {};
  if (options.globalSettingsPath !== undefined) {
    scanOptions.globalSettingsPath = options.globalSettingsPath;
  }
  if (options.projectRoot !== undefined) {
    scanOptions.projectRoot = options.projectRoot;
  }
  if (options.managedMarkerPath !== undefined) {
    scanOptions.managedMarkerPath = options.managedMarkerPath;
  }
  if (options.pluginsRegistryPath !== undefined) {
    scanOptions.pluginsRegistryPath = options.pluginsRegistryPath;
  }
  const report = await scanMcpServers(scanOptions);
  const current = report.servers.find((server) => server.name === spec.name && server.scope === spec.scope) ?? null;
  const pluginDuplicate = report.servers.find(
    (server) => server.source === 'plugin' && server.name === spec.name
  ) ?? null;

  let action: McpInstallAction;
  let diff: McpInstallDiff | null = null;
  if (current === null) {
    action = 'add';
  } else if (current.source !== 'peaks') {
    action = 'conflict';
  } else {
    diff = buildDiff(spec, current);
    action = diff === null ? 'noop' : 'update';
  }

  const nextActions = buildNextActions(action, capabilityId, envCheck.missing);
  if (pluginDuplicate !== null) {
    const pluginLabel = pluginDuplicate.pluginName ?? 'a Claude Code plugin';
    nextActions.push(
      `An MCP server named "${spec.name}" is already loaded by plugin ${pluginLabel}; installing via peaks would duplicate it`
    );
  }

  return {
    capabilityId,
    action,
    spec,
    current,
    envCheck,
    diff,
    nextActions
  };
}
