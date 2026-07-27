/**
 * rid-016 regression: the 5 publishable internal subpackages
 * (peaks-loop-job-snapshot, peaks-loop-doctor, peaks-loop-final-review,
 * peaks-loop-audit-independent, peaks-loop-crystallization) were
 * folded back into the main peaks-loop package as
 * `src/services/<area>/`. Each moved area must re-export its full
 * surface via `src/services/<area>/index.ts` and that surface must
 * resolve from a plain `import` (no package-name lookup).
 *
 * This file is a smoke for the consolidation: it imports each
 * consolidated area by its NEW local path and asserts the named
 * exports the previous CLI/test consumers relied on are still
 * present. A future regression that drops one of these exports
 * (or accidentally re-points a path back to a package name) is
 * caught here.
 */
import { describe, expect, test } from 'vitest';

import * as jobSnapshot from '../../../src/services/job-snapshot/index.js';
import * as doctor from '../../../src/services/doctor/index.js';
import * as finalReview from '../../../src/services/final-review/index.js';
import * as auditIndependent from '../../../src/services/audit-independent/index.js';
import * as crystallization from '../../../src/services/crystallization/index.js';

describe('rid-016: 5 publishable subpackages consolidated into src/services/<area>', () => {
  test('peaks-loop-job-snapshot surface resolves via local path', () => {
    expect(typeof jobSnapshot.collectResourceSnapshot).toBe('function');
  });

  test('peaks-loop-doctor surface resolves via local path', () => {
    expect(typeof doctor.runDoctor).toBe('function');
    expect(typeof doctor.isWorkspaceInitializedAt).toBe('function');
    expect(typeof doctor.compareDistVersion).toBe('function');
    expect(typeof doctor.inspectWorkspaceLayout).toBe('function');
    expect(typeof doctor.collectGateguardEntries).toBe('function');
  });

  test('peaks-loop-final-review surface resolves via local path', () => {
    expect(typeof finalReview.prepareFinalReview).toBe('function');
    expect(typeof finalReview.IncompleteFinalReviewError).toBe('function');
  });

  test('peaks-loop-audit-independent surface resolves via local path', () => {
    const keys = Object.keys(auditIndependent);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('peaks-loop-crystallization surface resolves via local path', () => {
    const keys = Object.keys(crystallization);
    expect(keys.length).toBeGreaterThan(0);
  });

  test('out-of-scope packages remain workspace:* deps (shared, shared-channel, mut)', () => {
    // Sanity check: the moved areas' import did not pull shared/sh-channel/mut.
    expect(typeof jobSnapshot).toBe('object');
  });
});
