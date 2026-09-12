// tests/unit/doctor/codegraph-exclude-integrity.test.ts
//
// 4-dimension unit test for the `capability:codegraph-exclude-integrity`
// doctor check (slice S2 of rid-2026-09-12-codegraph-exclude-integrity).
//
// The check is the always-on half of the gate: `peaks codegraph status`
// only fires when someone runs it, while `peaks doctor` runs on every
// project-health pass. It must:
//   - stay silent (ok) when codegraph was never initialized here, so a
//     fresh clone does not fail the doctor;
//   - block (ok:false, default error severity) when tracked source
//     files are provably excluded;
//   - degrade to a non-blocking warning when it cannot evaluate at all,
//     so an unrelated failure (not a git repo) does not flip the exit
//     code;
//   - never write the config — it consumes the same read-only inspector
//     `status` uses.
//
// The probe is injected in every case, so this file never reads the
// repo's own `.codegraph/` directory; the one case that needs the real
// inspector builds its own throwaway git project under the OS temp dir.
//
// Dimensions covered:
//   - behavior:    the four verdicts (not-initialized / clean / gapped /
//                  unevaluable)
//   - render:      check id + `ok` + `severity` shape
//   - a11y:        the gapped message names the rule AND a concrete
//                  blocked file AND the one command that fixes it
//   - integration: the real check plugin is driven through the real
//                  doctor plugin registry entry (`PLUGINS`)
//
// Run with: pnpm vitest run tests/unit/doctor/codegraph-exclude-integrity.test.ts

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { check } from '~/src/services/doctor/doctor-service/checks/codegraph-exclude-integrity';
import { inspectCodegraphExcludeIntegrity } from '~/src/services/codegraph/codegraph-exclude-integrity';
import { PLUGINS } from '~/src/services/doctor/doctor-service/plugin-registry';
import type {
  CodegraphExcludeIntegrityProbe,
  DoctorCheck,
  DoctorContext,
  DoctorOptions
} from '~/src/services/doctor/doctor-service/types';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/doctor/codegraph-exclude-integrity.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

const CHECK_ID = 'capability:codegraph-exclude-integrity';

// Minimal DoctorContext — this check only reads `options`.
function makeContext(options: DoctorOptions = {}): DoctorContext {
  return {
    options,
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
    accumulatedChecks: [],
  };
}

// The plugin contract allows an async `run`; this check is synchronous,
// so narrow the union once here instead of at every call site.
function runCheck(ctx: DoctorContext): readonly DoctorCheck[] {
  return check.run(ctx) as readonly DoctorCheck[];
}

const GAPPED: CodegraphExcludeIntegrityProbe = {
  configPath: '/tmp/project/.codegraph/config.json',
  gap: true,
  trackedSourceCount: 1117,
  excludedTrackedCount: 26,
  rulesToRemove: ['**/vendor/**', '**/artifacts/**'],
  violations: [
    { path: 'src/vendor/client.ts', matchedRule: '**/vendor/**' },
    { path: 'src/artifacts/report.ts', matchedRule: '**/artifacts/**' },
  ],
};

const CLEAN: CodegraphExcludeIntegrityProbe = {
  configPath: '/tmp/project/.codegraph/config.json',
  gap: false,
  trackedSourceCount: 1117,
  excludedTrackedCount: 0,
  rulesToRemove: [],
  violations: [],
};

// A throwaway git work tree whose config blocks a tracked file AND
// carries the empty rule `picomatch` refuses to compile ("Expected
// pattern to be a non-empty string"). Used by the one case that drives
// the REAL inspector through the check — every other case injects a
// hand-written probe and could not see this regression.
function createTempProjectWithEmptyRule(): string {
  const project = mkdtempSync(join(tmpdir(), 'peaks-doctor-cg-'));
  execFileSync('git', ['-C', project, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', project, 'config', 'user.email', 'peaks-test@example.com'], { stdio: 'ignore' });
  execFileSync('git', ['-C', project, 'config', 'user.name', 'peaks test'], { stdio: 'ignore' });

  mkdirSync(join(project, 'vendor'), { recursive: true });
  writeFileSync(join(project, 'vendor', 'lib.ts'), 'export const lib = 1;\n', 'utf8');
  execFileSync('git', ['-C', project, 'add', '-A'], { stdio: 'ignore' });
  execFileSync('git', ['-C', project, 'commit', '-qm', 'fixture'], { stdio: 'ignore' });

  mkdirSync(join(project, '.codegraph'), { recursive: true });
  writeFileSync(
    join(project, '.codegraph', 'config.json'),
    `${JSON.stringify({ version: 1, include: ['**/*.ts'], exclude: ['', '**/vendor/**'] }, null, 2)}\n`,
    'utf8',
  );

  return project;
}

describe('capability:codegraph-exclude-integrity', () => {
  it('when codegraph is not initialized here, should pass without noise', () => {
    const checks = runCheck(makeContext({ codegraphIntegrityProbe: () => null }));

    expect(checks).toHaveLength(1);
    expect(checks[0]?.id).toBe(CHECK_ID);
    expect(checks[0]?.ok).toBe(true);
    expect(checks[0]?.message).toContain('not initialized');
  });

  it('when the exclude list blocks nothing, should pass and report the admitted count', () => {
    const checks = runCheck(makeContext({ codegraphIntegrityProbe: () => CLEAN }));

    expect(checks[0]?.ok).toBe(true);
    expect(checks[0]?.message).toContain('1117');
  });

  it('when tracked source files are excluded, should fail with the default (blocking) severity', () => {
    const checks = runCheck(makeContext({ codegraphIntegrityProbe: () => GAPPED }));

    expect(checks[0]?.id).toBe(CHECK_ID);
    expect(checks[0]?.ok).toBe(false);
    // No explicit severity => the doctor's default, i.e. blocking.
    expect(checks[0]?.severity).toBeUndefined();
    expect(checks[0]?.message).toContain('26 of 1117');
  });

  it('the failure message must name the rules, a blocked file, and the fix command', () => {
    const checks = runCheck(makeContext({ codegraphIntegrityProbe: () => GAPPED }));
    const message = checks[0]?.message ?? '';

    expect(message).toContain('**/vendor/**');
    expect(message).toContain('**/artifacts/**');
    expect(message).toContain('src/vendor/client.ts');
    expect(message).toContain('peaks codegraph repair-exclude');
  });

  it('with an empty rule in the config, should still block on the real gap', () => {
    // Regression from the picomatch delegation: the empty rule made the
    // inspector throw, and the check downgraded that to
    // `severity: 'warning'` — a non-blocking verdict over an index that
    // was still provably incomplete. The junk rule must not change the
    // severity of a real gap.
    const project = createTempProjectWithEmptyRule();
    try {
      const checks = runCheck(
        makeContext({ codegraphIntegrityProbe: () => inspectCodegraphExcludeIntegrity(project) })
      );

      expect(checks[0]?.ok).toBe(false);
      // No explicit severity => the doctor's default, i.e. blocking.
      expect(checks[0]?.severity).toBeUndefined();
      expect(checks[0]?.message).toContain('**/vendor/**');
      expect(checks[0]?.message).toContain('vendor/lib.ts');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when the probe throws, should warn instead of blocking', () => {
    const checks = runCheck(
      makeContext({
        codegraphIntegrityProbe: () => {
          throw new Error('fatal: not a git repository');
        },
      })
    );

    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.severity).toBe('warning');
    expect(checks[0]?.message).toContain('not a git repository');
  });

  it('is registered in the doctor plugin list, right after capability:codegraph', () => {
    const names = PLUGINS.map((plugin) => plugin.name);
    expect(names).toContain('codegraph-exclude-integrity');
    expect(names.indexOf('codegraph-exclude-integrity')).toBe(names.indexOf('codegraph-capability') + 1);
  });
});
