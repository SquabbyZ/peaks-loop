import type { McpServerScope } from './mcp-types.js';

export type McpInstallSpec = {
  capabilityId: string;
  name: string;
  scope: McpServerScope;
  command: string;
  args: string[];
  envKeys: string[];
};

export const seedMcpInstalls: ReadonlyArray<McpInstallSpec> = [
  {
    capabilityId: 'context7.docs-lookup',
    name: 'context7',
    scope: 'global',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp@latest'],
    envKeys: ['CONTEXT7_API_KEY']
  },
  {
    capabilityId: 'playwright-mcp.browser-validation',
    name: 'playwright',
    scope: 'global',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    envKeys: []
  },
  {
    capabilityId: 'chrome-devtools-mcp.browser-debug',
    name: 'chrome-devtools',
    scope: 'global',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
    envKeys: []
  },
  {
    capabilityId: 'figma-context-mcp.design-context',
    name: 'figma',
    scope: 'global',
    command: 'npx',
    args: ['-y', 'figma-developer-mcp@latest', '--stdio'],
    envKeys: ['FIGMA_API_KEY']
  }
];

export function findMcpInstallSpec(capabilityId: string): McpInstallSpec | null {
  const match = seedMcpInstalls.find((spec) => spec.capabilityId === capabilityId);
  return match ?? null;
}
