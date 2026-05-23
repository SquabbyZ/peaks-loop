import { describe, expect, test } from 'vitest';
import { seedMcpInstalls, findMcpInstallSpec } from '../../src/services/mcp/mcp-install-registry.js';
import { seedCapabilityItems } from '../../src/services/recommendations/capability-seed-items.js';

describe('dogfood: MCP capability map and install registry stay in sync', () => {
  test('every install spec resolves an mcp-typed capability map entry', () => {
    for (const spec of seedMcpInstalls) {
      const capability = seedCapabilityItems.find((item) => item.capabilityId === spec.capabilityId);
      expect.soft(capability, `install spec ${spec.capabilityId} has no matching capability map entry`).toBeDefined();
      expect.soft(capability?.itemType, `${spec.capabilityId} capability map entry must be itemType=mcp`).toBe('mcp');
    }
  });

  test('the headline MCP capabilities documented in the skills have an installable plan', () => {
    const headlineIds = [
      'context7.docs-lookup',
      'playwright-mcp.browser-validation',
      'chrome-devtools-mcp.browser-debug',
      'figma-context-mcp.design-context'
    ];

    for (const id of headlineIds) {
      const spec = findMcpInstallSpec(id);
      expect.soft(spec, `${id} should have an install spec so peaks mcp plan/apply works`).not.toBeNull();
    }
  });

  test('install spec server names are unique so apply cannot accidentally clobber siblings', () => {
    const names = seedMcpInstalls.map((spec) => spec.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  test('install spec capability ids are unique so the registry lookup is unambiguous', () => {
    const ids = seedMcpInstalls.map((spec) => spec.capabilityId);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
