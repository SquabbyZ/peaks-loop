import { describe, expect, test } from 'vitest';
import { createCapabilityMapPlan } from '../../src/services/recommendations/capability-map-service.js';
import { seedCapabilitySources } from '../../src/services/recommendations/seed-capability-catalog.js';

describe('createCapabilityMapPlan', () => {
  test('returns all source groups with proxy policy and dry-run constraints', () => {
    const plan = createCapabilityMapPlan();
    const sourceGroups = new Set(plan.sources.map((source) => source.sourceGroup));
    const commandPreviews = plan.mappings.flatMap((mapping) => (mapping.commandPreview ? [mapping.commandPreview] : []));

    expect(sourceGroups).toEqual(new Set(['access-repo', 'mcp-server']));
    expect(plan.dryRunOnly).toBe(true);
    expect(plan.executionPolicy).toEqual({ allowInstall: false, allowClone: false, allowConfigWrite: false, allowSecretExfiltration: false });
    expect(plan.proxyPolicy).toBeUndefined();
    expect(plan.constraints.join('\n')).toContain('dry-run only');
    expect(plan.constraints.join('\n')).not.toContain('HTTP proxy');
    expect(commandPreviews.every((preview) => !/\b(?:npm|pnpm|yarn|bun|npx|git|gh|claude|curl|wget|powershell|bash|sh)\b/i.test(preview))).toBe(true);
    expect(commandPreviews.every((preview) => !preview.includes('--confirm'))).toBe(true);
  });

  test('uses configured proxy in policy and constraints', () => {
    const plan = createCapabilityMapPlan({ httpProxy: 'https://proxy.example:8443' });

    expect(plan.proxyPolicy?.httpProxy).toBe('https://proxy.example:8443');
    expect(plan.constraints.join('\n')).toContain('https://proxy.example:8443');
  });

  test('omits proxy policy for empty, malformed, or unsafe proxy values', () => {
    const plans = [
      createCapabilityMapPlan({ httpProxy: '' }),
      createCapabilityMapPlan({ httpProxy: '   ' }),
      createCapabilityMapPlan({ httpProxy: 'not a url' }),
      createCapabilityMapPlan({ httpProxy: 'https://proxy.example:8443/path?token=secret' })
    ];

    expect(plans.every((plan) => plan.proxyPolicy === undefined)).toBe(true);
    expect(plans.every((plan) => !plan.constraints.join('\n').includes('HTTP proxy'))).toBe(true);
  });

  test('filters access-repo sources and mappings', () => {
    const plan = createCapabilityMapPlan({ source: 'access-repo' });

    expect(plan.sources.length).toBeGreaterThan(0);
    expect(plan.sources.every((source) => source.sourceGroup === 'access-repo')).toBe(true);
    expect(plan.mappings.every((mapping) => mapping.sourceGroup === 'access-repo')).toBe(true);
    expect(plan.sources.map((source) => source.sourceId)).toContain('context7');
    expect(plan.sources.map((source) => source.sourceId)).not.toContain('openspec');
  });

  test('filters mcp-server sources and mappings', () => {
    const plan = createCapabilityMapPlan({ source: 'mcp-server' });

    expect(plan.sources.length).toBeGreaterThan(0);
    expect(plan.sources.every((source) => source.sourceGroup === 'mcp-server')).toBe(true);
    expect(plan.mappings.every((mapping) => mapping.sourceGroup === 'mcp-server')).toBe(true);
    expect(plan.sources.map((source) => source.sourceId)).toContain('openspec');
    expect(plan.sources.map((source) => source.sourceId)).not.toContain('context7');
  });

  test('maps every seeded source to at least one landing target', () => {
    const plan = createCapabilityMapPlan();
    const mappedSourceIds = new Set(plan.mappings.map((mapping) => mapping.sourceId));

    expect(seedCapabilitySources.every((source) => mappedSourceIds.has(source.sourceId))).toBe(true);
    expect(plan.mappings.every((mapping) => mapping.dryRunOnly)).toBe(true);
  });

  test('maps every concrete item to a landing target', () => {
    const plan = createCapabilityMapPlan();
    const mappedCapabilityIds = new Set(plan.mappings.map((mapping) => mapping.capabilityId));
    const itemCapabilityIds = new Set(plan.items.map((item) => item.capabilityId));

    expect(plan.items.every((item) => mappedCapabilityIds.has(item.capabilityId))).toBe(true);
    expect(plan.mappings.every((mapping) => itemCapabilityIds.has(mapping.capabilityId))).toBe(true);
  });

  test('does not expose mutable seed references', () => {
    const firstPlan = createCapabilityMapPlan({ source: 'access-repo' });
    expect(firstPlan.mappings.length).toBeGreaterThan(0);
    firstPlan.sources[0]?.items.push('mutated');
    firstPlan.items[0]?.workflows.push('mutated');
    firstPlan.mappings[0]!.target = 'mutated';

    const secondPlan = createCapabilityMapPlan({ source: 'access-repo' });
    expect(secondPlan.sources.flatMap((source) => source.items)).not.toContain('mutated');
    expect(secondPlan.items.flatMap((item) => item.workflows)).not.toContain('mutated');
    expect(secondPlan.mappings.map((mapping) => mapping.target)).not.toContain('mutated');
  });

  test('returns deterministic sorted output and availability', () => {
    const firstPlan = createCapabilityMapPlan({ installedCapabilityIds: ['context7.docs-lookup'] });
    const secondPlan = createCapabilityMapPlan({ installedCapabilityIds: ['context7.docs-lookup'] });
    const contextAvailability = firstPlan.availability.find((item) => item.capabilityId === 'context7.docs-lookup');
    const missingAvailability = firstPlan.availability.find((item) => item.capabilityId === 'playwright-mcp.browser-validation');

    expect(firstPlan.sources.map((source) => source.sourceId)).toEqual([...firstPlan.sources.map((source) => source.sourceId)].sort());
    expect(firstPlan.items.map((item) => item.capabilityId)).toEqual([...firstPlan.items.map((item) => item.capabilityId)].sort());
    expect(firstPlan.mappings.map((mapping) => `${mapping.sourceId}:${mapping.capabilityId}`)).toEqual(secondPlan.mappings.map((mapping) => `${mapping.sourceId}:${mapping.capabilityId}`));
    expect(contextAvailability?.status).toBe('available');
    expect(missingAvailability?.status).toBe('unknown');
    expect(missingAvailability).not.toHaveProperty('installPlan');
  });

  test('sorts multiple mappings for the same source deterministically', () => {
    const plan = createCapabilityMapPlan({ source: 'mcp-server' });
    const everythingMappings = plan.mappings.filter((mapping) => mapping.sourceId === 'everything-claude-code');

    expect(everythingMappings.map((mapping) => mapping.capabilityId)).toEqual([...everythingMappings.map((mapping) => mapping.capabilityId)].sort());
  });

  test('maps everything-claude-code standards guidance into Peaks code workflow skills', () => {
    const plan = createCapabilityMapPlan({ source: 'mcp-server' });
    const standardsItem = plan.items.find((item) => item.capabilityId === 'everything-claude-code.language-standards');
    const standardsMapping = plan.mappings.find((mapping) => mapping.capabilityId === 'everything-claude-code.language-standards');
    const reviewMapping = plan.mappings.find((mapping) => mapping.capabilityId === 'everything-claude-code.code-review-guidance');
    const securityMapping = plan.mappings.find((mapping) => mapping.capabilityId === 'everything-claude-code.security-review-guidance');

    expect(standardsItem?.itemType).toBe('rule');
    expect(standardsItem?.presentation.displayName['zh-CN']).toContain('语言编码规范');
    expect(standardsMapping?.skillName).toBe('peaks-rd');
    expect(reviewMapping?.skillName).toBe('peaks-qa');
    expect(securityMapping?.skillName).toBe('peaks-qa');
  });

  test('maps mattpocock/skills item-level methods into Peaks skill landings', () => {
    const plan = createCapabilityMapPlan({ source: 'mcp-server' });
    const source = plan.sources.find((candidate) => candidate.sourceId === 'mattpocock-skills');
    const targetsFor = (capabilityId: string) =>
      plan.mappings
        .filter((mapping) => mapping.capabilityId === capabilityId)
        .map((mapping) => mapping.target)
        .sort();

    expect(source?.discoveryStatus).toBe('indexed');
    expect(plan.items.find((item) => item.capabilityId === 'mattpocock-skills.typescript-guidance')).toBeUndefined();
    expect(targetsFor('mattpocock-skills.product-prd-methods')).toEqual(['peaks-prd']);
    expect(targetsFor('mattpocock-skills.engineering-diagnosis')).toEqual(['peaks-rd']);
    expect(targetsFor('mattpocock-skills.tdd-method')).toEqual(['peaks-qa', 'peaks-rd']);
    expect(targetsFor('mattpocock-skills.qa-triage')).toEqual(['peaks-qa']);
    expect(targetsFor('mattpocock-skills.handoff-context')).toEqual(['peaks-txt']);
    expect(targetsFor('mattpocock-skills.git-guardrails')).toEqual(['git guardrails reference catalog']);
    expect(plan.mappings.find((mapping) => mapping.capabilityId === 'mattpocock-skills.git-guardrails')?.landingKind).toBe('catalog');
    expect(plan.mappings.filter((mapping) => mapping.sourceId === 'mattpocock-skills').every((mapping) => mapping.dryRunOnly)).toBe(true);
  });

  test('maps codegraph local analysis capabilities into Peaks skill landings', () => {
    const plan = createCapabilityMapPlan({ source: 'access-repo' });
    const source = plan.sources.find((candidate) => candidate.sourceId === 'codegraph');
    const targetsFor = (capabilityId: string) =>
      plan.mappings
        .filter((mapping) => mapping.capabilityId === capabilityId)
        .map((mapping) => mapping.target)
        .sort();

    expect(source?.discoveryStatus).toBe('indexed');
    expect(targetsFor('codegraph.project-indexing')).toEqual(['peaks-rd']);
    expect(targetsFor('codegraph.semantic-query')).toEqual(['peaks-rd']);
    expect(targetsFor('codegraph.impact-analysis')).toEqual(['peaks-qa', 'peaks-rd']);
    expect(targetsFor('codegraph.context-pack')).toEqual(['peaks-rd', 'peaks-code', 'peaks-txt']);
    expect(plan.mappings.filter((mapping) => mapping.sourceId === 'codegraph').every((mapping) => mapping.dryRunOnly)).toBe(true);
    expect(plan.mappings.filter((mapping) => mapping.sourceId === 'codegraph').map((mapping) => mapping.commandPreview)).not.toContain('npx @colbymchenry/codegraph install');
  });
});
