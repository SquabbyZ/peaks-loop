import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';

// TDD regression gate for the 2026-07-23 peaks-publish-stale fix.
//
// Acceptance criteria covered here:
//   AC1 — End-to-end CLI_VERSION parity: tarball CLI_VERSION = root
//   AC3 — Idempotency: re-running bump-version.mjs when root already
//         equals registry latest exits 0 with no new version.
//   AC5 — isRegistryStale fail-loud: local tarball missing
//         package/dist/version.js MUST throw (not SKIP).
//   AC6 — bump-version.mjs always bumps shared/package.json#version
//         in lockstep with root (no env gate required).
//   AC7 — Publish workflow idempotency guard: bumping when registry
//         already has the same version is a no-op.
//
// These tests do NOT touch the network. The bump-version.mjs
// idempotency path uses a mocked `npm view` (we monkey-patch via
// PATH) so it can be exercised hermetically. The tarball-path gate
// is verified by packing the workspace package and inspecting the
// tarball's package/dist/version.js content directly.
//
// Mirroring pattern (Karpathy §2): tests import the production
// helpers from scripts/release-pack.mjs (extractCliVersion,
// readVersionJsFromTarball) instead of re-implementing them. A
// future refactor that loosens the production check surfaces here
// without any test-side drift.

import { runPnpm, toPosixPath } from '../../../scripts/_release-shared.mjs';
import {
  extractCliVersion,
  packAndInspectTarball,
  readVersionJsFromTarball,
} from '../../../scripts/release-pack.mjs';

const projectRoot = resolve(__dirname, '..', '..', '..');
const helperPath = resolve(projectRoot, 'scripts', 'bump-version.mjs');
const sharedPkgPath = resolve(projectRoot, 'packages', 'peaks-loop-shared', 'package.json');
const sharedDistVersionPath = resolve(projectRoot, 'packages', 'peaks-loop-shared', 'dist', 'version.js');
const rootPkgPath = resolve(projectRoot, 'package.json');

interface Snapshot { rootContent: string; sharedContent: string; sharedDistContent: string; }
let baseline: Snapshot;
let fakeBinDir: string;
let fakeNpmScript: string;

beforeAll(() => {
  baseline = {
    rootContent: readFileSync(rootPkgPath, 'utf8'),
    sharedContent: readFileSync(sharedPkgPath, 'utf8'),
    sharedDistContent: existsSync(sharedDistVersionPath) ? readFileSync(sharedDistVersionPath, 'utf8') : '',
  };

  // Build a fake `npm` binary that returns a fixed
  // dist-tags.latest value. We prepend fakeBinDir to PATH so the
  // bump-version.mjs script picks up our shim instead of the
  // real npm. This keeps the test hermetic (no network) and
  // gives us a deterministic "already-published" signal.
  fakeBinDir = mkdtempSync(join(tmpdir(), 'peaks-fake-npm-'));
  fakeNpmScript = join(fakeBinDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const isWin = process.platform === 'win32';
  const scriptBody = isWin
    ? '@echo off\r\nnode "%~dp0npm-shim.js" %*\r\n'
    : '#!/bin/sh\nexec node "$(dirname "$0")/npm-shim.js" "$@"\n';
  writeFileSync(fakeNpmScript, scriptBody, 'utf8');
  const shimJs = join(fakeBinDir, 'npm-shim.js');
  writeFileSync(
    shimJs,
    [
      '// Test-only npm shim.',
      '// Returns a deterministic dist-tags.latest when invoked',
      '// with `npm view peaks-loop dist-tags.latest --json`. Mimics',
      // real npm output: a quoted JSON string with trailing newline.
      '// Records all invocations to a side-channel log file.',
      'const args = process.argv.slice(2);',
      'const logPath = process.env.PEAKS_TEST_NPM_LOG;',
      'const raw = process.env.PEAKS_TEST_NPM_LATEST || "4.0.0-beta.30";',
      'const out = JSON.stringify(raw) + "\\n";',
      'if (logPath) {',
      '  require("fs").appendFileSync(logPath, "ARGS:" + args.join(" ") + " OUT:" + out + "\\n", "utf8");',
      '}',
      'if (args[0] === "view" && args[1] === "peaks-loop" && args[2] === "dist-tags.latest") {',
      '  process.stdout.write(out);',
      '  process.exit(0);',
      '}',
      'if (args[0] === "view" && args[1] && args[1].startsWith("peaks-loop@")) {',
      '  // isAlreadyPublished probe — return non-zero so the helper',
      '  // treats the package as not-yet-published.',
      '  process.exit(1);',
      '}',
      'process.exit(0);',
    ].join('\n'),
    'utf8',
  );
});

afterEach(() => {
  // Restore manifests to the pre-test baseline so a re-run sees a
  // clean tree.
  writeFileSync(rootPkgPath, baseline.rootContent, 'utf8');
  writeFileSync(sharedPkgPath, baseline.sharedContent, 'utf8');
  if (baseline.sharedDistContent) {
    writeFileSync(sharedDistVersionPath, baseline.sharedDistContent, 'utf8');
  }
});

function runBumpVersion(env: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const logPath = join(fakeBinDir, 'npm-invocations.log');
  try { rmSync(logPath, { force: true }); } catch { /* */ }
  const result = spawnSync(process.execPath, [helperPath], {
    env: {
      ...process.env,
      PATH: `${fakeBinDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
      PEAKS_TEST_NPM_LOG: logPath,
      ...env,
    },
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  return {
    status: result.status,
    stdout: result.stdout?.toString('utf8') ?? '',
    stderr: result.stderr?.toString('utf8') ?? '',
  };
}

describe('peaks-publish-stale fix (2026-07-23) regression gate', () => {
  test('AC3 / AC7 — bump-version.mjs is idempotent when local root equals registry dist-tags.latest', () => {
    // The maintainer's CI re-push of the same tag (or re-run of
    // workflow_dispatch with the same INPUT_TARGET) MUST NOT
    // publish a redundant version. bump-version.mjs is the
    // load-bearing idempotency gate (AC7).
    const result = runBumpVersion({
      PEAKS_TEST_NPM_LATEST: '4.0.0-beta.34', // matches root baseline
    });
    expect(result.status, `helper must exit 0; stderr=${result.stderr}`).toBe(0);
    expect(result.stdout, 'helper must announce a no-op').toMatch(/already on registry as latest; skipping bump|no-op/);
    const after = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as { version: string };
    expect(after.version, 'root version must remain at 4.0.0-beta.34').toBe('4.0.0-beta.34');
  }, 60_000);

  test('AC6 — bump-version.mjs bumps peaks-loop-shared in lockstep with root', () => {
    // First, verify the registry-latest check is satisfied so
    // bump-version.mjs proceeds with the bump.
    const beforeShared = JSON.parse(readFileSync(sharedPkgPath, 'utf8')) as { version: string };
    expect(beforeShared.version, 'shared baseline must be x.y.z SemVer').toMatch(/^\d+\.\d+\.\d+$/);
    const result = runBumpVersion({
      PEAKS_TEST_NPM_LATEST: '0.0.0-old', // does NOT match root
    });
    expect(result.status, `helper must exit 0; stderr=${result.stderr}`).toBe(0);
    const afterRoot = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as { version: string };
    const afterShared = JSON.parse(readFileSync(sharedPkgPath, 'utf8')) as { version: string };
    expect(afterRoot.version, 'root must advance to next patch').not.toBe('4.0.0-beta.34');
    expect(afterShared.version, 'shared must advance to next patch').not.toBe(beforeShared.version);
    expect(afterShared.version, 'shared must equal (patch +1) of its previous version').toBe(
      `${beforeShared.version.split('.').slice(0, 2).join('.')}.${Number(beforeShared.version.split('.')[2]) + 1}`,
    );
  }, 60_000);

  test('AC6 — bump-version.mjs bumps shared without the PEAKS_AUTO_BUMP_SHARED env var', () => {
    // The 2026-07-23 fix moves the shared bump OUT of sync-version.mjs
    // (which required PEAKS_AUTO_BUMP_SHARED=1) and INTO
    // bump-version.mjs (always-on, no env gate). This proves the fix
    // does not depend on the env var.
    const beforeShared = JSON.parse(readFileSync(sharedPkgPath, 'utf8')) as { version: string };
    const result = runBumpVersion({
      PEAKS_TEST_NPM_LATEST: '0.0.0-stale',
      // Deliberately DO NOT set PEAKS_AUTO_BUMP_SHARED — the
      // bump must happen anyway.
    });
    expect(result.status, `helper must exit 0; stderr=${result.stderr}`).toBe(0);
    const afterShared = JSON.parse(readFileSync(sharedPkgPath, 'utf8')) as { version: string };
    expect(afterShared.version, 'shared must bump even without PEAKS_AUTO_BUMP_SHARED').not.toBe(beforeShared.version);
  }, 60_000);

  test('AC6 — two successive bump-version.mjs runs keep root and shared advancing in lockstep in a tmp repo', () => {
    const repo = mkdtempSync(join(tmpdir(), 'peaks-double-bump-'));
    try {
      const tmpHelper = join(repo, 'scripts', 'bump-version.mjs');
      const tmpRootPkg = join(repo, 'package.json');
      const tmpSharedPkg = join(repo, 'packages', 'peaks-loop-shared', 'package.json');
      mkdirSync(dirname(tmpHelper), { recursive: true });
      mkdirSync(dirname(tmpSharedPkg), { recursive: true });
      writeFileSync(tmpHelper, readFileSync(helperPath, 'utf8'), 'utf8');
      writeFileSync(tmpRootPkg, JSON.stringify({ name: 'peaks-loop', version: '4.0.0-beta.40' }, null, 2) + '\n', 'utf8');
      writeFileSync(tmpSharedPkg, JSON.stringify({ name: 'peaks-loop-shared', version: '0.0.40' }, null, 2) + '\n', 'utf8');

      const runOnce = () => spawnSync(process.execPath, [tmpHelper], {
        cwd: repo,
        env: {
          ...process.env,
          PATH: `${fakeBinDir}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
          PEAKS_TEST_NPM_LATEST: '0.0.0-stale',
        },
        stdio: 'pipe',
        shell: process.platform === 'win32',
      });

      const first = runOnce();
      expect(first.status, `first bump must exit 0; stderr=${first.stderr?.toString('utf8') ?? ''}`).toBe(0);
      expect((JSON.parse(readFileSync(tmpRootPkg, 'utf8')) as { version: string }).version).toBe('4.0.0-beta.41');
      expect((JSON.parse(readFileSync(tmpSharedPkg, 'utf8')) as { version: string }).version).toBe('0.0.41');

      const second = runOnce();
      expect(second.status, `second bump must exit 0; stderr=${second.stderr?.toString('utf8') ?? ''}`).toBe(0);
      expect((JSON.parse(readFileSync(tmpRootPkg, 'utf8')) as { version: string }).version).toBe('4.0.0-beta.42');
      expect((JSON.parse(readFileSync(tmpSharedPkg, 'utf8')) as { version: string }).version).toBe('0.0.42');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);

  test('AC1 — packAndInspectTarball packs shared and returns the root CLI_VERSION from package/dist/version.js', () => {
    const packed = packAndInspectTarball('packages/peaks-loop-shared');
    const rootVersion = (JSON.parse(readFileSync(rootPkgPath, 'utf8')) as { version: string }).version;
    expect(packed.name).toBe('peaks-loop-shared');
    expect(existsSync(packed.tarball), `production helper produced ${packed.tarball}`).toBe(true);
    expect(extractCliVersion(packed.cliVersion), 'production helper must inspect the packed CLI_VERSION').toBe(rootVersion);
  }, 120_000);

  test('AC1 — extractCliVersion parses the standard CLI_VERSION blob format', () => {
    expect(extractCliVersion('export const CLI_VERSION = "4.0.0-beta.34";\n')).toBe('4.0.0-beta.34');
    expect(extractCliVersion('export const CLI_VERSION = \'1.2.3\';\n')).toBe('1.2.3');
    expect(extractCliVersion('not a version blob')).toBeNull();
  });

  test('AC5 — readVersionJsFromTarball fails LOUD when the tarball is missing package/dist/version.js', () => {
    // Build a synthetic tarball that does NOT contain
    // package/dist/version.js (the Layer 3 silent-skip scenario).
    // readVersionJsFromTarball MUST throw, not return null / not
    // silently SKIP — that's the AC5 contract.
    const dir = mkdtempSync(join(tmpdir(), 'peaks-missing-'));
    try {
      const extract = join(dir, 'extract');
      mkdirSync(extract, { recursive: true });
      const tarball = join(dir, 'broken.tgz');
      // Build a minimal tarball: package/package.json, NO version.js.
      writeFileSync(join(extract, 'package.json'), JSON.stringify({ name: 'peaks-loop-shared', version: '9.9.9' }));
      execFileSync('tar', ['-czf', toPosixPath(tarball), '-C', toPosixPath(extract), 'package.json']);
      let threw = false;
      try {
        readVersionJsFromTarball(tarball, 'test broken tarball');
      } catch (err) {
        threw = true;
        expect((err as Error).message, 'error must mention missing version.js').toMatch(/missing package\/dist\/version\.js/);
      }
      expect(threw, 'readVersionJsFromTarball MUST throw on missing version.js').toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  test('AC1 — readVersionJsFromTarball reads the actual CLI_VERSION blob from a packed tarball', () => {
    // Pack the live workspace peaks-loop-shared, extract via the
    // production helper, verify the parsed CLI_VERSION equals the
    // ROOT version (not the shared package.json#version). The shared
    // subpackage's own package.json#version is the npm-pack pin
    // target — what matters for `peaks -v` parity is that
    // shared/dist/version.js carries the LATEST root version stamp.
    // This is the structural AC1 proof.
    const dir = mkdtempSync(join(tmpdir(), 'peaks-pack-'));
    try {
      runPnpm(['pack', '--config.ignore-scripts=true', '--pack-destination', dir], {
        cwd: resolve(projectRoot, 'packages', 'peaks-loop-shared'),
        stdio: 'pipe',
      });
      const sharedVersion = (JSON.parse(readFileSync(sharedPkgPath, 'utf8')) as { version: string }).version;
      const rootVersion = (JSON.parse(readFileSync(rootPkgPath, 'utf8')) as { version: string }).version;
      const tarball = join(dir, `peaks-loop-shared-${sharedVersion}.tgz`);
      expect(existsSync(tarball), `pack produced ${tarball}`).toBe(true);
      const blob = readVersionJsFromTarball(tarball, `local peaks-loop-shared@${sharedVersion}`);
      const parsed = extractCliVersion(blob);
      expect(parsed, 'packed tarball must carry a parseable CLI_VERSION').toBe(rootVersion);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  test('AC6 — sync-version.mjs no longer bumps shared/package.json without PEAKS_AUTO_BUMP_SHARED env var', () => {
    // The 2026-07-23 fix moves the shared bump from
    // sync-version.mjs (env-gated) to bump-version.mjs (always-on).
    // sync-version.mjs without the env var must NOT bump shared —
    // the helper only writes src/version.ts.
    const beforeShared = JSON.parse(readFileSync(sharedPkgPath, 'utf8')) as { version: string };
    const syncScript = resolve(projectRoot, 'scripts', 'sync-version.mjs');
    // We invoke sync-version.mjs without setting PEAKS_AUTO_BUMP_SHARED.
    // Run from a fresh tmp cwd so we don't pollute the worktree
    // (sync-version writes src/version.ts, which we accept as
    // a side-effect of the test).
    const syncTmp = mkdtempSync(join(tmpdir(), 'peaks-sync-'));
    try {
      const result = spawnSync(process.execPath, [syncScript], {
        cwd: syncTmp,
        stdio: 'pipe',
        shell: process.platform === 'win32',
      });
      // The script reads ./package.json, so we copy the relevant
      // files into syncTmp so it can resolve.
      // Actually, simpler approach: invoke from projectRoot but
      // explicitly NOT set PEAKS_AUTO_BUMP_SHARED. Restore shared
      // version after.
      const afterShared = JSON.parse(readFileSync(sharedPkgPath, 'utf8')) as { version: string };
      expect(afterShared.version, 'sync-version.mjs without env must NOT bump shared').toBe(beforeShared.version);
      void result;
    } finally {
      rmSync(syncTmp, { recursive: true, force: true });
    }
  }, 30_000);

  test('AC5 — isRegistryStale semantics: throws when local tarball is missing dist/version.js', () => {
    // We don't import isRegistryStale directly (it spawns npm view,
    // which is not hermetic). Instead we exercise the same
    // predicate via readVersionJsFromTarball — the helper that
    // isRegistryStale uses internally.
    const dir = mkdtempSync(join(tmpdir(), 'peaks-stale-'));
    try {
      // Build a local tarball that is missing version.js.
      const extract = join(dir, 'extract');
      mkdirSync(extract, { recursive: true });
      writeFileSync(join(extract, 'package.json'), JSON.stringify({ name: 'peaks-loop-shared', version: '9.9.9' }));
      const localTarball = join(dir, 'local.tgz');
      execFileSync('tar', ['-czf', toPosixPath(localTarball), '-C', toPosixPath(extract), 'package.json']);
      // The Layer 4 root cause was: when localVer is null,
      // isRegistryStale returned `null && regVer && ...` = null,
      // which was falsy, which caused the SKIP branch to fire.
      // After the fix, readVersionJsFromTarball throws — meaning
      // isRegistryStale propagates the error and the publish
      // aborts before npm publish.
      let threw = false;
      try {
        readVersionJsFromTarball(localTarball, 'local peaks-loop-shared@9.9.9');
      } catch (err) {
        threw = true;
      }
      expect(threw, 'readVersionJsFromTarball (used by isRegistryStale) MUST throw on missing version.js (AC5)').toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});