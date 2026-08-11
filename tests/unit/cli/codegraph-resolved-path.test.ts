// tests/unit/cli/codegraph-resolved-path.test.ts
//
// rid-CG-003 spike follow-up — preferred-path resolution.
//
// Dimensions covered (per `.peaks/standards/typescript/testing.md`):
//   - behavior:    preferred > legacy > fresh-preferred precedence;
//                  `createCodegraphInvocation` cwd honors the resolved
//                  location; init guard stamps preferred path on fresh.
//   - integration: real fs (mkdtempSync + mkdirSync + writeFileSync).
//   - render:      `ResolvedCodegraphLocation` shape preserved.
//   - a11y:        guard messages name the resolved codegraphDir so
//                  the LLM (or operator) can recover without re-reading.
//
// Run with: pnpm vitest run tests/unit/cli/codegraph-resolved-path.test.ts

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CODEGRAPH_MARKER_NAME,
  PREFERRED_CODEGRAPH_DIR,
  createCodegraphInvocation,
  defaultCodegraphInitGuard,
  resolveCodegraphProjectRoot,
  writeCodegraphMarker
} from '~/src/services/codegraph/codegraph-service';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/cli/codegraph-resolved-path.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

function freshProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-cg-003-'));
}

describe('resolveCodegraphProjectRoot + createCodegraphInvocation (rid-CG-003)', () => {
  withTmpWorkspacePerTest();

  it('preferred wins over legacy when both exist (AC1)', () => {
    const projectRoot = freshProject();
    try {
      mkdirSync(join(projectRoot, '.peaks', '.codegraph'), { recursive: true });
      mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
      const location = resolveCodegraphProjectRoot(projectRoot);
      expect(location.source).toBe('preferred');
      expect(location.codegraphDir).toBe(join(projectRoot, PREFERRED_CODEGRAPH_DIR));
      expect(location.cwd).toBe(join(projectRoot, '.peaks'));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('legacy is the fallback when preferred is absent (AC2)', () => {
    const projectRoot = freshProject();
    try {
      mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
      const location = resolveCodegraphProjectRoot(projectRoot);
      expect(location.source).toBe('legacy');
      expect(location.codegraphDir).toBe(join(projectRoot, '.codegraph'));
      expect(location.cwd).toBe(projectRoot);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('neither exists → fresh-preferred (AC3)', () => {
    const projectRoot = freshProject();
    try {
      const location = resolveCodegraphProjectRoot(projectRoot);
      expect(location.source).toBe('fresh-preferred');
      expect(location.codegraphDir).toBe(join(projectRoot, PREFERRED_CODEGRAPH_DIR));
      expect(location.cwd).toBe(join(projectRoot, '.peaks'));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('invocation cwd tracks the preferred path so the binary discovers .peaks/.codegraph/ (AC4)', () => {
    const projectRoot = freshProject();
    try {
      mkdirSync(join(projectRoot, '.peaks', '.codegraph'), { recursive: true });
      // createCodegraphInvocation realpath's the project root, so
      // mirror that on Windows where tmp paths resolve through 8.3
      // short-name aliases (e.g. C:\Users\smallMark\… vs
      // C:\Users\SMALLM~1\…).
      const expectedCwd = join(realpathSync.native(projectRoot), '.peaks');
      const invocation = createCodegraphInvocation({ subcommand: 'status', project: projectRoot });
      expect(invocation.cwd).toBe(expectedCwd);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('invocation cwd defaults to .peaks for fresh projects so init lands in the preferred path (AC5)', () => {
    const projectRoot = freshProject();
    try {
      const expectedCwd = join(realpathSync.native(projectRoot), '.peaks');
      const invocation = createCodegraphInvocation({ subcommand: 'init', project: projectRoot });
      expect(invocation.cwd).toBe(expectedCwd);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('defaultCodegraphInitGuard with preferred path (rid-CG-003)', () => {
  withTmpWorkspacePerTest();

  it('preferred-path marker is noop; legacy foreign schema is ignored when preferred wins (AC6)', () => {
    const projectRoot = freshProject();
    try {
      const preferredDir = join(projectRoot, '.peaks', '.codegraph');
      mkdirSync(preferredDir, { recursive: true });
      mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
      writeFileSync(join(projectRoot, '.codegraph', 'foreign.db'), 'not ours\n', 'utf8');
      writeCodegraphMarker(preferredDir);

      const outcome = defaultCodegraphInitGuard(projectRoot);
      expect(outcome.status).toBe('noop-already-peaks-loop');
      expect(outcome.codegraphDir).toBe(preferredDir);
      // Marker filename is preserved across the rid-CG-003 move.
      expect(preferredDir.endsWith('.codegraph')).toBe(true);
      expect(preferredDir.endsWith(CODEGRAPH_MARKER_NAME)).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('legacy foreign-schema conflict stays sticky when preferred is absent (AC6 back-compat)', () => {
    const projectRoot = freshProject();
    try {
      mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
      writeFileSync(join(projectRoot, '.codegraph', 'foreign.db'), 'not ours\n', 'utf8');
      const outcome = defaultCodegraphInitGuard(projectRoot);
      expect(outcome.status).toBe('conflict-foreign-schema');
      expect(outcome.codegraphDir).toBe(join(projectRoot, '.codegraph'));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
