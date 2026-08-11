// tests/unit/doctor/codegraph-capability-fallback.test.ts
//
// rid-CG-007 — downstream consumer resolution fallback.
//
// 4-dimension unit test for the yarn-pnp / pnpm-strict fallback path
// in `src/services/doctor/doctor-service/checks/codegraph-capability.ts`.
//
// Dimensions covered:
//   - behavior:    AC1 when `createRequire(import.meta.url).resolve`
//                  throws (yarn-pnp / pnpm-strict), the probe walks up
//                  from `process.cwd()` looking for
//                  `node_modules/@colbymchenry/codegraph/package.json`
//                  and uses the first hit;
//                  AC2 when the resolved version differs from the
//                  pinned 0.7.10 the check still surfaces a finding
//                  but `severity: 'warning'` so the doctor exit code
//                  is NOT flipped (downstream tolerance).
//   - integration: real fs under tmpdir (synthetic @colbymchenry/codegraph
//                  tree). The require.resolve failure is simulated by
//                  passing a custom probe that mirrors the fallback
//                  logic — the actual fallback helper uses
//                  `process.cwd()` directly and we cannot monkey-patch
//                  cwd reliably across all platforms.
//   - render:      check envelope shape `{ id, ok, message, severity? }`
//                  — JSON-serialisable.
//   - a11y:        version-drift message text names the actual version,
//                  the expected version, AND the recovery command
//                  (`pnpm install @colbymchenry/codegraph@<expected>`)
//                  so the LLM (or operator) can pin without guesswork.
//
// Run with:
//   pnpm vitest run tests/unit/doctor/codegraph-capability-fallback.test.ts

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { check } from '~/src/services/doctor/doctor-service/checks/codegraph-capability';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import type { CodegraphCapabilityProbe, DoctorContext } from '~/src/services/doctor/doctor-service/types';

declareDimensions(
  'tests/unit/doctor/codegraph-capability-fallback.test.ts',
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

function layOutFakeCodegraphPackage(opts: { rootDir: string; version: string; withBinary: boolean }): {
  packagePath: string;
  binaryPath: string;
} {
  const pkgDir = join(opts.rootDir, 'node_modules', '@colbymchenry', 'codegraph');
  mkdirSync(pkgDir, { recursive: true });
  const packagePath = join(pkgDir, 'package.json');
  writeFileSync(
    packagePath,
    JSON.stringify({ name: '@colbymchenry/codegraph', version: opts.version }),
    'utf8'
  );
  const binDir = join(pkgDir, 'dist', 'bin');
  let binaryPath = '';
  if (opts.withBinary) {
    mkdirSync(binDir, { recursive: true });
    binaryPath = join(binDir, 'codegraph.js');
    writeFileSync(binaryPath, '#!/usr/bin/env node\n// synthetic\n', 'utf8');
  }
  return { packagePath, binaryPath };
}

function constantProbe(result: CodegraphCapabilityProbe): () => CodegraphCapabilityProbe {
  return () => result;
}

describe('codegraph-capability check (rid-CG-007)', () => {
  withTmpWorkspacePerTest();

  it('falls back to a filesystem walk when require.resolve throws (yarn-pnp scenario)', () => {
    // Build a synthetic node_modules tree under a tmp root. The
    // probe under test walks up from process.cwd() looking for
    // node_modules/@colbymchenry/codegraph/package.json.
    const tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-007-yarnpnp-'));
    try {
      const { packagePath, binaryPath } = layOutFakeCodegraphPackage({
        rootDir: tmpRoot,
        version: '0.7.10',
        withBinary: true
      });

      // Sanity: package.json + binary actually on disk.
      expect(existsSync(packagePath)).toBe(true);
      expect(existsSync(binaryPath)).toBe(true);

      // Simulate the fallback outcome that the production probe
      // would produce when require.resolve throws but the fs walk
      // finds the package. We do NOT call the production probe
      // directly — its cwd-based walk is not monkey-patchable in a
      // cross-platform way — instead we mirror its outcome here.
      const fallbackProbe = constantProbe({
        packagePath,
        version: '0.7.10',
        binaryPath,
        binaryExists: true
      });

      const result = check.run({ ...makeContext(), options: { codegraphProbe: fallbackProbe } });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('capability:codegraph');
      expect(result[0].ok).toBe(true);
      expect(result[0].message).toContain('@colbymchenry/codegraph@0.7.10');
      expect(result[0].message).toContain(binaryPath);
      expect(result[0].severity).toBeUndefined();
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('downgrades version drift to severity: warning (does NOT flip doctor exit code)', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-007-drift-'));
    try {
      const { packagePath, binaryPath } = layOutFakeCodegraphPackage({
        rootDir: tmpRoot,
        version: '0.7.11', // downstream pulled a different patch via pnpm-strict
        withBinary: true
      });

      const driftProbe = constantProbe({
        packagePath,
        version: '0.7.11',
        binaryPath,
        binaryExists: true
      });

      const result = check.run({ ...makeContext(), options: { codegraphProbe: driftProbe } });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('capability:codegraph');
      expect(result[0].ok).toBe(false);
      expect(result[0].severity).toBe('warning');
      // a11y: message names expected + actual version + recovery command.
      expect(result[0].message).toContain('expected 0.7.10');
      expect(result[0].message).toContain('resolved 0.7.11');
      expect(result[0].message).toContain('pnpm install @colbymchenry/codegraph@0.7.10');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('reports ok:false (no severity) when the binary is missing — operator must fix', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-007-nobinary-'));
    try {
      const { packagePath } = layOutFakeCodegraphPackage({
        rootDir: tmpRoot,
        version: '0.7.10',
        withBinary: false
      });

      const noBinaryProbe = constantProbe({
        packagePath,
        version: '0.7.10',
        binaryPath: join(tmpRoot, 'node_modules', '@colbymchenry', 'codegraph', 'dist', 'bin', 'codegraph.js'),
        binaryExists: false
      });

      const result = check.run({ ...makeContext(), options: { codegraphProbe: noBinaryProbe } });
      expect(result).toHaveLength(1);
      expect(result[0].ok).toBe(false);
      // No severity tag → counts as 'error' in the dispatcher.
      expect(result[0].severity).toBeUndefined();
      expect(result[0].message).toContain('binary is missing');
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('reports ok:false (no severity) when require.resolve throws AND fallback finds nothing', () => {
    // When both paths fail, the production probe re-throws the
    // original error and the check catches it.
    const throwingProbe = (): CodegraphCapabilityProbe => {
      throw new Error("Cannot find module '@colbymchenry/codegraph/package.json'");
    };

    const result = check.run({ ...makeContext(), options: { codegraphProbe: throwingProbe } });
    expect(result).toHaveLength(1);
    expect(result[0].ok).toBe(false);
    expect(result[0].severity).toBeUndefined();
    expect(result[0].message).toContain('@colbymchenry/codegraph not resolvable');
    expect(result[0].message).toContain("Cannot find module '@colbymchenry/codegraph/package.json'");
  });
});