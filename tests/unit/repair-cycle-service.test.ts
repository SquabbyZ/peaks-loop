import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../src/services/mode/mode-enforcement.js', () => ({
  requireUserConfirmation: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../src/services/artifacts/artifact-lint-service.js', () => ({
  lintRequestArtifact: vi.fn().mockResolvedValue(null)
}));

import {
  createRequestArtifact,
  transitionRequestArtifact
} from '../../src/services/artifacts/request-artifact-service.js';
import { getRepairCycleStatus } from '../../src/services/artifacts/repair-cycle-service.js';

const SESSION = '2026-05-25-repair';
const TS = '2026-05-25T08:00:00.000Z';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-repair-'));
}

// As of slice 2026-06-05-change-id-as-unit-of-work, the artifact file
// lives at `.peaks/_runtime/<sessionId>/<role>/requests/` where sessionId defaults
// to the requestId. Both getRepairCycleStatus and transitionRequestArtifact
// resolve via showRequestArtifact which scans all top-level dirs when
// sessionId is omitted.

describe('getRepairCycleStatus', () => {
  test('returns null when the RD artifact does not exist', async () => {
    const project = await makeProject();
    const report = await getRepairCycleStatus({ projectRoot: project, requestId: '2026-05-25-nope' });
    expect(report).toBeNull();
  });

  test('returns cycleCount=0 for a fresh artifact with no repair notes', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
      sessionId: SESSION, apply: true, requestType: 'docs', clock: () => TS
    });
    const report = await getRepairCycleStatus({ projectRoot: project, requestId: '2026-05-25-feat' });
    expect(report?.cycleCount).toBe(0);
    expect(report?.atCap).toBe(false);
    expect(report?.remaining).toBe(3);
  });

  test('counts distinct repair cycles from transition notes', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
      sessionId: SESSION, apply: true, requestType: 'docs', clock: () => TS
    });
    // Simulate 2 repair cycles by transitioning with QA-cycle reasons (docs has no gates).
    await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
      newState: 'spec-locked',
      allowIncomplete: true,
      reason: 'QA return-to-rd cycle 1: failing acceptance items A, B',
      clock: () => '2026-05-25T09:00:00.000Z'
    });
    await transitionRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
      newState: 'spec-locked',
      allowIncomplete: true,
      reason: 'QA cycle 2: regression in module X',
      clock: () => '2026-05-25T10:00:00.000Z'
    });
    const report = await getRepairCycleStatus({ projectRoot: project, requestId: '2026-05-25-feat' });
    expect(report?.cycleCount).toBe(2);
    expect(report?.entries.length).toBe(2);
    expect(report?.atCap).toBe(false);
    expect(report?.remaining).toBe(1);
  });

  test('flags atCap=true when cycle count meets the cap', async () => {
    const project = await makeProject();
    await createRequestArtifact({
      role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
      sessionId: SESSION, apply: true, requestType: 'docs', clock: () => TS
    });
    for (let cycle = 1; cycle <= 3; cycle += 1) {
      await transitionRequestArtifact({
        role: 'rd', requestId: '2026-05-25-feat', projectRoot: project,
        newState: 'spec-locked',
        allowIncomplete: true,
        reason: `QA return-to-rd cycle ${cycle}: still failing`,
        clock: () => `2026-05-25T0${8 + cycle}:00:00.000Z`
      });
    }
    const report = await getRepairCycleStatus({ projectRoot: project, requestId: '2026-05-25-feat' });
    expect(report?.cycleCount).toBe(3);
    expect(report?.atCap).toBe(true);
    expect(report?.blocked).toBe(true);
  });
});
