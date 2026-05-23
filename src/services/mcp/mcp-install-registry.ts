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
  }
];

export function findMcpInstallSpec(capabilityId: string): McpInstallSpec | null {
  const match = seedMcpInstalls.find((spec) => spec.capabilityId === capabilityId);
  return match ?? null;
}
