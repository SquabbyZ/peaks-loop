// tests/unit/services/workflow/pipeline-verify-contract-drift-backcompat.test.ts
//
// The S3 back-compat arm of the pipeline checker: a missing artifact whose
// `backCompat` window is still open must soft-pass instead of failing a slice
// that already reached `rd:qa-handoff` before the prerequisite existed.
//
// The shared on-disk fixtures live in `_contract-drift-fixtures.ts`, the same
// module `pipeline-verify-contract-drift.test.ts` reads. Dimension `render` is
// omitted: no output is rendered here; the assertions read the service envelope.
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { verifyPipeline } from '../../../../src/services/workflow/pipeline-verify-service.js';
import {
  CURRENT_CONTRACT_EVIDENCE,
  RID,
  SESSION_ID,
  seedSlice
} from './_contract-drift-fixtures.js';

declareDimensions(
  'tests/unit/services/workflow/pipeline-verify-contract-drift-backcompat.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'no output is rendered; the service envelope is asserted' }]
);

const ws = withTmpWorkspacePerTest('peaks-pipeline-backcompat-');

async function verifyWithMissingDesign() {
  await seedSlice(ws(), CURRENT_CONTRACT_EVIDENCE);
  rmSync(join(ws().path, '.peaks', '_runtime', SESSION_ID, 'design', `check-${RID}.md`));
  return verifyPipeline({ projectRoot: ws().path, rid: RID, sessionId: SESSION_ID });
}

describe('Scenario: behavior — an in-window missing artifact does not fail the slice', () => {
  it('when in-window design evidence is missing, should complete with the window named', async () => {
    // given: a slice satisfying every other prerequisite, and the design file removed
    // when: the checker runs while the design back-compat window is still open
    // then: the gate soft-passes naming the window and the pipeline completes
    const result = await verifyWithMissingDesign();

    const design = result.rdPhase.gates.find((g) => g.name === 'design-conformance');
    expect(design?.passed).toBe(true);
    expect(design?.detail).toBe('missing (back-compat until v4.4.0)');
    expect(result.violations).toEqual([]);
    expect(result.complete).toBe(true);
  });
});

describe('Scenario: integration — the arm runs on the same tree the other tests seed', () => {
  it('when the design file is removed, should resolve the rest of the canonical evidence', async () => {
    // given: the seeded session tree with only the design artifact deleted
    // when: the on-disk tree is inspected
    // then: the design artifact is gone while the rest of the contract is present
    await seedSlice(ws(), CURRENT_CONTRACT_EVIDENCE);
    rmSync(join(ws().path, '.peaks', '_runtime', SESSION_ID, 'design', `check-${RID}.md`));
    const sessionDir = join(ws().path, '.peaks', '_runtime', SESSION_ID);
    expect(existsSync(join(sessionDir, 'design', `check-${RID}.md`))).toBe(false);
    expect(existsSync(join(sessionDir, 'rd', 'code-review.md'))).toBe(true);
    expect(existsSync(join(sessionDir, 'audit', 'security.md'))).toBe(true);
  });
});

describe('Scenario: a11y — the next action names the release and the owed artifact', () => {
  it('when the window soft-passes, should still ask for the artifact before v4.4.0', async () => {
    // given: a soft-passing in-window design artifact
    // when: the checker's human-facing next actions are read
    // then: one names the closing release and the path a human must create
    const result = await verifyWithMissingDesign();

    expect(result.nextActions.some((action) => action.includes('v4.4.0'))).toBe(true);
    expect(result.nextActions.some((action) => action.includes(`design/check-${RID}.md`))).toBe(
      true
    );
  });
});
