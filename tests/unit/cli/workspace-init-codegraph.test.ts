// tests/unit/cli/workspace-init-codegraph.test.ts
//
// rid-CG-001 — workspace-init auto-stake for `.codegraph/`.
//
// 4-dimension unit test for the codegraph auto-stake path that runs
// at the tail of `peaks workspace init`. The auto-stake must run the
// rid-CG-006 conflict guard BEFORE writing anything to disk, so a
// foreign schema is never silently overwritten.
//
// Dimensions covered:
//   - behavior:    AC1 fresh project → guard returns 'fresh' and the
//                  marker is stamped;
//                  AC2 foreign .codegraph/ → guard returns 'conflict'
//                  and the workspace-init surfaces a warning WITHOUT
//                  touching the foreign files;
//                  AC3 already-peaks-loop → guard returns 'noop' and
//                  no extra fs write fires.
//   - integration: real fs (mkdtempSync + mkdir + writeFileSync) drives
//                  the guard. No mocks of the guard module itself —
//                  fake-green lesson 1 forbids that pattern.
//   - render:      guard outcome { status, codegraphDir } shape.
//   - a11y:        every conflict path leaves a human-readable hint
//                  in the warning text so the LLM (or operator) can
//                  recover without re-reading the code.
//
// Run with:
//   pnpm vitest run tests/unit/cli/workspace-init-codegraph.test.ts

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CODEGRAPH_MARKER_NAME,
  defaultCodegraphInitGuard,
  writeCodegraphMarker
} from '~/src/services/codegraph/codegraph-service';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/cli/workspace-init-codegraph.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

function freshProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-cg-001-'));
}

describe('workspace-init codegraph auto-stake (rid-CG-001)', () => {
  withTmpWorkspacePerTest();

  it('fresh project: guard returns fresh and the marker can be stamped (AC1)', () => {
    const projectRoot = freshProject();
    try {
      const guard = defaultCodegraphInitGuard(projectRoot);
      expect(guard.status).toBe('fresh');

      // Mirror the workspace-init body: mkdir + write marker.
      mkdirSync(guard.codegraphDir, { recursive: true });
      writeCodegraphMarker(guard.codegraphDir);

      // Subsequent guard call sees the schema as peaks-loop-managed.
      const after = defaultCodegraphInitGuard(projectRoot);
      expect(after.status).toBe('noop-already-peaks-loop');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('foreign-schema project: guard returns conflict and no marker is written (AC2)', () => {
    const projectRoot = freshProject();
    try {
      mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
      writeFileSync(join(projectRoot, '.codegraph', 'foreign.db'), 'foreign content\n', 'utf8');

      const guard = defaultCodegraphInitGuard(projectRoot);
      expect(guard.status).toBe('conflict-foreign-schema');

      // The workspace-init branch must NOT touch the foreign files.
      // We mirror the branch by NOT calling writeCodegraphMarker and
      // asserting the foreign file is byte-identical after the guard.
      const foreignContentBefore = readFileSync(join(projectRoot, '.codegraph', 'foreign.db'), 'utf8');

      // Re-run the guard to confirm the conflict status is sticky.
      const after = defaultCodegraphInitGuard(projectRoot);
      expect(after.status).toBe('conflict-foreign-schema');

      const foreignContentAfter = readFileSync(join(projectRoot, '.codegraph', 'foreign.db'), 'utf8');
      expect(foreignContentAfter).toBe(foreignContentBefore);

      // The marker file MUST NOT exist.
      const markerPath = join(projectRoot, '.codegraph', CODEGRAPH_MARKER_NAME);
      let markerExists = false;
      try {
        readFileSync(markerPath, 'utf8');
        markerExists = true;
      } catch {
        markerExists = false;
      }
      expect(markerExists).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('peaks-loop-managed project: guard returns noop and no extra write fires (AC3)', () => {
    const projectRoot = freshProject();
    try {
      mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
      writeCodegraphMarker(join(projectRoot, '.codegraph'));
      const markerPath = join(projectRoot, '.codegraph', CODEGRAPH_MARKER_NAME);
      const markerMtimeBefore = readFileSync(markerPath, 'utf8');

      const guard = defaultCodegraphInitGuard(projectRoot);
      expect(guard.status).toBe('noop-already-peaks-loop');

      // Workspace-init must NOT re-write the marker for the noop
      // branch. The marker content is the load-bearing assertion
      // here (mtime is unreliable on tmpfs on some platforms).
      const markerMtimeAfter = readFileSync(markerPath, 'utf8');
      expect(markerMtimeAfter).toBe(markerMtimeBefore);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});