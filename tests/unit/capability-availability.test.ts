import { describe, expect, test } from 'vitest';
import { resolveCapabilityAvailability } from '../../src/services/recommendations/capability-availability.js';
import type { CapabilityItem } from '../../src/services/recommendations/recommendation-types.js';

const codeReviewAgent: CapabilityItem = {
  capabilityId: 'everything-claude-code.code-review-agent',
  sourceId: 'everything-claude-code',
  name: 'Code Review Agent',
  itemType: 'agent',
  category: 'code-review',
  workflows: ['code-refactor'],
  audience: ['engineer'],
  riskLevel: 'low',
  fallback: {
    mode: 'built-in-review-checklist',
    qualityImpact: 'lower'
  },
  presentation: {
    displayName: { en: 'Code Review Agent', 'zh-CN': '代码评审代理' },
    description: { en: 'Reviews changes.', 'zh-CN': '检查代码改动。' }
  }
};

const docsLookup: CapabilityItem = {
  capabilityId: 'context7.docs-lookup',
  sourceId: 'context7',
  name: 'Context7 Docs Lookup',
  itemType: 'mcp',
  category: 'docs-lookup',
  workflows: ['code-refactor'],
  audience: ['engineer'],
  riskLevel: 'low',
  fallback: {
    mode: 'manual-docs-input',
    qualityImpact: 'lower'
  },
  presentation: {
    displayName: { en: 'Documentation Lookup', 'zh-CN': '文档查询能力' },
    description: { en: 'Looks up docs.', 'zh-CN': '查询文档。' }
  }
};

const cliCapability: CapabilityItem = {
  capabilityId: 'some-cli-tool',
  sourceId: 'some-source',
  name: 'Some CLI Tool',
  itemType: 'cli',
  category: 'tooling',
  workflows: ['code-refactor'],
  audience: ['engineer'],
  riskLevel: 'low',
  fallback: {
    mode: 'manual-execution',
    qualityImpact: 'lower'
  },
  presentation: {
    displayName: { en: 'Some CLI Tool', 'zh-CN': '某 CLI 工具' },
    description: { en: 'A CLI tool.', 'zh-CN': '一个 CLI 工具。' }
  }
};

const skillCapability: CapabilityItem = {
  capabilityId: 'some-skill',
  sourceId: 'some-source',
  name: 'Some Skill',
  itemType: 'skill',
  category: 'tooling',
  workflows: ['code-refactor'],
  audience: ['engineer'],
  riskLevel: 'low',
  fallback: {
    mode: 'manual-execution',
    qualityImpact: 'lower'
  },
  presentation: {
    displayName: { en: 'Some Skill', 'zh-CN': '某技能' },
    description: { en: 'A skill.', 'zh-CN': '一个技能。' }
  }
};

describe('resolveCapabilityAvailability', () => {
  test('marks locally installed capabilities as available', () => {
    const availability = resolveCapabilityAvailability([codeReviewAgent], {
      installedCapabilityIds: ['everything-claude-code.code-review-agent']
    });

    expect(availability[0]).toMatchObject({
      capabilityId: 'everything-claude-code.code-review-agent',
      status: 'available',
      type: 'agent'
    });
  });

  test('marks missing MCP capabilities as installable with fallback and approval-only install plan', () => {
    const availability = resolveCapabilityAvailability([docsLookup], {
      installedCapabilityIds: []
    });

    expect(availability[0]).toMatchObject({
      capabilityId: 'context7.docs-lookup',
      status: 'installable',
      type: 'mcp',
      fallback: {
        mode: 'manual-docs-input'
      },
      installPlan: {
        available: true,
        requiresApproval: true
      }
    });
    expect(availability[0]?.installPlan).not.toHaveProperty('commandPreview');
  });

  test('marks missing CLI capabilities as unknown status', () => {
    const availability = resolveCapabilityAvailability([cliCapability], {
      installedCapabilityIds: []
    });

    expect(availability[0]).toMatchObject({
      capabilityId: 'some-cli-tool',
      status: 'unknown',
      type: 'cli',
      installPlan: {
        available: false,
        requiresApproval: true
      }
    });
  });

  test('marks missing skill capabilities as installable', () => {
    const availability = resolveCapabilityAvailability([skillCapability], {
      installedCapabilityIds: []
    });

    expect(availability[0]).toMatchObject({
      capabilityId: 'some-skill',
      status: 'installable',
      type: 'skill'
    });
    expect(availability[0]?.installPlan).toBeDefined();
    expect(availability[0]?.installPlan?.available).toBe(true);
  });

  test('handles multiple items with mixed availability', () => {
    const availability = resolveCapabilityAvailability(
      [codeReviewAgent, docsLookup, cliCapability],
      { installedCapabilityIds: ['everything-claude-code.code-review-agent'] }
    );

    expect(availability).toHaveLength(3);
    expect(availability[0]?.status).toBe('available');
    expect(availability[1]?.status).toBe('installable');
    expect(availability[2]?.status).toBe('unknown');
  });
});
