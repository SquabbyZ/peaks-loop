// tests/unit/services/dispatch/file-overlap-wave-planner.test.ts
//
// Slice 2026-09-10-dispatch-token-and-swarm §3 — file-overlap-aware waves.
//
// Contract:
//   - disjoint slices → ONE wave,
//   - overlapping slices → ordered waves, and the deferral names the
//     colliding file + the slice that already holds it,
//   - empty / duplicate inputs are handled without throwing.
//
// Dimensions covered:
//   - behavior: wave assignment + deferral reasons
//   - render: the plan envelope shape
//   - a11y: omitted (no user-visible text or exit code in the pure planner)
//   - integration: omitted (pure function, no fs)

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/dispatch/file-overlap-wave-planner.test.ts',
  ['behavior', 'render'],
  [
    { dim: 'a11y', reason: 'pure planner, no user-visible text or exit code' },
    { dim: 'integration', reason: 'pure function, no fs / subprocess boundary' },
  ],
);

import {
  planFileOverlapWaves,
  type SliceFileDescriptor,
} from '~/src/services/dispatch/file-overlap-wave-planner';

const SHARED = 'src/cli/commands/code-runtime-commands.ts';

describe('Scenario: behavior — wave assignment', () => {
  it('when all slices are file-disjoint, should emit a single wave', () => {
    // given: three slices with pairwise-disjoint file sets
    const slices: SliceFileDescriptor[] = [
      { id: 's1', files: ['src/a.ts'] },
      { id: 's2', files: ['src/b.ts'] },
      { id: 's3', files: ['src/c.ts'] },
    ];
    // when:  the planner runs
    const plan = planFileOverlapWaves(slices);
    // then:  everything is parallel
    expect(plan.waves).toHaveLength(1);
    expect(plan.waves[0]?.slices).toEqual(['s1', 's2', 's3']);
    expect(plan.waves[0]?.deferred).toEqual([]);
  });

  it('when two slices touch the same file, should defer the later one and name the colliding file', () => {
    // given: the observed 2026-09-07 collision — two slices editing the same CLI file
    const slices: SliceFileDescriptor[] = [
      { id: 'slice-a', files: [SHARED, 'src/a.ts'] },
      { id: 'slice-b', files: [SHARED, 'src/b.ts'] },
      { id: 'slice-c', files: ['src/c.ts'] },
    ];
    // when:  the planner runs
    const plan = planFileOverlapWaves(slices);
    // then:  a+c share wave 0, b is deferred to wave 1 with the file named
    expect(plan.waves).toHaveLength(2);
    expect(plan.waves[0]?.slices).toEqual(['slice-a', 'slice-c']);
    expect(plan.waves[1]?.slices).toEqual(['slice-b']);
    const deferral = plan.waves[1]?.deferred[0];
    expect(deferral?.id).toBe('slice-b');
    expect(deferral?.collidingFile).toBe(SHARED);
    expect(deferral?.collidedWith).toBe('slice-a');
    expect(deferral?.waveIndex).toBe(1);
    expect(deferral?.reason).toContain(SHARED);
    expect(deferral?.reason).toContain('slice-a');
  });

  it('when three slices chain on one file, should emit three ordered waves', () => {
    // given: three slices all touching the same file
    const slices: SliceFileDescriptor[] = [
      { id: 's1', files: [SHARED] },
      { id: 's2', files: [SHARED] },
      { id: 's3', files: [SHARED] },
    ];
    // when:  the planner runs
    const plan = planFileOverlapWaves(slices);
    // then:  they serialize into one wave each, in input order
    expect(plan.waves.map((w) => w.slices)).toEqual([['s1'], ['s2'], ['s3']]);
    expect(plan.waves[1]?.deferred[0]?.collidedWith).toBe('s1');
    expect(plan.waves[2]?.deferred[0]?.collidedWith).toBe('s1');
  });

  it('when a slice declares no files, should never collide', () => {
    // given: a slice with an empty file list and one with a file
    const plan = planFileOverlapWaves([
      { id: 'no-files', files: [] },
      { id: 'with-file', files: ['src/a.ts'] },
    ]);
    // when:  the planner runs
    // then:  both land in wave 0
    expect(plan.waves).toHaveLength(1);
    expect(plan.waves[0]?.slices).toEqual(['no-files', 'with-file']);
  });

  it('when the input is empty, should return an empty plan without throwing', () => {
    // given: no slices
    const plan = planFileOverlapWaves([]);
    // when:  the planner runs
    // then:  the plan is empty and well-shaped
    expect(plan.waves).toEqual([]);
    expect(plan.sliceCount).toBe(0);
    expect(plan.duplicateIds).toEqual([]);
  });

  it('when slice ids are duplicated, should schedule the first and report the rest', () => {
    // given: the same id twice with different files
    const plan = planFileOverlapWaves([
      { id: 's1', files: ['src/a.ts'] },
      { id: 's1', files: ['src/b.ts'] },
    ]);
    // when:  the planner runs
    // then:  the first descriptor wins and the duplicate is reported
    expect(plan.duplicateIds).toEqual(['s1']);
    expect(plan.sliceCount).toBe(1);
    expect(plan.waves[0]?.slices).toEqual(['s1']);
    expect(plan.waves[0]?.files).toEqual(['src/a.ts']);
  });

  it('when the same input is planned twice, should be deterministic', () => {
    // given: a realistic mixed input
    const slices: SliceFileDescriptor[] = [
      { id: 's1', files: ['src/a.ts', 'src/shared.ts'] },
      { id: 's2', files: ['src/shared.ts'] },
      { id: 's3', files: ['src/b.ts'] },
    ];
    // when:  the planner runs twice
    // then:  the plans are deep-equal
    expect(planFileOverlapWaves(slices)).toEqual(planFileOverlapWaves(slices));
  });
});

describe('Scenario: render — plan envelope shape', () => {
  it('when a wave is emitted, should expose waveIndex, slices, files and deferred', () => {
    // given: two colliding slices
    const plan = planFileOverlapWaves([
      { id: 's1', files: ['src/a.ts'] },
      { id: 's2', files: ['src/a.ts'] },
    ]);
    // when:  the first wave is inspected
    const wave = plan.waves[0];
    // then:  every field is present and typed
    expect(wave?.waveIndex).toBe(0);
    expect(wave?.slices).toEqual(['s1']);
    expect(wave?.files).toEqual(['src/a.ts']);
    expect(Array.isArray(wave?.deferred)).toBe(true);
    expect(plan.sliceCount).toBe(2);
  });

  it('when a wave holds several files, should expose them sorted', () => {
    // given: one slice declaring files out of order
    const plan = planFileOverlapWaves([{ id: 's1', files: ['src/z.ts', 'src/a.ts'] }]);
    // when:  the wave files are read
    // then:  they are sorted for byte-stable envelopes
    expect(plan.waves[0]?.files).toEqual(['src/a.ts', 'src/z.ts']);
  });
});
