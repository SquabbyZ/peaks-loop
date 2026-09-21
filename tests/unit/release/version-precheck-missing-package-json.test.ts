// tests/unit/release/version-precheck-missing-package-json.test.ts
//
// Defect pinned (triage 2026-09-13, bug 2): `readRootVersion` called
// `readFileSync` + `JSON.parse` with no guard, so `peaks release canary` (whose
// first step is `runAllLayers`) crashed on a project without a readable
// package.json. The raw error escaped to commander's catch-all and surfaced as
//
//   { ok: false, command: "cli", code: "UNHANDLED_ERROR" }
//
// instead of a structured `PRECHECK_BLOCKER` naming the actual problem.
//
// Run with:
//   pnpm vitest run tests/unit/release/version-precheck-missing-package-json.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runAllLayers } from '~/src/services/release/version-precheck-service';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-precheck-nopkg-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('release precheck — an unreadable root package.json is a structured blocker', () => {
  it('package.json absent → rootVsShared blocker, no throw', () => {
    const envelope = runAllLayers({ projectRoot: root });

    expect(envelope.ok).toBe(false);
    expect(envelope.overall).toBe('blocker');
    expect(envelope.layers.rootVsShared.status).toBe('blocker');
    expect(envelope.layers.rootVsShared.message).toContain('package.json');
    expect(envelope.layers.rootVsShared.remediation.length).toBeGreaterThan(0);
  });

  it('package.json unparseable → rootVsShared blocker, no throw', () => {
    writeFileSync(join(root, 'package.json'), '{ this is not json');

    const envelope = runAllLayers({ projectRoot: root });

    expect(envelope.ok).toBe(false);
    expect(envelope.layers.rootVsShared.status).toBe('blocker');
    expect(envelope.layers.rootVsShared.message).toMatch(/json/i);
  });

  it('package.json#version not semver → rootVsShared blocker, no throw', () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'x', version: 'not-a-version' })
    );

    const envelope = runAllLayers({ projectRoot: root });

    expect(envelope.ok).toBe(false);
    expect(envelope.layers.rootVsShared.status).toBe('blocker');
    expect(envelope.layers.rootVsShared.message).toContain('version');
  });

  // The regression half: a well-formed fixture must still reach a non-blocker
  // verdict, so the guard did not turn every run into a blocker.
  it(
    'a well-formed project still reports rootVsShared ok',
    () => {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'x',
          version: '4.0.0',
          dependencies: { 'peaks-loop-shared': 'workspace:*' }
        })
      );
      mkdirSync(join(root, 'packages', 'peaks-loop-shared', 'dist'), { recursive: true });
      writeFileSync(
        join(root, 'packages', 'peaks-loop-shared', 'dist', 'version.js'),
        'export const CLI_VERSION = "4.0.0";\n'
      );
      writeFileSync(
        join(root, 'packages', 'peaks-loop-shared', 'package.json'),
        JSON.stringify({ name: 'peaks-loop-shared', version: '4.0.0' })
      );

      const envelope = runAllLayers({ projectRoot: root });

      expect(envelope.layers.rootVsShared.status).toBe('ok');
      expect(envelope.layers.workspaceLockstep.status).toBe('ok');
      expect(envelope.rootVersion).toBe('4.0.0');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});
