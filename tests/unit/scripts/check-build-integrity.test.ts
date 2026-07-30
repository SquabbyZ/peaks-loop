/**
 * Slice 2026-07-30 — regression pin for the build-integrity chain.
 *
 * The closed root cause was: a stale packages-glob-dist directory
 * survived across a pnpm run build invocation (clean-dist.mjs
 * previously only wiped the root dist directory), causing tsc's
 * incremental-build cache to silently skip newly-added src-glob-ts
 * entries. The most recent live incident was peaks-loop-shared
 * dist missing version.js entirely, which made every downstream
 * peaks subcommand that touches doctor-service throw
 * ERR_MODULE_NOT_FOUND the moment any code path imported
 * peaks-loop-shared/version.
 *
 * Two scripts are under test:
 *
 * 1. clean-dist.mjs — must wipe BOTH the root dist AND every
 *    packages-glob-dist. The narrow regression test verifies that
 *    a fresh-checkout case (no prior dist) is a no-op, and a
 *    populated case leaves zero residue.
 *
 * 2. check-build-integrity.mjs — given a curated fake monorepo
 *    with deliberately missing or extra dist-glob-js entries, the
 *    script must exit non-zero with a descriptive error. Given
 *    a consistent fake monorepo, it must exit zero. The script
 *    only enforces the .d.ts sibling (declaration: true is on);
 *    .js.map is OPTIONAL because tsconfig.base.json sets
 *    sourceMap: false as of 2026-07-30.
 *
 * Both scripts run in-process against an isolated tmpdir so the
 * real .peaks/ tree is never touched.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');

function writeSync(path: string, content: string): void {
  const fh = openSync(path, 'w');
  try {
    writeFileSync(fh, content, 'utf8');
  } finally {
    closeSync(fh);
  }
}

function makeFakeRepo(): string {
  const root = join(
    tmpdir(),
    `peaks-build-integrity-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(root, { recursive: true });
  // Stage the real scripts into the fake repo.
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeSync(join(root, 'scripts', 'clean-dist.mjs'), readFileSync(join(repoRoot, 'scripts', 'clean-dist.mjs'), 'utf8'));
  writeSync(
    join(root, 'scripts', 'check-build-integrity.mjs'),
    readFileSync(join(repoRoot, 'scripts', 'check-build-integrity.mjs'), 'utf8'),
  );
  return root;
}

function stagePackage(
  root: string,
  pkgName: string,
  options: {
    srcFiles: string[];
    distFiles: string[];
    packageJsonExports?: Record<string, unknown>;
    omitDist?: boolean;
  },
): void {
  const pkgRoot = join(root, 'packages', pkgName);
  mkdirSync(join(pkgRoot, 'src'), { recursive: true });
  for (const f of options.srcFiles) {
    writeSync(join(pkgRoot, 'src', f), `// fixture source for ${f}\n`);
  }
  if (!options.omitDist) {
    mkdirSync(join(pkgRoot, 'dist'), { recursive: true });
    for (const f of options.distFiles) {
      writeSync(join(pkgRoot, 'dist', f), `// fixture dist for ${f}\n`);
    }
  }
  const pkgJson: Record<string, unknown> = {
    name: pkgName,
    version: '0.0.1',
    type: 'module',
    exports: options.packageJsonExports ?? { '.': `./dist/index.js` },
    files: ['dist/**'],
  };
  writeSync(join(pkgRoot, 'package.json'), JSON.stringify(pkgJson, null, 2) + '\n');
}

describe('clean-dist.mjs wipes both root and subpackage dist/', () => {
  let root: string;
  beforeEach(() => {
    root = makeFakeRepo();
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeSync(join(root, 'dist', 'cli-index.js'), '// root dist fixture\n');
    stagePackage(root, 'peaks-loop-shared', {
      srcFiles: ['fs.ts', 'paths.ts', 'result.ts', 'version.ts', 'index.ts'],
      distFiles: [
        'fs.js',
        'fs.d.ts',
        'paths.js',
        'paths.d.ts',
        'result.js',
        'result.d.ts',
        'version.js',
        'version.d.ts',
        'index.js',
        'index.d.ts',
      ],
      packageJsonExports: {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './fs': { types: './dist/fs.d.ts', default: './dist/fs.js' },
        './paths': { types: './dist/paths.d.ts', default: './dist/paths.js' },
        './result': { types: './dist/result.d.ts', default: './dist/result.js' },
        './version': { types: './dist/version.d.ts', default: './dist/version.js' },
      },
    });
  });
  afterEach(() => {
    if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  test('removes root dist AND every packages-glob-dist', () => {
    expect(existsSync(join(root, 'dist', 'cli-index.js')), 'pre: root dist fixture present').toBe(true);
    expect(
      existsSync(join(root, 'packages', 'peaks-loop-shared', 'dist', 'version.js')),
      'pre: subpackage dist fixture present',
    ).toBe(true);

    execFileSync(process.execPath, [join(root, 'scripts', 'clean-dist.mjs')], {
      cwd: root,
      stdio: 'pipe',
    });

    expect(existsSync(join(root, 'dist')), 'post: root dist gone').toBe(false);
    expect(
      existsSync(join(root, 'packages', 'peaks-loop-shared', 'dist')),
      'post: subpackage dist gone',
    ).toBe(false);
  });

  test('is a no-op on a fresh checkout (no dist yet, no packages)', () => {
    const freshRoot = join(
      tmpdir(),
      `peaks-build-integrity-fresh-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(freshRoot, { recursive: true });
    try {
      // Expectation: clean-dist exits 0 even when nothing exists.
      execFileSync(process.execPath, [join(root, 'scripts', 'clean-dist.mjs')], {
        cwd: freshRoot,
        stdio: 'pipe',
      });
      expect(existsSync(join(freshRoot, 'dist'))).toBe(false);
      expect(existsSync(join(freshRoot, 'packages'))).toBe(false);
    } finally {
      if (existsSync(freshRoot)) rmSync(freshRoot, { recursive: true, force: true });
    }
  });
});

describe('check-build-integrity.mjs flags tsc-cache drift', () => {
  let root: string;
  beforeEach(() => {
    root = makeFakeRepo();
  });
  afterEach(() => {
    if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  test('passes when every src-glob-ts has matching dist-glob-js + .d.ts', () => {
    stagePackage(root, 'peaks-loop-shared', {
      srcFiles: ['fs.ts', 'paths.ts', 'result.ts', 'version.ts', 'index.ts'],
      distFiles: [
        'fs.js',
        'fs.d.ts',
        'paths.js',
        'paths.d.ts',
        'result.js',
        'result.d.ts',
        'version.js',
        'version.d.ts',
        'index.js',
        'index.d.ts',
      ],
      packageJsonExports: {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './fs': { types: './dist/fs.d.ts', default: './dist/fs.js' },
        './paths': { types: './dist/paths.d.ts', default: './dist/paths.js' },
        './result': { types: './dist/result.d.ts', default: './dist/result.js' },
        './version': { types: './dist/version.d.ts', default: './dist/version.js' },
      },
    });

    const out = execFileSync(
      process.execPath,
      [join(root, 'scripts', 'check-build-integrity.mjs')],
      { cwd: root, stdio: 'pipe' },
    );
    expect(out.toString()).toContain('build-integrity: OK');
  });

  test('exits non-zero when dist is missing a file that src emits', () => {
    // The exact Bug-04 lineage: src/version.ts exists, but dist/
    // has no version.js — the failure mode that crashed peaks
    // CLI globally when any subcommand loaded doctor-service.
    stagePackage(root, 'peaks-loop-shared', {
      srcFiles: ['fs.ts', 'paths.ts', 'result.ts', 'version.ts', 'index.ts'],
      distFiles: [
        'fs.js',
        'fs.d.ts',
        'paths.js',
        'paths.d.ts',
        'result.js',
        'result.d.ts',
        // version.js deliberately omitted
        'index.js',
        'index.d.ts',
      ],
      packageJsonExports: {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './fs': { types: './dist/fs.d.ts', default: './dist/fs.js' },
        './paths': { types: './dist/paths.d.ts', default: './dist/paths.js' },
        './result': { types: './dist/result.d.ts', default: './dist/result.js' },
        './version': { types: './dist/version.d.ts', default: './dist/version.js' },
      },
    });

    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [join(root, 'scripts', 'check-build-integrity.mjs')], {
        cwd: root,
        stdio: 'pipe',
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer };
      exitCode = e.status ?? -1;
      stderr = e.stderr?.toString() ?? '';
    }
    expect(exitCode, 'expected non-zero exit').not.toBe(0);
    expect(stderr).toContain('version.js');
    expect(stderr).toContain('peaks-loop-shared');
  });

  test('exits non-zero when dist is missing a sibling .d.ts', () => {
    // A subtler drift: dist/version.js exists, but dist/version.d.ts
    // does not. Downstream TypeScript consumers crash because the
    // exports map's `types` field resolves to a missing file.
    stagePackage(root, 'peaks-loop-shared', {
      srcFiles: ['version.ts', 'index.ts'],
      distFiles: [
        'version.js',
        // version.d.ts deliberately omitted
        'index.js',
        'index.d.ts',
      ],
      packageJsonExports: {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './version': { types: './dist/version.d.ts', default: './dist/version.js' },
      },
    });

    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [join(root, 'scripts', 'check-build-integrity.mjs')], {
        cwd: root,
        stdio: 'pipe',
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer };
      exitCode = e.status ?? -1;
      stderr = e.stderr?.toString() ?? '';
    }
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('version.d.ts');
  });

  test('exits non-zero when dist has an orphan file with no src counterpart', () => {
    stagePackage(root, 'peaks-loop-shared', {
      srcFiles: ['index.ts'],
      distFiles: [
        'index.js',
        'index.d.ts',
        // orphan.js — no matching src/orphan.ts
        'orphan.js',
        'orphan.d.ts',
      ],
    });

    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [join(root, 'scripts', 'check-build-integrity.mjs')], {
        cwd: root,
        stdio: 'pipe',
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer };
      exitCode = e.status ?? -1;
      stderr = e.stderr?.toString() ?? '';
    }
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('orphan');
  });

  // Meta-test: package.json#exports that point to a file the
  // dist does NOT contain must not silently pass. The check
  // walks both the dist tree (for actual emissions) and the
  // exports map (for declared sub-paths), so a stale export
  // declaration that survives a build cannot hide from the
  // integrity gate. The most realistic real-world shape of
  // this drift: peaks-loop-shared previously exposed a
  // /version subpath (line 87 of src/services/dispatch/
  // sub-agent-dispatcher.ts imports peaks-loop-shared/version)
  // and a future maintainer could remove the src/version.ts
  // file without cleaning the exports map. The gate catches
  // it before publish.
  test('exits non-zero when package.json exports point at a dist file the package never emits', () => {
    stagePackage(root, 'peaks-loop-shared', {
      srcFiles: ['index.ts'],
      distFiles: ['index.js', 'index.d.ts'],
      packageJsonExports: {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        // /version subpath declared in exports but src/version.ts
        // does not exist. The export is a phantom that would
        // crash any downstream import('peaks-loop-shared/version').
        './version': { types: './dist/version.d.ts', default: './dist/version.js' },
      },
    });

    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [join(root, 'scripts', 'check-build-integrity.mjs')], {
        cwd: root,
        stdio: 'pipe',
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer };
      exitCode = e.status ?? -1;
      stderr = e.stderr?.toString() ?? '';
    }
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('phantom export');
    expect(stderr).toContain('version.ts');
    expect(stderr).toContain('peaks-loop-shared');
  });

  // Meta-test: a package whose src/ is empty (e.g. a
  // placeholder / data-only subpackage) must not cause the
  // script to throw. It is OK to skip such packages silently
  // so that the build pipeline does not block on meta-packages.
  test('silently skips packages without a src/ directory', () => {
    // Stage an empty package — no src/, no dist/, no exports.
    const pkgRoot = join(root, 'packages', 'empty-meta');
    mkdirSync(pkgRoot, { recursive: true });
    writeSync(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: 'empty-meta', version: '0.0.0' }) + '\n',
    );

    // Also stage a healthy package so the script has at least
    // one package to walk.
    stagePackage(root, 'peaks-loop-shared', {
      srcFiles: ['index.ts'],
      distFiles: ['index.js', 'index.d.ts'],
    });

    const out = execFileSync(
      process.execPath,
      [join(root, 'scripts', 'check-build-integrity.mjs')],
      { cwd: root, stdio: 'pipe' },
    );
    expect(out.toString()).toContain('build-integrity: OK');
  });
});
