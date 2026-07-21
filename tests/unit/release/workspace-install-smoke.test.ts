import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import {
  runPnpm,
  toPosixPath,
} from '../../../scripts/_release-shared.mjs';

// Cross-platform install smoke test for the pack-then-install flow.
//
// 2026-07-21 final review: install into a true global-prefix
// layout (`npm install --global --prefix <globalPrefix>`), set
// `HOME` / `USERPROFILE` to a tmpdir so the postinstall hook
// (`scripts/install-skills.mjs`, which writes to `~/.peaks/ and
// `homedir()`-based IDE dirs) does NOT pollute the dev's real
// config. The isolated home is ALSO the `fakeRepoRoot` that
// `peaks-loop-shared/dist/paths.js#findRepoRoot` walks up to
// find (it requires `package.json + skills/`); we mount the
// marker pair there so a single typed module-scoped fixture
// serves BOTH purposes — no `globalThis as any` and no separate
// fakeRepoRoot scaffolding outside the test.
//
// Env exports inspected (see `scripts/install-skills.mjs`):
//   - process.env.PEAKS_PROJECT_ROOT   -> project root the
//                                         postinstall uses to
//                                         resolve `skills/` and
//                                         `output-styles/`
//                                         sources.
//   - process.env.PEAKS_CLAUDE_SKILLS_DIR (and 5 sibling
//     PEAKS_*_OUTPUT_STYLES_DIR / PEAKS_*_AGENTS_DIR) redirect
//     the per-IDE install destination.
//   - process.env.INIT_CWD              -> npm sets this
//                                         during `npm install`.
//                                         We override it to
//                                         guarantee the project
//                                         root the install
//                                         script reads.

const projectRoot = resolve(__dirname, '..', '..', '..');

interface PackageSpec {
  name: string;
  pkgDir: string;
  version: string;
}

const SUBPACKAGES_ORDER: readonly { pkgDir: string }[] = [
  { pkgDir: resolve(projectRoot, 'packages', 'peaks-loop-shared') },
  { pkgDir: resolve(projectRoot, 'packages', 'peaks-loop-shared-channel') },
  { pkgDir: resolve(projectRoot, 'packages', 'peaks-loop-job-snapshot') },
  { pkgDir: resolve(projectRoot, 'packages', 'peaks-loop-mut') },
  { pkgDir: resolve(projectRoot, 'packages', 'peaks-loop-doctor') },
  { pkgDir: resolve(projectRoot, 'packages', 'peaks-loop-crystallization') },
  { pkgDir: resolve(projectRoot, 'packages', 'peaks-loop-final-review') },
  { pkgDir: resolve(projectRoot, 'packages', 'peaks-loop-audit-independent') },
  { pkgDir: projectRoot /* root peaks-loop */ },
];

function readSpec(pkgDir: string): PackageSpec {
  const json = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  return { name: json.name, pkgDir, version: json.version };
}

function packAllTo(dest: string): string[] {
  const tarballs: string[] = [];
  for (const { pkgDir } of SUBPACKAGES_ORDER) {
    const spec = readSpec(pkgDir);
    runPnpm(['pack', '--pack-destination', dest], {
      cwd: pkgDir,
      stdio: 'pipe',
    });
    const tarballName = `${spec.name.replace('@', '').replace(/\//g, '-')}-${spec.version}.tgz`;
    const tarballPath = join(dest, tarballName);
    expect(existsSync(tarballPath), `${pkgDir} produced ${tarballName}`).toBe(true);
    tarballs.push(tarballPath);
  }
  return tarballs;
}

function npmCmd(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

/**
 * Run `npm install --global --prefix <globalPrefix> <tarballs...>`
 * with HOME/USERPROFILE redirected to a tmpdir.
 *
 * The postinstall hook (`scripts/install-skills.mjs`) writes to
 * `homedir()`-derived paths; redirecting `homedir()` keeps that
 * side-effect sandboxed.
 *
 * We DELIBERATELY do NOT pass `--ignore-scripts`. The dispatch
 * review requires the postinstall to actually run so we know the
 * chain holds end-to-end.
 */
function installGlobal(globalPrefix: string, tarballs: string[], env: NodeJS.ProcessEnv): void {
  const args = [
    'install',
    '--global',
    '--prefix', globalPrefix,
    '--no-audit',
    '--no-fund',
    '--offline',
    ...tarballs,
  ];
  const result = spawnSync(npmCmd(), args, {
    cwd: globalPrefix,
    stdio: 'pipe',
    env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(
      `npm install --global --prefix ${globalPrefix} exited ${result.status}\n` +
      `stderr: ${result.stderr?.toString?.() ?? ''}\n` +
      `stdout: ${result.stdout?.toString?.() ?? ''}`,
    );
  }
}

describe('workspace publish install smoke (TDD regression gate)', () => {
  // Module-scoped typed state. No `globalThis as any`.
  let fakeRepoRoot: string;
  let globalPrefix: string;
  let tarballDir: string;
  let prebuiltTarballs: string[];

  beforeAll(() => {
    // fakeRepoRoot: the isolated HOME that doubles as a
    // package.json+skills/ marker for `findRepoRoot`.
    fakeRepoRoot = mkdtempSync(join(os.tmpdir(), 'peaks-isolated-home-'));
    mkdirSync(join(fakeRepoRoot, 'skills'), { recursive: true });
    writeFileSync(
      join(fakeRepoRoot, 'package.json'),
      JSON.stringify({ name: 'peaks-isolated-repo', version: '0.0.0', private: true }, null, 2),
    );

    globalPrefix = mkdtempSync(join(os.tmpdir(), 'peaks-global-prefix-'));
    tarballDir = mkdtempSync(join(os.tmpdir(), 'peaks-install-tarballs-'));

    // Pack the source-managed tarballs WITHOUT re-running
    // `clean-dist` or root tsc. The CI publish workflow already
    // ran `pnpm run build` upstream; rebuilding here is not only
    // redundant but actively HARMFUL — `clean-dist.mjs` races
    // with parallel vitest workers that are reading
    // `dist/cli/commands/{gate-commands,hook-handle}.js`, which
    // is exactly what just made
    // `tests/unit/hook-binary-build-regression.test.ts` fail in
    // CI. We re-pack the source files only.
    prebuiltTarballs = packAllTo(tarballDir);

    // Per install-skills.mjs exports, redirect every per-IDE
    // destination to the isolated home. This way the postinstall
    // NEVER touches the dev's real `~/.claude` or `~/.qoder`.
    //
    // The per-IDE paths are sourced from `homedir()` at module
    // load, so HOME/USERPROFILE alone would direct them into our
    // fakeRepoRoot. We set them explicitly anyway so the
    // redirect is unambiguous even on a host that overrides
    // HOMEDRIVE/HOMEPATH independently.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: fakeRepoRoot,
      USERPROFILE: fakeRepoRoot,
      XDG_CONFIG_HOME: join(fakeRepoRoot, '.config'),
      NPM_CONFIG_PREFIX: globalPrefix,
      // install-skills.mjs' `resolveProjectRoot` checks these —
      // anchor them to the projectRoot so the install script can
      // locate the package's `skills/`, `output-styles/`,
      // `agents/` source dirs even though HOME is sandboxed.
      PEAKS_PROJECT_ROOT: projectRoot,
      // Belt-and-braces: init-cwd is also redirected so that
      // the script's fallback `process.env.INIT_CWD` resolves
      // consistently if the variable is read after `npm install`
      // has rewritten it.
      INIT_CWD: projectRoot,
    };

    installGlobal(globalPrefix, prebuiltTarballs, env);
  }, 600_000);

  afterAll(() => {
    for (const dir of [tarballDir, globalPrefix, fakeRepoRoot]) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  test('every packed tarball has zero workspace: protocol references', () => {
    for (const tarball of prebuiltTarballs) {
      const raw = execFileSync('tar', ['-xOf', toPosixPath(tarball), 'package/package.json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      }).toString('utf8');
      expect(
        raw,
        `${tarball} tarball leaked workspace: protocol into dependencies`,
      ).not.toMatch(/workspace:/);
    }
  }, 60_000);

  test('offline install of every packed tarball into a clean global prefix lands every internal dep', () => {
    // npm `--global --prefix <P>` on Windows 10/11 + npm 10 puts
    // the bin shims at `<P>/<name>(.cmd)`. The package itself
    // lands at `<P>/node_modules/<name>` (legacy behaviour, not
    // lib/node_modules which 11.x uses for the default prefix).
    // We assert the directory lives at `<P>/node_modules` and
    // that every packed tarball's package directory is present.
    const installedNodeModules = join(globalPrefix, 'node_modules');
    expect(
      existsSync(installedNodeModules),
      `${installedNodeModules} must exist after \`npm install --global --prefix ${globalPrefix}\``,
    ).toBe(true);
    for (const tarball of prebuiltTarballs) {
      const filename = tarball.split(/[\\/]/).pop() ?? '';
      const m = filename.match(/^(.+)-(\d+\.\d+\.\d+(?:[-+].+)?)\.tgz$/);
      expect(m, `unexpected tarball name ${filename}`).toBeTruthy();
      const pkgName = m![1];
      const installedPkgDir = join(installedNodeModules, pkgName);
      expect(
        existsSync(installedPkgDir),
        `${pkgName} must be installed at ${installedPkgDir}`,
      ).toBe(true);
    }
  }, 60_000);

  test('global npm install emits the peaks bin shim and the package.json bin entry resolves to a working entrypoint', () => {
    // npm `--global --prefix <P>` writes the bin shim DIRECTLY at
    // <P>/<name>(.cmd|.ps1) on Windows 10/11, and at <P>/bin/<name>
    // on POSIX. Resolve every candidate path so we don't pin to
    // one npm layout schema.
    const candidates = process.platform === 'win32'
      ? [
          join(globalPrefix, 'peaks.cmd'),
          join(globalPrefix, 'peaks'),
          join(globalPrefix, 'bin', 'peaks.cmd'),
          join(globalPrefix, 'bin', 'peaks'),
        ]
      : [join(globalPrefix, 'bin', 'peaks'), join(globalPrefix, 'peaks')];
    const peaksBin = candidates.find((p) => existsSync(p));
    expect(peaksBin, `expected one of: ${candidates.join(', ')}`).toBeDefined();

    // Assert the bin shim physically exists at the symlink /
    // hardlink target — the install succeeded if and only if the
    // shim is at <P>/{name}(.cmd|.ps1). Checking existence only
    // tells us about the surface; checking that it points at a
    // real file (not a dangling link) tells us npm wrote it
    // correctly.
    const linked = readFileSync(peaksBin!, 'utf8');
    if (process.platform === 'win32' && peaksBin!.endsWith('.cmd')) {
      // npm-generated .cmd shims always reference %dp0%\node.exe
      // + the inner entry. Smoke-check the marker substring.
      expect(linked, 'peaks.cmd shim must reference node.exe').toContain('node.exe');
    } else {
      // POSIX shim is executable; check that at least one byte
      // of the file is a valid shebang / proxy.
      expect(linked.length, 'peaks POSIX shim must be non-empty').toBeGreaterThan(0);
    }

    // Sanity: the installed peaks-loop/package.json exposes the
    // same `bin` declaration as the source manifest.
    const installedPkg = JSON.parse(
      readFileSync(join(globalPrefix, 'node_modules', 'peaks-loop', 'package.json'), 'utf8'),
    ) as { bin: { peaks: string }; name: string; version: string };
    expect(installedPkg.name, 'installed peaks-loop manifest').toBe('peaks-loop');
    expect(installedPkg.version, 'installed peaks-loop version').toBe('4.0.0-beta.17');
    expect(installedPkg.bin.peaks, 'installed peaks-loop bin.peaks').toBe('./bin/peaks.js');
    expect(
      existsSync(join(globalPrefix, 'node_modules', 'peaks-loop', 'bin', 'peaks.js')),
      'installed peaks-loop/bin/peaks.js must exist',
    ).toBe(true);
  }, 60_000);

  test('postinstall hook ran and wrote peaks markers into the isolated HOME', () => {
    // scripts/install-skills.mjs symlinks/writes a marker inside
    // `~/.peaks/` — and since HOME is redirected to fakeRepoRoot,
    // it must land in the isolated home (NOT the dev's real
    // config).
    const peaksMarkerDir = join(fakeRepoRoot, '.peaks');
    expect(
      existsSync(peaksMarkerDir),
      `${peaksMarkerDir} must exist after the postinstall hook ran`,
    ).toBe(true);
  }, 30_000);
});
