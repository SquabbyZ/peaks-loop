// tests/unit/services/batch/batch-fix.test.ts
//
// The fix phase's DISPATCH contract: who gets dispatched, with what, and
// under which rid.
//
// THE CLAIMS ARE ABOUT THE AGENTS, NOT ABOUT THE FILES. Three things must be
// true of every fix sub-agent, and none of them is visible from the result
// of the fix:
//
//   - it carries ITS OWN item's diagnosis, and nothing about the other
//     items. A fix agent that sees the whole batch's diagnoses re-reads the
//     repository to work out which diagnosis is its own — which is exactly
//     the re-read the design forbids.
//   - it carries a rid no other concurrent agent carries, because the
//     worktree branch name is derived from the rid and a duplicate rid makes
//     `git worktree add -b` fail.
//   - it carries the rule list that applies to the files it is about to
//     touch, and the shared governance prefix.
//
// The agents are fakes here: the dispatch is injected, so no sub-agent is
// spawned and no worktree is created.
//
// Dimensions covered:
//   - behavior:    the per-agent dispatch contract (own diagnosis, own rid,
//                  the rule list, the governance prefix)
//   - integration: the wave plan decides who runs together
//   - a11y:        an item with no diagnosis is named, not silently dropped
// Omitted:
//   - render:      no output is rendered — the prompt is the artifact, and it
//                  is asserted as a string

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  runBatchFix,
  type BatchFixAgentSpec,
  type BatchFixDependencies,
  type BatchFixDiagnosis
} from '../../../../src/services/batch/batch-fix.js';
import type { BatchItem } from '../../../../src/services/batch/batch-progress-types.js';

const SESSION_ID = '2026-10-21-session-cccccc';
const BATCH_ID = 'b1';
const RID = '2026-10-21-race-batch-mode-t3';
const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-batch-fix-'));
  roots.push(root);
  return root;
}

function item(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    id: 'i1',
    label: 'bug A',
    status: 'diagnosed',
    files: ['src/a.ts'],
    ...overrides
  };
}

function diagnosis(overrides: Partial<BatchFixDiagnosis> = {}): BatchFixDiagnosis {
  return {
    rootCause: 'the alpha branch returns before the beta write',
    files: ['src/a.ts'],
    riskSurface: 2,
    fixSketch: 'move the beta write above the early return',
    ...overrides
  };
}

/** A dispatch seam that records what it was asked to dispatch. */
function recordingDispatch(): {
  readonly specs: BatchFixAgentSpec[];
  readonly deps: BatchFixDependencies;
} {
  const specs: BatchFixAgentSpec[] = [];
  return {
    specs,
    deps: {
      dispatchFixAgent: (spec) => {
        specs.push(spec);
        return { ok: true, summary: `fixed ${spec.itemId}` };
      },
      runScopedTest: () => ({ ok: true, command: 'vitest run <scoped>' })
    }
  };
}

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('Scenario: behavior — each fix agent gets only its own diagnosis', () => {
  it("when two items are fixed, should give each agent its own item's diagnosis", async () => {
    // given: two diagnosed items, each with its own root cause
    const root = makeRoot();
    const { specs, deps } = recordingDispatch();
    const items = [item({ id: 'i1', label: 'bug A' }), item({ id: 'i2', label: 'bug B' })];
    const diagnoses = {
      i1: diagnosis({ rootCause: 'alpha root cause', files: ['src/a.ts'] }),
      i2: diagnosis({ rootCause: 'beta root cause', files: ['src/b.ts'] })
    };
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses,
        rules: []
      },
      deps
    );
    // then: each agent's prompt carries ITS OWN root cause
    const first = specs.find((spec) => spec.itemId === 'i1');
    const second = specs.find((spec) => spec.itemId === 'i2');
    expect(first?.prompt).toContain('alpha root cause');
    expect(second?.prompt).toContain('beta root cause');
  });

  it("when two items are fixed, should keep the other item's diagnosis out of an agent's prompt", async () => {
    // given: two diagnosed items, each with its own root cause
    const root = makeRoot();
    const { specs, deps } = recordingDispatch();
    const items = [item({ id: 'i1', label: 'bug A' }), item({ id: 'i2', label: 'bug B' })];
    const diagnoses = {
      i1: diagnosis({ rootCause: 'alpha root cause', files: ['src/a.ts'] }),
      i2: diagnosis({ rootCause: 'beta root cause', files: ['src/b.ts'] })
    };
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses,
        rules: []
      },
      deps
    );
    // then: neither prompt carries the other item's diagnosis
    const first = specs.find((spec) => spec.itemId === 'i1');
    const second = specs.find((spec) => spec.itemId === 'i2');
    expect(first?.prompt).not.toContain('beta root cause');
    expect(second?.prompt).not.toContain('alpha root cause');
  });

  it("when the batch carries a rule list, should put the rules into every agent's prompt", async () => {
    // given: a batch whose files are governed by two rules
    const root = makeRoot();
    const { specs, deps } = recordingDispatch();
    const items = [item({ id: 'i1' }), item({ id: 'i2' })];
    const diagnoses = { i1: diagnosis(), i2: diagnosis({ files: ['src/b.ts'] }) };
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses,
        rules: ['no `any` in src/', 'every file path is POSIX']
      },
      deps
    );
    // then: every agent's prompt carries both rules
    expect(specs).toHaveLength(2);
    for (const spec of specs) {
      expect(spec.prompt).toContain('no `any` in src/');
      expect(spec.prompt).toContain('every file path is POSIX');
    }
  });

  it('when a fix agent is dispatched, should carry the shared dispatch governance prefix', async () => {
    // given: one diagnosed item
    const root = makeRoot();
    const { specs, deps } = recordingDispatch();
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items: [item()],
        diagnoses: { i1: diagnosis() },
        rules: []
      },
      deps
    );
    // then: the prompt carries the one composer's governance blocks
    const prompt = specs[0]?.prompt ?? '';
    expect(prompt).toContain('## Superpowers chain refusal');
    expect(prompt).toContain('## Read before you edit (Fact-Forcing Gate)');
    expect(prompt).toContain('## Final report cap (mandatory)');
  });
});

describe('Scenario: behavior — concurrent fix agents have distinct rids', () => {
  it('when two items share a wave, should dispatch them under different rids', async () => {
    // given: two items whose file sets do not collide, so they share a wave
    const root = makeRoot();
    const { specs, deps } = recordingDispatch();
    const items = [
      item({ id: 'i1', files: ['src/a.ts'] }),
      item({ id: 'i2', files: ['src/b.ts'] })
    ];
    const diagnoses = { i1: diagnosis(), i2: diagnosis({ files: ['src/b.ts'] }) };
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses,
        rules: []
      },
      deps
    );
    // then: the two rids differ, so their worktree branches do not collide
    const rids = specs.map((spec) => spec.rid);
    expect(new Set(rids).size).toBe(2);
  });

  it('when two item ids differ only in characters a rid cannot carry, should still give them different rids', async () => {
    // given: two items whose ids collapse to the same rid characters
    const root = makeRoot();
    const { specs, deps } = recordingDispatch();
    const items = [
      item({ id: 'a/b', files: ['src/a.ts'] }),
      item({ id: 'a-b', files: ['src/b.ts'] })
    ];
    const diagnoses = { 'a/b': diagnosis(), 'a-b': diagnosis({ files: ['src/b.ts'] }) };
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses,
        rules: []
      },
      deps
    );
    // then: the rids are still two, not one
    const rids = specs.map((spec) => spec.rid);
    expect(rids).toHaveLength(2);
    expect(new Set(rids).size).toBe(2);
  });

  it("when an agent is dispatched, should name the batch's rid and the item it owns", async () => {
    // given: one diagnosed item
    const root = makeRoot();
    const { specs, deps } = recordingDispatch();
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items: [item()],
        diagnoses: { i1: diagnosis() },
        rules: []
      },
      deps
    );
    // then: the rid carries the batch's rid and the item's id
    const spec = specs[0];
    expect(spec?.rid.startsWith(RID)).toBe(true);
    expect(spec?.rid).toContain('i1');
    expect(spec?.itemId).toBe('i1');
    expect(spec?.role).toBe('rd');
  });

  it('when an agent is dispatched, should carry the three values one worktree spawn needs', async () => {
    // given: one diagnosed item
    const root = makeRoot();
    const { specs, deps } = recordingDispatch();
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items: [item()],
        diagnoses: { i1: diagnosis() },
        rules: []
      },
      deps
    );
    // then: the spec names the rid, the role and the purpose of the spawn
    const spec = specs[0];
    expect(spec?.rid).toBeTypeOf('string');
    expect(spec?.role).toBe('rd');
    expect(spec?.purpose).toContain('i1');
  });
});

describe('Scenario: integration — the wave plan decides who runs together', () => {
  it('when two items touch different files, should put them in the same wave', async () => {
    // given: two items with disjoint file sets
    const root = makeRoot();
    const { specs, deps } = recordingDispatch();
    const items = [
      item({ id: 'i1', files: ['src/a.ts'] }),
      item({ id: 'i2', files: ['src/b.ts'] })
    ];
    const diagnoses = { i1: diagnosis(), i2: diagnosis({ files: ['src/b.ts'] }) };
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses,
        rules: []
      },
      deps
    );
    // then: both agents are in wave 0
    const waves = specs.map((spec) => spec.waveIndex);
    expect(waves).toEqual([0, 0]);
  });

  it('when two items touch the same file, should put them in different waves', async () => {
    // given: two items that both touch the SAME file
    const root = makeRoot();
    const { specs, deps } = recordingDispatch();
    const items = [
      item({ id: 'i1', files: ['src/a.ts'] }),
      item({ id: 'i2', files: ['src/a.ts'] })
    ];
    const diagnoses = { i1: diagnosis(), i2: diagnosis() };
    // when: the batch is fixed
    await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses,
        rules: []
      },
      deps
    );
    // then: the second item is deferred into a later wave
    const waves = specs.map((spec) => spec.waveIndex);
    expect(waves).toEqual([0, 1]);
  });
});

describe('Scenario: a11y — an item with no diagnosis is named, not silently dropped', () => {
  it('when an item carries no diagnosis, should report it instead of dispatching an agent for it', async () => {
    // given: one diagnosed item and one with no recorded diagnosis
    const root = makeRoot();
    const { specs, deps } = recordingDispatch();
    const items = [item({ id: 'i1' }), item({ id: 'i2' })];
    // when: the batch is fixed
    const result = await runBatchFix(
      {
        projectRoot: root,
        sessionId: SESSION_ID,
        batchId: BATCH_ID,
        rid: RID,
        items,
        diagnoses: { i1: diagnosis() },
        rules: []
      },
      deps
    );
    // then: the item with no diagnosis is named, and no agent was dispatched for it
    expect(result.undiagnosable).toEqual(['i2']);
    expect(specs.map((spec) => spec.itemId)).toEqual(['i1']);
  });
});
