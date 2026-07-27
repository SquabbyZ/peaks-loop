/**
 * rid-010 — canary auto-wire precheck guard (Phase 4 slice 1).
 *
 * Covers AC-8: `peaks release canary` first calls `runAllLayers()` and refuses
 * to proceed with status 'PRECHECK_BLOCKER' if any layer is blocker. Uses the
 * extracted `executeCanaryAction` named export from release-commands.ts (W5 fix).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { executeCanaryAction } from '../../../src/cli/commands/release-commands.js';
import type { ProgramIO } from '../../../src/cli/cli-helpers.js';

function makeProjectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-canary-guard-'));
}

function writePackageJson(projectRoot: string, opts: {
  version: string;
  sharedDep?: string;
}): void {
  const deps: Record<string, string> = {};
  if (opts.sharedDep !== undefined) {
    deps['peaks-loop-shared'] = opts.sharedDep;
  }
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify(
    { name: 'peaks-loop-fixture', version: opts.version, dependencies: deps },
    null,
    2
  ));
}

function writeSharedDist(projectRoot: string, cliVersion: string): void {
  const dir = join(projectRoot, 'packages', 'peaks-loop-shared', 'dist');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'version.js'), `export const CLI_VERSION = "${cliVersion}";\n`);
}

function writeSharedPackageJson(projectRoot: string, version: string): void {
  const dir = join(projectRoot, 'packages', 'peaks-loop-shared');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(
    { name: 'peaks-loop-shared', version },
    null,
    2
  ));
}

const stubIO: ProgramIO = {
  stdout: () => {},
  stderr: () => {}
};

describe('executeCanaryAction — AC-8 precheck guard', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeProjectRoot();
  });
  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses with PRECHECK_BLOCKER when shared CLI_VERSION lags root (Layer A)', () => {
    // Layer A blocker: root 4.0.0-beta.40 vs shared dist 0.0.17.
    writePackageJson(tmp, { version: '4.0.0-beta.40', sharedDep: 'workspace:*' });
    writeSharedPackageJson(tmp, '0.0.17');
    writeSharedDist(tmp, '0.0.17');
    const r = executeCanaryAction(
      { percent: '10', project: tmp, json: true },
      stubIO,
      tmp
    );
    expect(r.status).toBe('PRECHECK_BLOCKER');
    expect(r.ok).toBe(false);
    expect(r.blockerLayer?.name).toBe('rootVsShared');
    expect(r.blockerLayer?.result.message).toContain('does not match');
    expect(r.blockerLayer?.result.remediation).toContain('bump packages/peaks-loop-shared/package.json');
  });

  it('proceeds past precheck when all layers are aligned (no blocker)', () => {
    // All layers aligned: root 4.0.0-beta.40 == shared dist 4.0.0-beta.40,
    // workspace:* dep, no changeset staged.
    writePackageJson(tmp, { version: '4.0.0-beta.40', sharedDep: 'workspace:*' });
    writeSharedPackageJson(tmp, '4.0.0-beta.40');
    writeSharedDist(tmp, '4.0.0-beta.40');
    const r = executeCanaryAction(
      { percent: '10', project: tmp, json: true },
      stubIO,
      tmp
    );
    // Precheck passed; downstream may return INVALID_TRANSITION if no plan exists,
    // but never PRECHECK_BLOCKER.
    expect(r.status).not.toBe('PRECHECK_BLOCKER');
    // Either OK (plan exists — unlikely in this fixture) or INVALID_TRANSITION
    // (no plan → can't advance to canary-10).
    expect(['OK', 'INVALID_TRANSITION']).toContain(r.status);
  });

  it('returns INVALID_PERCENT when percent is not 10 or 50', () => {
    writePackageJson(tmp, { version: '4.0.0-beta.40', sharedDep: 'workspace:*' });
    writeSharedPackageJson(tmp, '4.0.0-beta.40');
    writeSharedDist(tmp, '4.0.0-beta.40');
    const r = executeCanaryAction(
      { percent: '25', project: tmp, json: true },
      stubIO,
      tmp
    );
    expect(r.status).toBe('INVALID_PERCENT');
    expect(r.ok).toBe(false);
  });
});