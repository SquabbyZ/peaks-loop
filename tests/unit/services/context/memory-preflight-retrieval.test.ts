// tests/unit/services/context/memory-preflight-retrieval.test.ts
//
// Slice 2026-09-09-memory-retrieval: task-relevant selection + tiered budget
// for the orchestrator memory preflight.
//
// Dimensions (per tests/unit/_setup/4dim-template.ts):
//   - behavior:    ranking, tier gating, budget enforcement, fail-soft
//   - integration: real fs boundary (.peaks/memory/index.json fixtures)
//   - render:      emitted block shape (header / entry lines / path)
//   - a11y:        machine-readable `reason` codes + counts for a thin/rich block

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  MemoryPreflightService,
  deriveMemoryQuery,
} from '~/src/services/context/memory-preflight-service';

declareDimensions(
  'tests/unit/services/context/memory-preflight-retrieval.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
);

type Entry = {
  name: string;
  kind: string;
  description: string;
  sourcePath: string;
  sourceArtifact: null;
  updatedAt: string;
};

function entry(name: string, kind: string, description: string): Entry {
  return {
    name,
    kind,
    description,
    sourcePath: `/mem/${name}.md`,
    sourceArtifact: null,
    updatedAt: '2026-09-09',
  };
}

/** Write a synthetic `.peaks/memory/index.json` under a temp project root. */
function withIndex(
  index: Record<string, unknown>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'mem-preflight-'));
  const dir = join(root, '.peaks', 'memory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
  return run(root).finally(() => rmSync(root, { recursive: true, force: true }));
}

const HOT_FEEDBACK = entry(
  'release-lockstep-rule',
  'feedback',
  '<!-- peaks-feedback-promoted: layer=A --> peaks-loop and shared must bump in lockstep',
);
const HOT_RULE = entry(
  'naming-convention-rule',
  'rule',
  'always prefix services with the owning domain',
);
const WARM_RETRIEVAL = entry(
  'memory-retrieval-budget',
  'project',
  'memory retrieval tiered budget design',
);
const WARM_MEMO = entry('memory-memo', 'project', 'memo about retrieval');
const WARM_DOCKER = entry(
  'docker-notes',
  'reference',
  'docker container isolation lease notes',
);

const BASE_INDEX = {
  hot: { feedback: [HOT_FEEDBACK], rule: [HOT_RULE] },
  warm: { project: [WARM_RETRIEVAL, WARM_MEMO, WARM_DOCKER] },
};

describe('Scenario: behavior — task-relevant selection', () => {
  it('when two task titles are ranked over one index, should select different task-matched entries', async () => {
    await withIndex(BASE_INDEX, async (root) => {
      const service = new MemoryPreflightService(root, {
        memoryPreflight: { selectionTimeBudgetMs: 1000 },
      });
      const retrieval = await service.fetchBlock('memory retrieval tiered budget');
      const docker = await service.fetchBlock('docker container isolation lease');

      expect(retrieval.available).toBe(true);
      expect(docker.available).toBe(true);
      expect(retrieval.block).toContain('memory-retrieval-budget');
      expect(docker.block).toContain('docker-notes');
      expect(retrieval.block).not.toBe(docker.block);
      // Hot is always eligible: the standing rule rides along in both.
      expect(retrieval.block).toContain('release-lockstep-rule');
      expect(docker.block).toContain('release-lockstep-rule');
    });
  });

  it('when the task does not match any warm entry, should fall back to hot-only (non-empty)', async () => {
    await withIndex(BASE_INDEX, async (root) => {
      const service = new MemoryPreflightService(root, {
        memoryPreflight: { selectionTimeBudgetMs: 1000 },
      });
      const result = await service.fetchBlock('quantum chromodynamics lattice');
      expect(result.available).toBe(true);
      expect(result.hotSelected).toBe(2);
      expect(result.warmSelected).toBe(0);
      expect(result.block).toContain('release-lockstep-rule');
    });
  });

  it('when a warm entry matches fewer task tokens than the gate, should drop it', async () => {
    await withIndex(BASE_INDEX, async (root) => {
      // `memory tiered` hits WARM_RETRIEVAL on 2 tokens (memory, tiered)
      // and WARM_MEMO on 1 (memory). A gate of 2 keeps the stronger match.
      const service = new MemoryPreflightService(root, {
        memoryPreflight: {
          selectionTimeBudgetMs: 1000,
          warmMinTokenHits: 2,
        },
      });
      const result = await service.fetchBlock('memory tiered');
      expect(result.warmSelected).toBe(1);
      expect(result.block).toContain('memory-retrieval-budget');
      expect(result.block).not.toContain('memory-memo');
    });
  });

  it('when several warm entries match, should rank the stronger match first', async () => {
    await withIndex(BASE_INDEX, async (root) => {
      const service = new MemoryPreflightService(root, {
        memoryPreflight: { selectionTimeBudgetMs: 1000, warmItemCap: 1 },
      });
      const result = await service.fetchBlock('memory retrieval tiered budget');
      expect(result.warmSelected).toBe(1);
      expect(result.block).toContain('memory-retrieval-budget');
      expect(result.block).not.toContain('memory-memo');
    });
  });

  it('when the warm item cap is smaller than the match set, should enforce the cap', async () => {
    const warm = Array.from({ length: 6 }, (_, i) =>
      entry(`budget-memo-${i}`, 'project', `budget tiering memo number ${i}`),
    );
    await withIndex(
      { hot: { feedback: [HOT_FEEDBACK] }, warm: { project: warm } },
      async (root) => {
        const service = new MemoryPreflightService(root, {
          memoryPreflight: {
            selectionTimeBudgetMs: 1000,
            warmItemCap: 2,
          },
        });
        const result = await service.fetchBlock('budget tiering memo');
        expect(result.warmSelected).toBe(2);
        expect(result.hotSelected).toBe(1);
        expect(result.budgetTruncated).toBe(true);
        expect(result.droppedCount).toBe(4);
      },
    );
  });
});

describe('Scenario: behavior — three independent budgets', () => {
  const manyHot = Array.from({ length: 5 }, (_, i) =>
    entry(`hot-rule-${i}`, 'rule', `standing rule number ${i}`),
  );
  const MANY_INDEX = {
    hot: { rule: manyHot },
    warm: { project: [WARM_RETRIEVAL] },
  };

  it('when the hot item cap is exceeded, should truncate by items and report it', async () => {
    await withIndex(MANY_INDEX, async (root) => {
      const service = new MemoryPreflightService(root, {
        memoryPreflight: {
          hotItemCap: 1,
          maxBytes: 100_000,
          selectionTimeBudgetMs: 1000,
        },
      });
      const result = await service.fetchBlock('standing rule');
      expect(result.hotSelected).toBe(1);
      expect(result.budgetTruncated).toBe(true);
      expect(result.droppedCount).toBe(4);
    });
  });

  it('when the byte cap is exceeded, should truncate by bytes and report it', async () => {
    await withIndex(MANY_INDEX, async (root) => {
      const service = new MemoryPreflightService(root, {
        memoryPreflight: {
          hotItemCap: 50,
          maxBytes: 200,
          selectionTimeBudgetMs: 1000,
        },
      });
      const result = await service.fetchBlock('standing rule');
      expect(result.truncated).toBe(true);
      expect(result.budgetTruncated).toBe(true);
      expect(result.bytesEmitted).toBeLessThanOrEqual(200);
    });
  });

  it('when the selection time budget is exhausted, should degrade to hot-only and report it', async () => {
    await withIndex(BASE_INDEX, async (root) => {
      const service = new MemoryPreflightService(root, {
        memoryPreflight: { selectionTimeBudgetMs: 0, maxBytes: 100_000 },
      });
      const result = await service.fetchBlock('memory retrieval');
      expect(result.available).toBe(true);
      expect(result.timedOut).toBe(true);
      expect(result.warmSelected).toBe(0);
      expect(result.hotSelected).toBe(2);
      expect(result.budgetTruncated).toBe(true);
    });
  });
});

describe('Scenario: behavior — fail-soft', () => {
  it('when the memory index is missing, should return unavailable without throwing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mem-preflight-'));
    try {
      const service = new MemoryPreflightService(root, { memoryPreflight: {} });
      const result = await service.fetchBlock('anything');
      expect(result.available).toBe(false);
      expect(result.reason).toBe('MEMORY_INDEX_MISSING');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('when the memory index is malformed, should return unavailable without throwing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mem-preflight-'));
    try {
      const dir = join(root, '.peaks', 'memory');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.json'), '{ not json');
      const service = new MemoryPreflightService(root, { memoryPreflight: {} });
      const result = await service.fetchBlock('anything');
      expect(result.available).toBe(false);
      expect(result.reason).toBe('MEMORY_INDEX_MISSING');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('when the index has no entries, should return unavailable with a reason', async () => {
    await withIndex({ hot: {}, warm: {} }, async (root) => {
      const service = new MemoryPreflightService(root, { memoryPreflight: {} });
      const result = await service.fetchBlock('anything');
      expect(result.available).toBe(false);
      expect(result.reason).toBe('NO_RELEVANT_MEMORY');
    });
  });
});

describe('Scenario: behavior — back-compat config keys', () => {
  it('when only maxTokens is set, should honor it as the byte cap', async () => {
    const warm = Array.from({ length: 5 }, (_, i) =>
      entry(`long-memo-${i}`, 'project', `budget tiering memo ${i} `.repeat(6)),
    );
    await withIndex(
      { hot: { rule: [HOT_RULE] }, warm: { project: warm } },
      async (root) => {
        const service = new MemoryPreflightService(root, {
          // 100 tokens -> 400 bytes. No maxBytes key present.
          memoryPreflight: { maxTokens: 100, selectionTimeBudgetMs: 1000 },
        });
        const result = await service.fetchBlock('budget tiering memo');
        expect(result.truncated).toBe(true);
        expect(result.bytesEmitted).toBeLessThanOrEqual(400);
      },
    );
  });

  it('when only listCap is set, should honor it as the hot item cap', async () => {
    const manyHot = Array.from({ length: 5 }, (_, i) =>
      entry(`hot-rule-${i}`, 'rule', `standing rule number ${i}`),
    );
    await withIndex({ hot: { rule: manyHot } }, async (root) => {
      const service = new MemoryPreflightService(root, {
        memoryPreflight: {
          listCap: 2,
          maxBytes: 100_000,
          selectionTimeBudgetMs: 1000,
        },
      });
      const result = await service.fetchBlock('standing rule');
      expect(result.hotSelected).toBe(2);
    });
  });
});

describe('Scenario: render — compact index shape', () => {
  it('when a warm entry is selected, should emit name + path + one-line only (no body by default)', async () => {
    await withIndex(BASE_INDEX, async (root) => {
      const service = new MemoryPreflightService(root, {
        memoryPreflight: { selectionTimeBudgetMs: 1000 },
      });
      service.cacheMemoContent('/mem/memory-retrieval-budget.md', 'SECRET BODY');
      const result = await service.fetchBlock('memory retrieval tiered budget');
      expect(result.block).toContain('## Project memory relevant to this task');
      expect(result.block).toContain('Path: /mem/memory-retrieval-budget.md');
      expect(result.block).toContain('One-line: memory retrieval tiered budget design');
      // Body inlining is gated off by default (bootstrap, then drill down).
      expect(result.block).not.toContain('SECRET BODY');
    });
  });

  it('when includeBodies is enabled, should inline cached memo bodies', async () => {
    await withIndex(BASE_INDEX, async (root) => {
      const service = new MemoryPreflightService(root, {
        memoryPreflight: { selectionTimeBudgetMs: 1000, includeBodies: true },
      });
      service.cacheMemoContent('/mem/memory-retrieval-budget.md', 'SECRET BODY');
      const result = await service.fetchBlock('memory retrieval tiered budget');
      expect(result.block).toContain('SECRET BODY');
      expect(result.cachedItemCount).toBe(1);
    });
  });
});

describe('Scenario: a11y — machine-readable observability', () => {
  it('when a rich block is emitted, should report hot/warm/byte counts', async () => {
    await withIndex(BASE_INDEX, async (root) => {
      const service = new MemoryPreflightService(root, {
        memoryPreflight: { selectionTimeBudgetMs: 1000 },
      });
      const result = await service.fetchBlock('memory retrieval tiered budget');
      expect(result.hotSelected).toBe(2);
      expect(result.warmSelected).toBeGreaterThanOrEqual(1);
      expect(result.feedbackListItems).toBe(
        (result.hotSelected ?? 0) + (result.warmSelected ?? 0),
      );
      expect(result.bytesEmitted).toBeGreaterThan(0);
      expect(result.budgetTruncated).toBe(false);
    });
  });

  it('when disabled, should report DISABLED without touching the index', async () => {
    await withIndex(BASE_INDEX, async (root) => {
      const service = new MemoryPreflightService(root, {
        memoryPreflight: { enabled: false },
      });
      const result = await service.fetchBlock('memory retrieval');
      expect(result.available).toBe(false);
      expect(result.reason).toBe('DISABLED');
    });
  });

  it('when deriving the dispatch query, should combine the role with the brief first line', () => {
    expect(deriveMemoryQuery('rd', 'memory retrieval tiering\nsecond line')).toBe(
      'rd memory retrieval tiering',
    );
    expect(deriveMemoryQuery('qa', '')).toBe('qa');
    expect(deriveMemoryQuery('rd', undefined)).toBe('rd');
  });
});
