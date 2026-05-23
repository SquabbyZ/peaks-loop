export type McpServerSource = 'peaks' | 'cc-switch' | 'user' | 'unknown';

export type McpServerScope = 'global' | 'project';

export type McpServerConfig = {
  name: string;
  command: string;
  args: string[];
  envKeys: string[];
  source: McpServerSource;
  scope: McpServerScope;
};

export type McpSettingsScopeReport = {
  path: string;
  exists: boolean;
  parseError?: string;
};

export type McpScanReport = {
  servers: McpServerConfig[];
  scopes: {
    global: McpSettingsScopeReport;
    project: McpSettingsScopeReport | null;
  };
};
