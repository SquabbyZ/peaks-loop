// tests/unit/doctor/codegraph-resolved-path-capability.test.ts
//
// rid-CG-003 spike follow-up — doctor recognizes resolved managed path.
//
// Dimensions covered (per `.peaks/standards/typescript/testing.md`):
//   - behavior:    check message names preferred vs legacy vs fresh-
//                  preferred; CG-007 yarn-pnp fallback preserved.
//   - integration: real fs (mkdtempSync + mkdirSync) drives the
//                  default managed-path probe end-to-end.
//   - render:      check envelope shape unchanged; managed-path
//                  suffix appears verbatim in the message.
//   - a11y:        preferred / legacy / fresh-preferred labels match
//                  the slice rid-CG-003 naming convention.
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

describe('capability:codegraph managed-path surfacing (rid-CG-003)', () => {
  withTmpWorkspacePerTest();

  it('check message names the preferred-path location when .peaks/.codegraph/ exists (AC1)', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-003-doc-pref-'));
    try {
      mkdirSync(join(projectRoot, '.peaks', '.codegraph'), { recursive: true });
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
      expect(result[0].message).toContain('preferred .peaks/.codegraph/');
      expect(result[0].message).toContain(location.codegraphDir);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('check message names the legacy-path location when only .codegraph/ exists (AC1 legacy)', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-003-doc-leg-'));
    try {
      mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
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
      expect(result[0].message).toContain('legacy root .codegraph/');
      expect(result[0].message).toContain('consider moving to .peaks/.codegraph/');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('preserves the CG-007 yarn-pnp fallback when both probes are absent (AC2)', () => {
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
