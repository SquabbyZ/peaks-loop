# Peaks Capability Recommendation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first stable foundation for Peaks recommendations: capability source/item contracts, availability records, localized recommendation plans, and a dry-run CLI command.

**Architecture:** Keep Peaks CLI-first and schema-first. Add focused schemas and TypeScript services under `src/services/recommendations/`, reuse the existing CLI result envelope, and make missing capabilities a normal output state with explicit fallback. Do not install external skills, mutate remote state, start a service, or implement swarm in this phase.

**Tech Stack:** TypeScript, Node 20+, Commander, Vitest, JSON Schema draft 2020-12.

---

## File Structure

Create focused files rather than growing `src/cli/program.ts`.

- Create `schemas/capability-source.schema.json` — validates external source records such as repos, skills.sh packages, MCP collections, and local installs.
- Create `schemas/capability-item.schema.json` — validates concrete capability items extracted from sources.
- Create `schemas/capability-availability.schema.json` — validates available/missing/installable/disabled/unknown runtime capability status.
- Create `schemas/recommendation-plan.schema.json` — validates machine and presentation layers for recommendations.
- Create `src/services/recommendations/recommendation-types.ts` — TypeScript types shared by recommendation services.
- Create `src/services/recommendations/seed-capability-catalog.ts` — hand-curated seed sources and items from `docs/accessRepo.md` and `docs/mcpServer.md`.
- Create `src/services/recommendations/capability-availability.ts` — local resolver for skill availability and placeholder MCP availability.
- Create `src/services/recommendations/recommendation-service.ts` — builds recommendation plans for known workflows.
- Modify `src/shared/paths.ts` — add new schema filenames to `requiredSchemaFiles`.
- Modify `src/cli/program.ts` — add `peaks recommend --workflow <workflow> --language <language> --json` and `peaks capability status --json`.
- Create `tests/unit/recommendation-service.test.ts` — unit tests for recommendation output.
- Create `tests/unit/capability-availability.test.ts` — unit tests for availability resolution.
- Modify `tests/unit/doctor.test.ts` — ensure doctor validates new schemas.
- Modify `tests/unit/cli-program.test.ts` — CLI envelope tests for new commands.

Do not create install/apply commands in this plan.

---

### Task 1: Add schema files for recommendation foundation

**Files:**
- Create: `schemas/capability-source.schema.json`
- Create: `schemas/capability-item.schema.json`
- Create: `schemas/capability-availability.schema.json`
- Create: `schemas/recommendation-plan.schema.json`
- Modify: `src/shared/paths.ts`
- Test: `tests/unit/doctor.test.ts`

- [ ] **Step 1: Write failing doctor test for new schemas**

Add this test to `tests/unit/doctor.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { runDoctor } from '../../src/services/doctor/doctor-service.js';

describe('runDoctor recommendation schemas', () => {
  test('validates recommendation foundation schemas', async () => {
    const report = await runDoctor();
    const schemaIds = report.checks.map((check) => check.id);

    expect(schemaIds).toContain('schema:capability-source.schema.json');
    expect(schemaIds).toContain('schema:capability-item.schema.json');
    expect(schemaIds).toContain('schema:capability-availability.schema.json');
    expect(schemaIds).toContain('schema:recommendation-plan.schema.json');
  });
});
```

If `tests/unit/doctor.test.ts` already imports `describe`, `expect`, or `test`, merge the imports rather than duplicating them.

- [ ] **Step 2: Run the failing doctor test**

Run:

```bash
pnpm vitest run tests/unit/doctor.test.ts
```

Expected: FAIL because the new schema files are not yet listed in `requiredSchemaFiles` or do not exist.

- [ ] **Step 3: Create `capability-source.schema.json`**

Create `schemas/capability-source.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Peaks Capability Source",
  "type": "object",
  "required": ["sourceId", "sourceType", "title", "url", "discoveryStatus", "items"],
  "properties": {
    "sourceId": { "type": "string" },
    "sourceType": {
      "type": "string",
      "enum": ["repo", "skills-package", "mcp-collection", "website", "local-install"]
    },
    "title": { "type": "string" },
    "url": { "type": "string" },
    "trustSignals": {
      "type": "object",
      "properties": {
        "sourceReputation": { "type": "string" },
        "stars": { "type": "number" },
        "installs": { "type": "number" },
        "maintainer": { "type": "string" },
        "notes": { "type": "array", "items": { "type": "string" } }
      }
    },
    "discoveryStatus": {
      "type": "string",
      "enum": ["unscanned", "indexed", "verified", "deprecated"]
    },
    "items": { "type": "array", "items": { "type": "string" } }
  }
}
```

- [ ] **Step 4: Create `capability-item.schema.json`**

Create `schemas/capability-item.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Peaks Capability Item",
  "type": "object",
  "required": ["capabilityId", "sourceId", "itemType", "category", "workflows", "riskLevel", "fallback"],
  "properties": {
    "capabilityId": { "type": "string" },
    "sourceId": { "type": "string" },
    "name": { "type": "string" },
    "itemType": {
      "type": "string",
      "enum": ["skill", "agent", "mcp", "rule", "hook", "template", "workflow", "doc", "cli"]
    },
    "category": { "type": "string" },
    "workflows": { "type": "array", "items": { "type": "string" } },
    "audience": { "type": "array", "items": { "type": "string" } },
    "riskLevel": { "type": "string", "enum": ["low", "medium", "high"] },
    "inputContract": { "type": "string" },
    "outputContract": { "type": "string" },
    "fallback": {
      "type": "object",
      "required": ["mode", "qualityImpact"],
      "properties": {
        "mode": { "type": "string" },
        "qualityImpact": { "type": "string" },
        "nextAction": { "type": "string" }
      }
    },
    "presentation": {
      "type": "object",
      "properties": {
        "displayName": { "type": "object" },
        "description": { "type": "object" }
      }
    }
  }
}
```

- [ ] **Step 5: Create `capability-availability.schema.json`**

Create `schemas/capability-availability.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Peaks Capability Availability",
  "type": "object",
  "required": ["capabilityId", "type", "status", "requiredFor", "fallback"],
  "properties": {
    "capabilityId": { "type": "string" },
    "type": {
      "type": "string",
      "enum": ["skill", "mcp", "cli", "agent", "profile"]
    },
    "status": {
      "type": "string",
      "enum": ["available", "missing", "installable", "disabled", "unknown"]
    },
    "requiredFor": { "type": "array", "items": { "type": "string" } },
    "installPlan": {
      "type": "object",
      "properties": {
        "available": { "type": "boolean" },
        "commandPreview": { "type": "string" },
        "requiresApproval": { "type": "boolean" }
      }
    },
    "fallback": {
      "type": "object",
      "required": ["mode", "qualityImpact"],
      "properties": {
        "mode": { "type": "string" },
        "qualityImpact": { "type": "string" },
        "nextAction": { "type": "string" }
      }
    },
    "risk": { "type": "string", "enum": ["low", "medium", "high"] }
  }
}
```

- [ ] **Step 6: Create `recommendation-plan.schema.json`**

Create `schemas/recommendation-plan.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Peaks Recommendation Plan",
  "type": "object",
  "required": ["intent", "workflow", "profile", "audience", "options", "requiredCapabilities", "availability", "decisionRequired", "machine", "presentation"],
  "properties": {
    "intent": { "type": "string" },
    "workflow": { "type": "string" },
    "profile": { "type": "string" },
    "audience": { "type": "string" },
    "options": { "type": "array" },
    "requiredCapabilities": { "type": "array", "items": { "type": "string" } },
    "availability": { "type": "array" },
    "fallbacks": { "type": "array" },
    "decisionRequired": { "type": "boolean" },
    "machine": {
      "type": "object",
      "required": ["nextActions"],
      "properties": {
        "nextActions": { "type": "array" },
        "constraints": { "type": "array" },
        "stopConditions": { "type": "array" }
      }
    },
    "presentation": {
      "type": "object",
      "required": ["language", "summary", "options"],
      "properties": {
        "language": { "type": "string" },
        "summary": { "type": "string" },
        "options": { "type": "array" },
        "warnings": { "type": "array" },
        "explanations": { "type": "array" }
      }
    }
  }
}
```

- [ ] **Step 7: Register schemas in `src/shared/paths.ts`**

Modify `requiredSchemaFiles` in `src/shared/paths.ts` so it becomes:

```ts
export const requiredSchemaFiles = [
  'artifact-manifest.schema.json',
  'context-capsule.schema.json',
  'approval-record.schema.json',
  'change-impact.schema.json',
  'refactor-slice-spec.schema.json',
  'artifact-retention-report.schema.json',
  'capability-source.schema.json',
  'capability-item.schema.json',
  'capability-availability.schema.json',
  'recommendation-plan.schema.json'
] as const;
```

- [ ] **Step 8: Run doctor test**

Run:

```bash
pnpm vitest run tests/unit/doctor.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add schemas/capability-source.schema.json schemas/capability-item.schema.json schemas/capability-availability.schema.json schemas/recommendation-plan.schema.json src/shared/paths.ts tests/unit/doctor.test.ts
git commit -m "feat: add capability recommendation schemas"
```

---

### Task 2: Add recommendation types and seed capability catalog

**Files:**
- Create: `src/services/recommendations/recommendation-types.ts`
- Create: `src/services/recommendations/seed-capability-catalog.ts`
- Test: `tests/unit/recommendation-service.test.ts`

- [ ] **Step 1: Write failing catalog test**

Create `tests/unit/recommendation-service.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
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

  test('models MCP collections as sources and concrete MCPs as items', () => {
    const source = seedCapabilitySources.find((candidate) => candidate.sourceId === 'modelcontextprotocol-servers');
    const context7 = seedCapabilityItems.find((candidate) => candidate.capabilityId === 'context7.docs-lookup');

    expect(source?.sourceType).toBe('mcp-collection');
    expect(context7?.itemType).toBe('mcp');
    expect(context7?.workflows).toContain('code-refactor');
  });
});
```

- [ ] **Step 2: Run failing catalog test**

Run:

```bash
pnpm vitest run tests/unit/recommendation-service.test.ts
```

Expected: FAIL because recommendation catalog files do not exist.

- [ ] **Step 3: Add recommendation types**

Create `src/services/recommendations/recommendation-types.ts`:

```ts
export type CapabilitySourceType = 'repo' | 'skills-package' | 'mcp-collection' | 'website' | 'local-install';
export type CapabilityItemType = 'skill' | 'agent' | 'mcp' | 'rule' | 'hook' | 'template' | 'workflow' | 'doc' | 'cli';
export type CapabilityAvailabilityStatus = 'available' | 'missing' | 'installable' | 'disabled' | 'unknown';
export type RiskLevel = 'low' | 'medium' | 'high';

export type LocalizedText = Record<string, string>;

export type CapabilityFallback = {
  mode: string;
  qualityImpact: string;
  nextAction?: string;
};

export type CapabilitySource = {
  sourceId: string;
  sourceType: CapabilitySourceType;
  title: string;
  url: string;
  trustSignals?: {
    sourceReputation?: string;
    stars?: number;
    installs?: number;
    maintainer?: string;
    notes?: string[];
  };
  discoveryStatus: 'unscanned' | 'indexed' | 'verified' | 'deprecated';
  items: string[];
};

export type CapabilityItem = {
  capabilityId: string;
  sourceId: string;
  name: string;
  itemType: CapabilityItemType;
  category: string;
  workflows: string[];
  audience: string[];
  riskLevel: RiskLevel;
  inputContract?: string;
  outputContract?: string;
  fallback: CapabilityFallback;
  presentation: {
    displayName: LocalizedText;
    description: LocalizedText;
  };
};

export type CapabilityAvailability = {
  capabilityId: string;
  type: 'skill' | 'mcp' | 'cli' | 'agent' | 'profile';
  status: CapabilityAvailabilityStatus;
  requiredFor: string[];
  installPlan?: {
    available: boolean;
    commandPreview?: string;
    requiresApproval: boolean;
  };
  fallback: CapabilityFallback;
  risk: RiskLevel;
};

export type RecommendationOption = {
  id: string;
  label: string;
  why: string;
  requiredCapabilities: string[];
  fallbackPath?: string;
};

export type RecommendationPlan = {
  intent: string;
  workflow: string;
  profile: string;
  audience: string;
  options: RecommendationOption[];
  requiredCapabilities: string[];
  availability: CapabilityAvailability[];
  fallbacks: CapabilityFallback[];
  decisionRequired: boolean;
  machine: {
    nextActions: Array<{
      id: string;
      type: string;
      capabilityId?: string;
      requiresApproval: boolean;
      riskLevel: RiskLevel;
    }>;
    constraints: string[];
    stopConditions: string[];
  };
  presentation: {
    language: string;
    summary: string;
    options: Array<{
      id: string;
      label: string;
      why: string;
    }>;
    warnings: string[];
    explanations: string[];
  };
};
```

- [ ] **Step 4: Add seed capability catalog**

Create `src/services/recommendations/seed-capability-catalog.ts`:

```ts
import type { CapabilityItem, CapabilitySource } from './recommendation-types.js';

export const seedCapabilitySources: CapabilitySource[] = [
  {
    sourceId: 'everything-claude-code',
    sourceType: 'repo',
    title: 'everything-claude-code',
    url: 'https://github.com/affaan-m/everything-claude-code',
    trustSignals: {
      sourceReputation: 'hackathon-winning Claude Code resource collection',
      notes: ['Treat as a source bundle; deep indexing is required before broad automatic use.']
    },
    discoveryStatus: 'indexed',
    items: ['everything-claude-code.code-review-agent', 'everything-claude-code.security-review-agent']
  },
  {
    sourceId: 'context7',
    sourceType: 'repo',
    title: 'Context7',
    url: 'https://github.com/upstash/context7',
    trustSignals: {
      sourceReputation: 'commonly used docs lookup MCP capability'
    },
    discoveryStatus: 'indexed',
    items: ['context7.docs-lookup']
  },
  {
    sourceId: 'modelcontextprotocol-servers',
    sourceType: 'mcp-collection',
    title: 'Model Context Protocol Servers',
    url: 'https://github.com/modelcontextprotocol/servers',
    trustSignals: {
      sourceReputation: 'official MCP server collection'
    },
    discoveryStatus: 'unscanned',
    items: []
  }
];

export const seedCapabilityItems: CapabilityItem[] = [
  {
    capabilityId: 'everything-claude-code.code-review-agent',
    sourceId: 'everything-claude-code',
    name: 'Code Review Agent',
    itemType: 'agent',
    category: 'code-review',
    workflows: ['code-refactor', 'development-complete'],
    audience: ['engineer'],
    riskLevel: 'low',
    inputContract: 'git-diff or changed-file summary',
    outputContract: 'review-report',
    fallback: {
      mode: 'built-in-review-checklist',
      qualityImpact: 'lower',
      nextAction: 'Use Peaks built-in code review checklist if the external agent is unavailable.'
    },
    presentation: {
      displayName: {
        en: 'Code Review Agent',
        'zh-CN': '代码评审代理'
      },
      description: {
        en: 'Reviews code changes for quality, maintainability, tests, and risks.',
        'zh-CN': '用于在代码改动后检查质量、可维护性、测试和风险。'
      }
    }
  },
  {
    capabilityId: 'everything-claude-code.security-review-agent',
    sourceId: 'everything-claude-code',
    name: 'Security Review Agent',
    itemType: 'agent',
    category: 'security-review',
    workflows: ['code-refactor', 'development-complete'],
    audience: ['engineer'],
    riskLevel: 'medium',
    inputContract: 'git-diff or changed-file summary',
    outputContract: 'security-review-report',
    fallback: {
      mode: 'built-in-security-checklist',
      qualityImpact: 'lower',
      nextAction: 'Use Peaks built-in security checklist if the external agent is unavailable.'
    },
    presentation: {
      displayName: {
        en: 'Security Review Agent',
        'zh-CN': '安全评审代理'
      },
      description: {
        en: 'Checks auth, user input, filesystem, external calls, and secret-handling risks.',
        'zh-CN': '检查认证、用户输入、文件系统、外部调用和密钥处理风险。'
      }
    }
  },
  {
    capabilityId: 'context7.docs-lookup',
    sourceId: 'context7',
    name: 'Context7 Docs Lookup',
    itemType: 'mcp',
    category: 'docs-lookup',
    workflows: ['code-refactor', 'product-refactor', 'frontend-design'],
    audience: ['engineer', 'product'],
    riskLevel: 'low',
    inputContract: 'library or API documentation request',
    outputContract: 'documentation-summary',
    fallback: {
      mode: 'manual-docs-input',
      qualityImpact: 'lower',
      nextAction: 'Ask the user to provide the relevant documentation link or pasted excerpt.'
    },
    presentation: {
      displayName: {
        en: 'Documentation Lookup',
        'zh-CN': '文档查询能力'
      },
      description: {
        en: 'Fetches current library and API documentation for implementation planning.',
        'zh-CN': '用于获取当前库和 API 文档，辅助实现规划。'
      }
    }
  }
];
```

- [ ] **Step 5: Run catalog test**

Run:

```bash
pnpm vitest run tests/unit/recommendation-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/services/recommendations/recommendation-types.ts src/services/recommendations/seed-capability-catalog.ts tests/unit/recommendation-service.test.ts
git commit -m "feat: add seed capability catalog"
```

---

### Task 3: Add local capability availability resolver

**Files:**
- Create: `src/services/recommendations/capability-availability.ts`
- Test: `tests/unit/capability-availability.test.ts`

- [ ] **Step 1: Write failing availability tests**

Create `tests/unit/capability-availability.test.ts`:

```ts
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

  test('marks missing MCP capabilities as installable with fallback', () => {
    const availability = resolveCapabilityAvailability([docsLookup], {
      installedCapabilityIds: []
    });

    expect(availability[0]).toMatchObject({
      capabilityId: 'context7.docs-lookup',
      status: 'installable',
      type: 'mcp',
      fallback: {
        mode: 'manual-docs-input'
      }
    });
    expect(availability[0]?.installPlan?.requiresApproval).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing availability tests**

Run:

```bash
pnpm vitest run tests/unit/capability-availability.test.ts
```

Expected: FAIL because `capability-availability.ts` does not exist.

- [ ] **Step 3: Implement availability resolver**

Create `src/services/recommendations/capability-availability.ts`:

```ts
import type { CapabilityAvailability, CapabilityItem } from './recommendation-types.js';

export type CapabilityAvailabilityOptions = {
  installedCapabilityIds?: string[];
};

function getAvailabilityType(item: CapabilityItem): CapabilityAvailability['type'] {
  if (item.itemType === 'mcp') {
    return 'mcp';
  }

  if (item.itemType === 'agent') {
    return 'agent';
  }

  if (item.itemType === 'cli') {
    return 'cli';
  }

  return 'skill';
}

function getMissingStatus(item: CapabilityItem): CapabilityAvailability['status'] {
  if (item.itemType === 'mcp' || item.itemType === 'skill' || item.itemType === 'agent') {
    return 'installable';
  }

  return 'unknown';
}

export function resolveCapabilityAvailability(
  items: CapabilityItem[],
  options: CapabilityAvailabilityOptions = {}
): CapabilityAvailability[] {
  const installedCapabilityIds = new Set(options.installedCapabilityIds ?? []);

  return items.map((item) => {
    const isInstalled = installedCapabilityIds.has(item.capabilityId);
    const status = isInstalled ? 'available' : getMissingStatus(item);

    return {
      capabilityId: item.capabilityId,
      type: getAvailabilityType(item),
      status,
      requiredFor: item.workflows,
      installPlan: isInstalled
        ? undefined
        : {
            available: status === 'installable',
            commandPreview: `peaks capability install-plan ${item.capabilityId} --json`,
            requiresApproval: true
          },
      fallback: item.fallback,
      risk: item.riskLevel
    };
  });
}
```

- [ ] **Step 4: Run availability tests**

Run:

```bash
pnpm vitest run tests/unit/capability-availability.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/services/recommendations/capability-availability.ts tests/unit/capability-availability.test.ts
git commit -m "feat: resolve capability availability"
```

---

### Task 4: Build recommendation service

**Files:**
- Create: `src/services/recommendations/recommendation-service.ts`
- Modify: `tests/unit/recommendation-service.test.ts`

- [ ] **Step 1: Add failing recommendation tests**

Append to `tests/unit/recommendation-service.test.ts`:

```ts
import { createRecommendationPlan } from '../../src/services/recommendations/recommendation-service.js';

describe('createRecommendationPlan', () => {
  test('creates localized code-refactor recommendations with stable machine actions', () => {
    const plan = createRecommendationPlan({
      workflow: 'code-refactor',
      language: 'zh-CN',
      installedCapabilityIds: ['everything-claude-code.code-review-agent']
    });

    expect(plan.workflow).toBe('code-refactor');
    expect(plan.presentation.language).toBe('zh-CN');
    expect(plan.presentation.summary).toContain('代码重构');
    expect(plan.machine.nextActions[0]).toMatchObject({
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
});
```

- [ ] **Step 2: Run failing recommendation tests**

Run:

```bash
pnpm vitest run tests/unit/recommendation-service.test.ts
```

Expected: FAIL because `recommendation-service.ts` does not exist.

- [ ] **Step 3: Implement recommendation service**

Create `src/services/recommendations/recommendation-service.ts`:

```ts
import { resolveCapabilityAvailability } from './capability-availability.js';
import { seedCapabilityItems } from './seed-capability-catalog.js';
import type { CapabilityItem, RecommendationPlan } from './recommendation-types.js';

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

export function createRecommendationPlan(options: CreateRecommendationPlanOptions): RecommendationPlan {
  const language = options.language ?? 'en';
  const workflowItems = getWorkflowItems(options.workflow);
  const availability = resolveCapabilityAvailability(workflowItems, {
    installedCapabilityIds: options.installedCapabilityIds
  });
  const missingCapabilities = availability.filter((item) => item.status !== 'available');
  const requiredCapabilities = workflowItems.map((item) => item.capabilityId);

  return {
    intent: options.workflow,
    workflow: options.workflow,
    profile: 'solo-guided-auto',
    audience: 'engineer',
    options: [
      {
        id: 'recommended-foundation-route',
        label: 'foundation-route',
        why: 'Use available capabilities and expose missing ones before execution.',
        requiredCapabilities,
        fallbackPath: missingCapabilities.length > 0 ? 'explicit-fallback' : undefined
      }
    ],
    requiredCapabilities,
    availability,
    fallbacks: missingCapabilities.map((item) => item.fallback),
    decisionRequired: missingCapabilities.length > 0,
    machine: {
      nextActions: [
        {
          id: 'run-code-review',
          type: 'invoke-capability',
          capabilityId: 'everything-claude-code.code-review-agent',
          requiresApproval: false,
          riskLevel: 'low'
        }
      ],
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
```

- [ ] **Step 4: Run recommendation tests**

Run:

```bash
pnpm vitest run tests/unit/recommendation-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/services/recommendations/recommendation-service.ts tests/unit/recommendation-service.test.ts
git commit -m "feat: create recommendation plans"
```

---

### Task 5: Add CLI commands for recommendations and capability status

**Files:**
- Modify: `src/cli/program.ts`
- Modify: `tests/unit/cli-program.test.ts`

- [ ] **Step 1: Add failing CLI tests**

Append to `tests/unit/cli-program.test.ts`:

```ts
test('prints recommendation plan as JSON envelope', async () => {
  const result = await runCommand(['recommend', '--workflow', 'code-refactor', '--language', 'zh-CN', '--json']);
  const output = parseJsonOutput(result.stdout);

  expect(output.ok).toBe(true);
  expect(output.command).toBe('recommend');
  expect(JSON.stringify(output.data)).toContain('code-refactor');
  expect(JSON.stringify(output.data)).toContain('zh-CN');
});

test('rejects unsupported recommendation workflow', async () => {
  const result = await runCommand(['recommend', '--workflow', 'unknown', '--json']);
  const output = parseJsonOutput(result.stdout);

  expect(output.ok).toBe(false);
  expect(output.code).toBe('UNSUPPORTED_RECOMMENDATION_WORKFLOW');
});

test('prints capability status as JSON envelope', async () => {
  const result = await runCommand(['capability', 'status', '--json']);
  const output = parseJsonOutput(result.stdout);

  expect(output.ok).toBe(true);
  expect(output.command).toBe('capability.status');
  expect(JSON.stringify(output.data)).toContain('everything-claude-code.code-review-agent');
});
```

- [ ] **Step 2: Run failing CLI tests**

Run:

```bash
pnpm vitest run tests/unit/cli-program.test.ts
```

Expected: FAIL because commands do not exist.

- [ ] **Step 3: Wire imports in `src/cli/program.ts`**

Add imports near existing service imports:

```ts
import { resolveCapabilityAvailability } from '../services/recommendations/capability-availability.js';
import { createRecommendationPlan, type RecommendationWorkflow } from '../services/recommendations/recommendation-service.js';
import { seedCapabilityItems } from '../services/recommendations/seed-capability-catalog.js';
```

- [ ] **Step 4: Add workflow guard helper in `src/cli/program.ts`**

Add this near `failUnsupportedNonDryRun`:

```ts
function isRecommendationWorkflow(value: string): value is RecommendationWorkflow {
  return value === 'code-refactor' || value === 'product-refactor' || value === 'frontend-design';
}
```

- [ ] **Step 5: Add `recommend` command in `src/cli/program.ts`**

Add this before the final `return program;`:

```ts
addJsonOption(
  program
    .command('recommend')
    .description('Create a dry-run recommendation plan for a workflow')
    .requiredOption('--workflow <workflow>', 'workflow: code-refactor, product-refactor, or frontend-design')
    .option('--language <language>', 'human presentation language', 'en')
).action((options: { workflow: string; language: string; json?: boolean }) => {
  if (!isRecommendationWorkflow(options.workflow)) {
    printResult(
      io,
      fail(
        'recommend',
        'UNSUPPORTED_RECOMMENDATION_WORKFLOW',
        `Unsupported recommendation workflow ${options.workflow}`,
        {},
        ['Use --workflow code-refactor, product-refactor, or frontend-design']
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  printResult(
    io,
    ok('recommend', createRecommendationPlan({ workflow: options.workflow, language: options.language })),
    options.json
  );
});
```

- [ ] **Step 6: Add `capability status` command in `src/cli/program.ts`**

Add this before the final `return program;`:

```ts
const capability = program.command('capability').description('Inspect Peaks capability catalog and runtime availability');
addJsonOption(capability.command('status').description('Show seed capability availability')).action((options: { json?: boolean }) => {
  const availability = resolveCapabilityAvailability(seedCapabilityItems);
  printResult(io, ok('capability.status', { sources: [], items: seedCapabilityItems, availability }), options.json);
});
```

- [ ] **Step 7: Run CLI tests**

Run:

```bash
pnpm vitest run tests/unit/cli-program.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

```bash
git add src/cli/program.ts tests/unit/cli-program.test.ts
git commit -m "feat: add recommendation CLI commands"
```

---

### Task 6: Run full validation and tighten output

**Files:**
- Modify only files touched in earlier tasks if tests reveal issues.

- [ ] **Step 1: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run unit tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run coverage**

Run:

```bash
pnpm test:coverage
```

Expected: PASS with existing thresholds.

- [ ] **Step 4: Run CLI smoke checks**

Run:

```bash
node bin/peaks.js doctor --json
node bin/peaks.js recommend --workflow code-refactor --language zh-CN --json
node bin/peaks.js capability status --json
```

Expected: all commands return JSON envelopes with `ok: true`.

- [ ] **Step 5: Inspect JSON output for core acceptance**

Confirm the recommendation output includes:

```text
workflow: code-refactor
profile: solo-guided-auto
machine.nextActions
presentation.language: zh-CN
availability entries
fallbacks for missing capabilities
```

- [ ] **Step 6: Commit Task 6 fixes if any**

If validation required fixes:

```bash
git add schemas/capability-source.schema.json schemas/capability-item.schema.json schemas/capability-availability.schema.json schemas/recommendation-plan.schema.json src/shared/paths.ts src/services/recommendations/recommendation-types.ts src/services/recommendations/seed-capability-catalog.ts src/services/recommendations/capability-availability.ts src/services/recommendations/recommendation-service.ts src/cli/program.ts tests/unit/doctor.test.ts tests/unit/recommendation-service.test.ts tests/unit/capability-availability.test.ts tests/unit/cli-program.test.ts
git commit -m "fix: stabilize recommendation output"
```

If no files changed, do not create an empty commit.

---

## NOT in scope

- Automatic install or enable of external skills or MCPs.
- Deep scanning `everything-claude-code` or other external repos.
- Git-backed artifact workspace commands.
- `peaks serve` long-running service mode.
- Desktop UI or visual editor.
- Multi-repo config implementation.
- Real swarm execution.
- Product refactor end-to-end workflow.
- Model capability profile execution routing.

---

## What already exists and will be reused

- `src/cli/program.ts` already wires Commander commands and prints JSON envelopes.
- `src/shared/result.ts` already defines success/failure result envelopes.
- `src/services/doctor/doctor-service.ts` already validates required schemas.
- `src/services/skills/skill-registry.ts` already parses local skill metadata.
- `schemas/*.json` already establish artifact-schema conventions.
- `tests/unit/cli-program.test.ts` already tests CLI JSON envelopes.
- `tests/unit/doctor.test.ts` already tests doctor behavior.

---

## Parallelization strategy

Sequential implementation is recommended for this first foundation. The tasks intentionally build on each other:

```text
Schemas
  -> Types + seed catalog
  -> Availability resolver
  -> Recommendation service
  -> CLI commands
  -> Full validation
```

Do not parallelize Tasks 1-5 unless using separate worktrees with careful merge order. The files and types are tightly coupled.

---

## Spec coverage self-review

- Capability source vs item distinction: covered by Tasks 1-2.
- RecommendationPlan contract: covered by Tasks 1 and 4.
- CapabilityAvailability contract: covered by Tasks 1 and 3.
- Missing capability fallback: covered by Tasks 3-4.
- Localized presentation layer: covered by Task 4.
- Stable machine layer: covered by Task 4.
- CLI-first JSON surface: covered by Task 5.
- No install/remote mutation: covered by NOT in scope and CLI command design.
- Multi-model/swarm future support: reserved in spec, intentionally deferred.

No placeholders remain in this plan.
