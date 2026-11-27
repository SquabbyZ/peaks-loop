// tests/unit/release/version-precheck-package-bumped.test.ts
//
// The packageVersionBumped layer compares every manifest release-pack publishes
// against the same manifest at the previous release tag. Two tags are built in
// a throwaway repo per test; the failing arm reproduces the 4.3.6 shape, where
// the root version moved and the subpackages did not.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  runPackageVersionBumped,
  type BumpedObserved
} from '~/src/services/release/version-precheck-layer-bumped';
import { runAllLayers } from '~/src/services/release/version-precheck-service';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

let root: string;

const GITLINK_SHA = '1111111111111111111111111111111111111111';

function git(args: readonly string[]): void {
  execFileSync(
    'git',
    ['-C', root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { stdio: 'ignore', windowsHide: true }
  );
}

function writeManifest(path: string, name: string, version: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), JSON.stringify({ name, version }));
}

function release(version: string, manifests: readonly [string, string][]): void {
  writeManifest('package.json', 'fixture-root', version);
  for (const [path, packageVersion] of manifests) {
    writeManifest(path, `fixture-${path.split('/')[1]}`, packageVersion);
  }
  git(['add', '-A']);
  git(['commit', '-m', `release ${version}`]);
  git(['tag', `v${version}`]);
}

function observedRows(result: { observed?: Readonly<Record<string, unknown>> }): BumpedObserved[] {
  return (result.observed?.['packages'] ?? []) as BumpedObserved[];
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-precheck-bumped-'));
  git(['init', '-q']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('packageVersionBumped — every published manifest must move past the previous tag', () => {
  it(
    'when a subpackage keeps its previous version, should block and name both versions',
    () => {
      // given: v1.0.0 shipped subpackage a at 0.0.1 and v1.0.1 bumped only the root
      // when: the layer compares the working tree against v1.0.0
      // then: it blocks and the message reads "fixture-a 0.0.1 -> 0.0.1 (not bumped)"
      release('1.0.0', [['packages/a/package.json', '0.0.1']]);
      release('1.0.1', [['packages/a/package.json', '0.0.1']]);

      const result = runPackageVersionBumped({ projectRoot: root });

      expect(result.status).toBe('blocker');
      expect(result.message).toContain('fixture-a 0.0.1 -> 0.0.1 (not bumped)');
      expect(observedRows(result).find((row) => row.name === 'fixture-a')?.status).toBe(
        'not-bumped'
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when every manifest moved past the previous tag, should report ok',
    () => {
      // given: v1.0.0 shipped root 1.0.0 and subpackage a 0.0.1
      // when: v1.0.1 bumped both
      // then: the layer is ok and both rows are observed as bumped
      release('1.0.0', [['packages/a/package.json', '0.0.1']]);
      release('1.0.1', [['packages/a/package.json', '0.0.2']]);

      const result = runPackageVersionBumped({ projectRoot: root });

      expect(result.status).toBe('ok');
      expect(observedRows(result).map((row) => row.status)).toEqual(['bumped', 'bumped']);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when a package did not exist at the previous tag, should pass it as new',
    () => {
      // given: v1.0.0 had no packages/b
      // when: v1.0.1 introduces packages/b while bumping everything else
      // then: the layer is ok and packages/b is observed as new
      release('1.0.0', [['packages/a/package.json', '0.0.1']]);
      release('1.0.1', [
        ['packages/a/package.json', '0.0.2'],
        ['packages/b/package.json', '0.0.1']
      ]);

      const result = runPackageVersionBumped({ projectRoot: root });
      const fresh = observedRows(result).find((row) => row.name === 'fixture-b');

      expect(result.status).toBe('ok');
      expect(fresh?.status).toBe('new');
      expect(result.message).toContain('fixture-b did not exist yet');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when no earlier release tag is visible, should report unknown instead of ok',
    () => {
      // given: a repository whose only tag equals the current version
      // when: the layer looks for an earlier tag and finds none
      // then: it is a warning, never ok, and reports how many tags the checkout can see
      release('1.0.0', [['packages/a/package.json', '0.0.1']]);

      const result = runPackageVersionBumped({ projectRoot: root });

      expect(result.status).toBe('warning');
      expect(result.observed?.['previousTag']).toBe('');
      expect(result.observed?.['tagsVisible']).toBe(1);
      expect(result.message).toContain('NOT treated as safe');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when every tag is gone (a shallow clone), should report unknown and block under strict',
    () => {
      // given: the same repository with its release tag deleted, as fetch-depth: 1 leaves it
      // when: the layer runs plainly and again through the orchestrator with --strict
      // then: the plain run is a warning with 0 visible tags and the strict run is a blocker
      release('1.0.0', [['packages/a/package.json', '0.0.1']]);
      git(['tag', '-d', 'v1.0.0']);

      const result = runPackageVersionBumped({ projectRoot: root });
      const envelope = runAllLayers({ projectRoot: root, strict: true });

      expect(result.status).toBe('warning');
      expect(result.status).not.toBe('ok');
      expect(result.observed?.['tagsVisible']).toBe(0);
      expect(result.message).toContain('no release tag below v1.0.0 is visible');
      expect(envelope.layers.packageVersionBumped.status).toBe('blocker');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when the path is listed at the tag but git cannot show it, should report unknown instead of new',
    () => {
      // given: at v1.0.0 packages/b/package.json is a gitlink, so git ls-tree lists it
      // when: v1.0.1 turns it into a real manifest and git show of the old tag fails
      // then: the row is unknown and the layer warns; a failed read is never "new"
      writeManifest('package.json', 'fixture-root', '1.0.0');
      writeManifest('packages/a/package.json', 'fixture-a', '0.0.1');
      git(['add', '-A']);
      git([
        'update-index',
        '--add',
        '--cacheinfo',
        `160000,${GITLINK_SHA},packages/b/package.json`
      ]);
      git(['commit', '-m', 'release 1.0.0']);
      git(['tag', 'v1.0.0']);
      release('1.0.1', [
        ['packages/a/package.json', '0.0.2'],
        ['packages/b/package.json', '0.0.1']
      ]);

      const result = runPackageVersionBumped({ projectRoot: root });
      const row = observedRows(result).find((entry) => entry.name === 'fixture-b');

      expect(row?.status).toBe('unknown');
      expect(result.status).toBe('warning');
      expect(result.message).toContain('could not compare');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});
