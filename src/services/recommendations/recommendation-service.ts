import { resolveCapabilityAvailability } from './capability-availability.js';
import { seedCapabilityItems } from './seed-capability-catalog.js';
import type { CapabilityAvailability, CapabilityItem, RecommendationPlan } from './recommendation-types.js';

export type RecommendationWorkflow = 'code-refactor' | 'product-refactor' | 'frontend-design';

export type CreateRecommendationPlanOptions = {
  workflow: RecommendationWorkflow;
  language?: string;
  installedCapabilityIds?: string[];
};

function getWorkflowItems(workflow: RecommendationWorkflow): CapabilityItem[] {
  return seedCapabilityItems.filter((item) => item.workflows.includes(workflow));
}

function localize(language: string, zh: string, en: string): string {
  return language.startsWith('zh') ? zh : en;
}

function getWorkflowSummary(workflow: RecommendationWorkflow, language: string): string {
  if (workflow === 'code-refactor') {
    return localize(
      language,
      '建议先为代码重构准备代码评审和文档查询能力；缺失能力会以 fallback 方式显式展示。',
      'Prepare code review and documentation lookup capabilities for code refactor; missing capabilities are shown with explicit fallbacks.'
    );
  }

  if (workflow === 'product-refactor') {
    return localize(
      language,
      '建议先围绕产品理解成本、交互路径和验收标准生成推荐计划。',
      'Prepare a recommendation plan around product comprehension cost, interaction flow, and acceptance criteria.'
    );
  }

  return localize(
    language,
    '建议先准备前端设计、浏览器验证和文档查询能力。',
    'Prepare frontend design, browser validation, and documentation lookup capabilities.'
  );
}

function getPreferredCapabilityId(workflow: RecommendationWorkflow): string {
  if (workflow === 'code-refactor') {
    return 'everything-claude-code.code-review-agent';
  }

  return 'context7.docs-lookup';
}

function toFallbackActionId(capabilityId: string): string {
  return `use-fallback-${capabilityId.replaceAll('.', '-')}`;
}

function getNextActions(
  workflow: RecommendationWorkflow,
  availability: CapabilityAvailability[]
): RecommendationPlan['machine']['nextActions'] {
  const preferredCapabilityId = getPreferredCapabilityId(workflow);
  const preferredAvailability = availability.find((item) => item.capabilityId === preferredCapabilityId);
  const fallbackActions = availability
    .filter((item) => item.status !== 'available')
    .map((item) => ({
      id: toFallbackActionId(item.capabilityId),
      type: 'use-fallback' as const,
      capabilityId: item.capabilityId,
      requiresApproval: true,
      riskLevel: item.risk
    }));

  if (preferredAvailability?.status !== 'available') {
    return fallbackActions;
  }

  const invokeAction = workflow === 'code-refactor'
    ? {
        id: 'run-code-review',
        type: 'invoke-capability' as const,
        capabilityId: preferredCapabilityId,
        requiresApproval: false,
        riskLevel: preferredAvailability.risk
      }
    : {
        id: 'lookup-docs',
        type: 'invoke-capability' as const,
        capabilityId: preferredCapabilityId,
        requiresApproval: false,
        riskLevel: preferredAvailability.risk
      };

  return [...fallbackActions, invokeAction];
}

export function createRecommendationPlan(options: CreateRecommendationPlanOptions): RecommendationPlan {
  const language = options.language ?? 'en';
  const workflowItems = getWorkflowItems(options.workflow);
  const availabilityOptions = options.installedCapabilityIds
    ? { installedCapabilityIds: options.installedCapabilityIds }
    : {};
  const availability = resolveCapabilityAvailability(workflowItems, availabilityOptions);
  const missingCapabilities = availability.filter((item) => item.status !== 'available');
  const requiredCapabilities = workflowItems.map((item) => item.capabilityId);
  const recommendedOption = {
    id: 'recommended-foundation-route',
    label: 'foundation-route',
    why: 'Use available capabilities and expose missing ones before execution.',
    requiredCapabilities,
    ...(missingCapabilities.length > 0 ? { fallbackPath: 'explicit-fallback' } : {})
  };

  return {
    intent: options.workflow,
    workflow: options.workflow,
    profile: 'code-guided-auto',
    audience: ['engineer'],
    options: [recommendedOption],
    requiredCapabilities,
    availability,
    fallbacks: missingCapabilities.map((item) => item.fallback),
    decisionRequired: missingCapabilities.length > 0,
    machine: {
      nextActions: getNextActions(options.workflow, availability),
      constraints: ['do-not-install-capabilities', 'do-not-mutate-remote-state'],
      stopConditions: ['missing-required-capability-without-fallback']
    },
    presentation: {
      language,
      summary: getWorkflowSummary(options.workflow, language),
      options: [
        {
          id: 'recommended-foundation-route',
          label: localize(language, '使用推荐基础路线', 'Use recommended foundation route'),
          why: localize(
            language,
            '先检查能力是否可用，再决定执行或降级，避免模型发散。',
            'Check capability availability before execution or fallback to avoid model drift.'
          )
        }
      ],
      warnings: missingCapabilities.map((item) =>
        localize(language, `缺少能力：${item.capabilityId}，将使用 fallback。`, `Missing capability: ${item.capabilityId}; fallback will be used.`)
      ),
      explanations: [
        localize(
          language,
          '机器层保持稳定英文契约，给人看的摘要跟随当前语言。',
          'The machine layer keeps stable English contracts while human summaries follow the selected language.'
        )
      ]
    }
  };
}
