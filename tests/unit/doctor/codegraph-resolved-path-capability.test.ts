// tests/unit/doctor/codegraph-resolved-path-capability.test.ts
//
// Root-only managed-path surfacing in the doctor — regression for the
// `.peaks`-nested `.codegraph/` preferred-path removal.
//
// Dimensions covered (per `.peaks/standards/typescript/testing.md`):
//   - behavior:    check message names the root `.codegraph/` managed
//                  path; a leftover `.peaks`-nested codegraph tree does
//                  not leak into the prose; CG-007 not-resolvable
//                  fallback preserved.
//   - integration: real fs (mkdtempSync + mkdirSync) drives the
//                  default managed-path probe end-to-end.
//   - render:      check envelope shape unchanged; managed-path
//                  suffix appears verbatim in the message.
//   - a11y:        message names the canonical root `.codegraph/` dir so
//                  the LLM (or operator) can find it without re-reading.
//
// Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
//
// Run with: pnpm vitest run tests/unit/doctor/codegraph-resolved-path-capability.test.ts

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { check } from '~/src/services/doctor/doctor-service/checks/codegraph-capability';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import { resolveCodegraphProjectRoot } from '~/src/services/codegraph/codegraph-service';
import type {
  CodegraphCapabilityProbe,
  CodegraphManagedPathInfo,
  DoctorContext
} from '~/src/services/doctor/doctor-service/types';

declareDimensions(
  'tests/unit/doctor/codegraph-resolved-path-capability.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

function makeContext(): DoctorContext {
  return {
    options: {},
    registry: { skills: [], failures: [] },
    skills: [],
    schemaRoot: '',
    presence: null,
    workspaceInitialized: false,
    statusLineInstalled: false,
    platform: process.platform,
    resolvedL3Root: '',
    projectRootResolver: () => null,
    isValidSessionId: () => true,
    accumulatedChecks: []
  };
}

function healthyPackageProbe(): CodegraphCapabilityProbe {
  return {
    packagePath: '/synthetic/node_modules/@colbymchenry/codegraph/package.json',
    version: '0.7.10',
    binaryPath: '/synthetic/node_modules/@colbymchenry/codegraph/dist/bin/codegraph.js',
    binaryExists: true,
    managedPath: null
  };
}

describe('capability:codegraph managed-path surfacing (root-only)', () => {
  withTmpWorkspacePerTest();

  it('when root .codegraph is resolved, should name the root managed path in the check message (AC1)', () => {
    // given: a project root with no codegraph dir yet and a healthy package probe
    // when:  check.run resolves the managed path via the default resolver
    // then:  the message names `<root>/.codegraph` and never mentions `.peaks`
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-root-doc-'));
    try {
      const location = resolveCodegraphProjectRoot(projectRoot);
      const managedPathProbe = (): CodegraphManagedPathInfo | null => ({
        source: location.source,
        codegraphDir: location.codegraphDir,
        cwd: location.cwd
      });
      const result = check.run({
        ...makeContext(),
        options: { codegraphProbe: healthyPackageProbe, codegraphManagedPathProbe: managedPathProbe }
      });
      expect(result[0].ok).toBe(true);
      expect(result[0].message).toContain(`managed path: ${location.codegraphDir}`);
      expect(result[0].message).toContain(location.codegraphDir);
      expect(result[0].message).not.toContain('.peaks');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('when a legacy .peaks-nested codegraph dir exists, should still name root .codegraph with no .peaks prose (AC1 back-compat)', () => {
    // given: a leftover `.peaks`-nested codegraph directory from the pre-4.0.21 move
    // when:  check.run resolves the managed path via the default resolver
    // then:  the message names root `.codegraph/` and contains no
    //        `.peaks` / "consider moving" prose
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-root-doc-leg-'));
    try {
      mkdirSync(join(projectRoot, '.peaks', '.codegraph'), { recursive: true });
      const location = resolveCodegraphProjectRoot(projectRoot);
      expect(location.codegraphDir).toBe(join(projectRoot, '.codegraph'));

      const managedPathProbe = (): CodegraphManagedPathInfo | null => ({
        source: location.source,
        codegraphDir: location.codegraphDir,
        cwd: location.cwd
      });
      const result = check.run({
        ...makeContext(),
        options: { codegraphProbe: healthyPackageProbe, codegraphManagedPathProbe: managedPathProbe }
      });
      expect(result[0].ok).toBe(true);
      expect(result[0].message).toContain(`managed path: ${location.codegraphDir}`);
      expect(result[0].message).not.toContain('.peaks');
      expect(result[0].message).not.toContain('consider moving');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('when package resolution throws, should report not resolvable (AC2 CG-007 preserved)', () => {
    // given: a codegraph probe that throws (yarn-pnp / missing install)
    // when:  check.run is invoked without a managed-path override
    // then:  ok is false and the message says @colbymchenry/codegraph not resolvable
    const throwingProbe = (): CodegraphCapabilityProbe => {
      throw new Error("Cannot find module '@colbymchenry/codegraph/package.json'");
    };
    const result = check.run({
      ...makeContext(),
      options: { codegraphProbe: throwingProbe }
    });
    expect(result[0].ok).toBe(false);
    expect(result[0].severity).toBeUndefined();
    expect(result[0].message).toContain('@colbymchenry/codegraph not resolvable');
  });
});
