import { describe, expect, test } from 'vitest';
import { createRecommendationPlan } from '../../src/services/recommendations/recommendation-service.js';
import { seedCapabilityItems, seedCapabilitySources } from '../../src/services/recommendations/seed-capability-catalog.js';

describe('seed capability catalog', () => {
  test('models everything-claude-code as a source with item-level capabilities', () => {
    const source = seedCapabilitySources.find((candidate) => candidate.sourceId === 'everything-claude-code');
    const reviewAgent = seedCapabilityItems.find((candidate) => candidate.capabilityId === 'everything-claude-code.code-review-agent');

    expect(source?.sourceType).toBe('repo');
    expect(source?.items).toContain('everything-claude-code.code-review-agent');
    expect(reviewAgent?.sourceId).toBe('everything-claude-code');
    expect(reviewAgent?.category).toBe('code-review');
  });

  test('models mattpocock/skills as indexed item-level Peaks workflow references', () => {
    const expectedCapabilityIds = [
      'mattpocock-skills.product-prd-methods',
      'mattpocock-skills.engineering-diagnosis',
      'mattpocock-skills.tdd-method',
      'mattpocock-skills.qa-triage',
      'mattpocock-skills.handoff-context',
      'mattpocock-skills.git-guardrails'
    ];
    const source = seedCapabilitySources.find((candidate) => candidate.sourceId === 'mattpocock-skills');
    const itemIds = seedCapabilityItems.map((item) => item.capabilityId);

    expect(source?.sourceType).toBe('skills-package');
    expect(source?.sourceGroup).toBe('mcp-server');
    expect(source?.discoveryStatus).toBe('indexed');
    expect(source?.trustSignals?.notes?.join('\n')).toContain('Catalog/reference only');
    expect(source?.items).toEqual(expectedCapabilityIds);
    expect(itemIds).toEqual(expect.arrayContaining(expectedCapabilityIds));
    expect(seedCapabilityItems.find((item) => item.capabilityId === 'mattpocock-skills.typescript-guidance')).toBeUndefined();
    expect(seedCapabilityItems.filter((item) => item.sourceId === 'mattpocock-skills')).toHaveLength(expectedCapabilityIds.length);
  });

  test('models codegraph as indexed local analysis capabilities for Peaks skills', () => {
    const expectedCapabilityIds = [
      'codegraph.project-indexing',
      'codegraph.semantic-query',
      'codegraph.impact-analysis',
      'codegraph.context-pack'
    ];
    const source = seedCapabilitySources.find((candidate) => candidate.sourceId === 'codegraph');
    const items = seedCapabilityItems.filter((item) => item.sourceId === 'codegraph');

    expect(source?.sourceType).toBe('repo');
    expect(source?.sourceGroup).toBe('access-repo');
    expect(source?.discoveryStatus).toBe('indexed');
    expect(source?.trustSignals?.notes?.join('\n')).toContain('Use through peaks codegraph only');
    expect(source?.items).toEqual(expectedCapabilityIds);
    expect(items.map((item) => item.capabilityId)).toEqual(expectedCapabilityIds);
    expect(items.every((item) => item.fallback.qualityImpact === 'same')).toBe(true);
  });

  test('models MCP collections as sources and concrete MCPs as items', () => {
    const source = seedCapabilitySources.find((candidate) => candidate.sourceId === 'modelcontextprotocol-servers');
    const context7 = seedCapabilityItems.find((candidate) => candidate.capabilityId === 'context7.docs-lookup');

    expect(source?.sourceType).toBe('mcp-collection');
    expect(context7?.itemType).toBe('mcp');
    expect(context7?.workflows).toContain('code-refactor');
  });

  test('includes representative access and mcp server capability seeds', () => {
    expect(seedCapabilitySources.map((source) => source.sourceId)).toEqual(
      expect.arrayContaining(['playwright-mcp', 'chrome-devtools-mcp', 'figma-context-mcp', 'openspec'])
    );
    expect(seedCapabilityItems.map((item) => item.capabilityId)).toEqual(
      expect.arrayContaining(['playwright-mcp.browser-validation', 'chrome-devtools-mcp.browser-debug', 'figma-context-mcp.design-context', 'openspec.spec-workflow'])
    );
  });
});

describe('createRecommendationPlan', () => {
  test('creates localized code-refactor recommendations with fallback actions and preferred invoke action', () => {
    const plan = createRecommendationPlan({
      workflow: 'code-refactor',
      language: 'zh-CN',
      installedCapabilityIds: ['everything-claude-code.code-review-agent']
    });

    expect(plan.workflow).toBe('code-refactor');
    expect(plan.presentation.language).toBe('zh-CN');
    expect(plan.presentation.summary).toContain('代码重构');
    expect(plan.machine.nextActions).toEqual(
      expect.arrayContaining([
        {
          id: 'use-fallback-context7-docs-lookup',
          type: 'use-fallback',
          capabilityId: 'context7.docs-lookup',
          requiresApproval: true,
          riskLevel: 'low'
        },
        {
          id: 'run-code-review',
          type: 'invoke-capability',
          capabilityId: 'everything-claude-code.code-review-agent',
          requiresApproval: false,
          riskLevel: 'low'
        }
      ])
    );
    expect(plan.machine.nextActions.at(-1)).toMatchObject({
      id: 'run-code-review',
      type: 'invoke-capability',
      capabilityId: 'everything-claude-code.code-review-agent'
    });
  });

  test('includes explicit fallback for missing docs lookup capability', () => {
    const plan = createRecommendationPlan({
      workflow: 'code-refactor',
      language: 'zh-CN',
      installedCapabilityIds: []
    });

    const docsAvailability = plan.availability.find((item) => item.capabilityId === 'context7.docs-lookup');

    expect(docsAvailability?.status).toBe('installable');
    expect(docsAvailability?.fallback.mode).toBe('manual-docs-input');
    expect(plan.presentation.warnings.join('\n')).toContain('缺少');
  });

  test('uses docs lookup as the first machine action for product refactor', () => {
    const plan = createRecommendationPlan({
      workflow: 'product-refactor',
      installedCapabilityIds: ['context7.docs-lookup']
    });

    expect(plan.machine.nextActions[0]).toMatchObject({
      id: 'lookup-docs',
      type: 'invoke-capability',
      capabilityId: 'context7.docs-lookup'
    });
    expect(plan.machine.nextActions[0]?.capabilityId).not.toBe('everything-claude-code.code-review-agent');
  });

  test('uses docs lookup as the first machine action for frontend design', () => {
    const plan = createRecommendationPlan({
      workflow: 'frontend-design',
      installedCapabilityIds: ['context7.docs-lookup']
    });

    expect(plan.machine.nextActions[0]).toMatchObject({
      id: 'lookup-docs',
      type: 'invoke-capability',
      capabilityId: 'context7.docs-lookup'
    });
    expect(plan.machine.nextActions[0]?.capabilityId).not.toBe('everything-claude-code.code-review-agent');
  });

  test('uses fallback as the first machine action for code refactor when review agent is not installed', () => {
    const plan = createRecommendationPlan({
      workflow: 'code-refactor',
      installedCapabilityIds: []
    });

    expect(plan.machine.nextActions[0]).toMatchObject({
      type: 'use-fallback',
      capabilityId: 'everything-claude-code.code-review-agent',
      requiresApproval: true
    });
  });

  test('uses fallback as the first machine action for product refactor when docs lookup is not installed', () => {
    const plan = createRecommendationPlan({
      workflow: 'product-refactor',
      installedCapabilityIds: []
    });

    expect(plan.machine.nextActions[0]).toMatchObject({
      type: 'use-fallback',
      capabilityId: 'context7.docs-lookup',
      requiresApproval: true
    });
  });

  test('uses fallback as the first machine action for frontend design when docs lookup is not installed', () => {
    const plan = createRecommendationPlan({
      workflow: 'frontend-design',
      installedCapabilityIds: []
    });

    expect(plan.machine.nextActions[0]).toMatchObject({
      type: 'use-fallback',
      capabilityId: 'context7.docs-lookup',
      requiresApproval: true
    });
  });
});
