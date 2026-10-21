// tests/unit/services/batch/batch-diagnosis.test.ts
//
// Two claims are asserted here, and neither is a structural one:
//
//   - the topology planner measures the file set BEFORE it compares it. The
//     wave planner matches file paths by exact string equality, so a
//     backslash-spelled path and the same path spelled with forward slashes
//     name one file to a human and two files to the planner. Without the
//     normalization, two items that touch the SAME file look disjoint, land
//     in the same wave, and two agents edit one file at once. This is
//     asserted against the resulting wave plan, not against the normalizer's
//     return value alone.
//
//   - the diagnosis prompt is READ-ONLY. The file set the diagnostician
//     reports is the only input the topology step has, so a diagnostician
//     that also wrote files would be reporting a guess. The prompt forbids
//     Edit / Write / MultiEdit, and it asks for the four outputs the batch
//     pipeline consumes: the root cause, the files it expects to touch, the
//     risk surface it hit, and a fix sketch.
//
// Dimensions covered:
//   - behavior:    the wave plan the measured file sets produce, and the
//                  content of the diagnosis prompt
//   - integration: the prompt prefix — the composed prompt must actually
//                  carry the shared dispatch boilerplate, because a
//                  hand-rolled prefix is what this module exists to prevent
// Omitted:
//   - render:     no printed output originates here; the plan is data
//   - a11y:       the prompt is machine-consumed by a sub-agent, and the
//                 refusals it carries are the same refusals the shared
//                 dispatch composer already owns

import { describe, expect, it } from 'vitest';

import {
  buildDiagnosisPrompt,
  planBatchTopology
} from '../../../../src/services/batch/batch-diagnosis.js';
import type { BatchItem } from '../../../../src/services/batch/batch-progress-types.js';
import { buildDispatchSystemPrompt } from '../../../../src/services/context/build-dispatch-system-prompt.js';

function item(overrides: Partial<BatchItem> & { id: string }): BatchItem {
  return {
    label: 'bug',
    status: 'diagnosed',
    files: [],
    ...overrides
  };
}

describe('Scenario: behavior — the topology is planned from the measured file sets', () => {
  it('when two items touch disjoint files, should place them in the same wave', () => {
    // given: two independently diagnosed items that touch different files
    const items = [
      item({ id: 'i1', files: ['src/a.ts'] }),
      item({ id: 'i2', files: ['src/b.ts'] })
    ];
    // when: the topology is planned from their file sets
    const plan = planBatchTopology(items);
    // then: they may proceed together — no file is contended
    expect(plan.waves).toHaveLength(1);
    expect(plan.waves[0]?.slices).toEqual(['i1', 'i2']);
  });

  it('when two items touch the same file, should defer the second behind the first', () => {
    // given: two independently diagnosed items that touch ONE file
    const items = [
      item({ id: 'i1', files: ['src/a.ts'] }),
      item({ id: 'i2', files: ['src/a.ts'] })
    ];
    // when: the topology is planned from their file sets
    const plan = planBatchTopology(items);
    // then: they do not share a wave, and the deferral NAMES the file
    expect(plan.waves).toHaveLength(2);
    expect(plan.waves[1]?.deferred[0]?.collidingFile).toBe('src/a.ts');
  });

  it('when one item spells a file with a backslash and another with a slash, should treat them as the same file', () => {
    // given: the SAME file, measured two ways by two agents
    const items = [
      item({ id: 'i1', files: ['src\\a.ts'] }),
      item({ id: 'i2', files: ['src/a.ts'] })
    ];
    // when: the topology is planned from their file sets
    const plan = planBatchTopology(items);
    // then: they are NOT disjoint — otherwise two agents edit one file at once
    expect(plan.waves).toHaveLength(2);
    expect(plan.waves[1]?.deferred[0]?.collidingFile).toBe('src/a.ts');
  });

  it('when an item lists the same file twice in different spellings, should count it once', () => {
    // given: one item that names one file twice, measured two ways
    const items = [item({ id: 'i1', files: ['src/a.ts', 'src\\a.ts'] })];
    // when: the topology is planned from its file set
    const plan = planBatchTopology(items);
    // then: the file set is one file, so there is no contention to report
    expect(plan.waves).toHaveLength(1);
    expect(plan.waves[0]?.files).toEqual(['src/a.ts']);
    expect(plan.waves[0]?.deferred).toEqual([]);
  });
});

describe('Scenario: behavior — the diagnosis prompt is read-only and asks for four outputs', () => {
  it('when the prompt is built, should forbid Edit, Write and MultiEdit', () => {
    // given: one item to diagnose
    const itemToDiagnose = { id: 'i1', label: 'fix null check', symptom: 'x is null' };
    // when: the diagnosis prompt is built
    const prompt = buildDiagnosisPrompt(itemToDiagnose);
    // then: the diagnostician is told it may not write anything
    expect(prompt).toMatch(/MUST NOT[^\n]*(Edit|Write|MultiEdit)/);
    expect(prompt).toMatch(/read-only/i);
  });

  it('when the prompt is built, should ask for the root cause, the expected files, the risk surface and a fix sketch', () => {
    // given: one item to diagnose
    const itemToDiagnose = { id: 'i1', label: 'fix null check', symptom: 'x is null' };
    // when: the diagnosis prompt is built
    const prompt = buildDiagnosisPrompt(itemToDiagnose);
    // then: all four outputs the batch pipeline consumes are requested
    expect(prompt).toMatch(/root cause/i);
    expect(prompt).toMatch(/expected files/i);
    expect(prompt).toMatch(/risk surface/i);
    expect(prompt).toMatch(/fix sketch/i);
  });

  it('when the prompt is built, should carry the item under diagnosis', () => {
    // given: one item to diagnose
    const itemToDiagnose = { id: 'i1', label: 'fix null check', symptom: 'x is null' };
    // when: the diagnosis prompt is built
    const prompt = buildDiagnosisPrompt(itemToDiagnose);
    // then: the prompt names the item, so the answer is attributable
    expect(prompt).toContain('i1');
    expect(prompt).toContain('fix null check');
    expect(prompt).toContain('x is null');
  });
});

describe('Scenario: integration — the prompt carries the shared dispatch prefix', () => {
  it('when the diagnosis prompt is built, should carry the dispatch system prompt verbatim', () => {
    // given: the shared composer every dispatched sub-agent receives
    const shared = buildDispatchSystemPrompt({
      taskTitle: 'rd',
      taskBody: 'BODY_SENTINEL',
      memoryBlock: { available: false }
    });
    // when: the diagnosis prompt is built
    const prompt = buildDiagnosisPrompt({
      id: 'i1',
      label: 'fix null check',
      symptom: 'x is null'
    });
    // then: its prefix IS that composed prompt — not a hand-rolled copy
    expect(prompt.startsWith(shared.replace('BODY_SENTINEL', ''))).toBe(true);
  });
});
