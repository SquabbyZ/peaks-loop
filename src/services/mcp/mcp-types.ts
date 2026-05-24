export type McpServerSource = 'peaks' | 'cc-switch' | 'user' | 'plugin' | 'unknown';

export type McpServerScope = 'global' | 'project' | 'plugin';

export type McpServerConfig = {
  name: string;
  command: string;
  args: string[];
  envKeys: string[];
  source: McpServerSource;
  scope: McpServerScope;
  pluginName?: string;
};

export type McpSettingsScopeReport = {
  path: string;
  exists: boolean;
  parseError?: string;
};

export type McpPluginsReport = {
  path: string;
  exists: boolean;
  parseError?: string;
  pluginsScanned: number;
  pluginsWithMcp: number;
};

export type McpScanReport = {
  servers: McpServerConfig[];
  scopes: {
    global: McpSettingsScopeReport;
    project: McpSettingsScopeReport | null;
    plugins: McpPluginsReport;
  };
};
