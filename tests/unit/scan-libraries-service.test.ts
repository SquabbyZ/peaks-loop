import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { parseMajorVersion, scanLibraries } from '../../src/services/scan/libraries-service.js';

describe('parseMajorVersion', () => {
  test('parses caret-prefixed semver', () => {
    expect(parseMajorVersion('^5.18.0')).toBe(5);
    expect(parseMajorVersion('^1.0.0')).toBe(1);
  });
  test('parses tilde-prefixed semver', () => {
    expect(parseMajorVersion('~1.2.3')).toBe(1);
    expect(parseMajorVersion('~2.0.0')).toBe(2);
  });
  test('parses exact semver', () => {
    expect(parseMajorVersion('1.2.3')).toBe(1);
    expect(parseMajorVersion('5.0.0')).toBe(5);
  });
  test('parses range semver', () => {
    expect(parseMajorVersion('>=1.0.0')).toBe(1);
    expect(parseMajorVersion('>=5.0.0 <6.0.0')).toBe(5);
  });
  test('parses bare integer', () => {
    expect(parseMajorVersion('5')).toBe(5);
  });
  test('parses x-range', () => {
    expect(parseMajorVersion('5.x')).toBe(5);
    expect(parseMajorVersion('5.x.x')).toBe(5);
  });
  test('parses alias spec', () => {
    expect(parseMajorVersion('npm:@scope/x@1')).toBe(1);
  });
  test('returns null for non-semver specs', () => {
    expect(parseMajorVersion('workspace:*')).toBeNull();
    expect(parseMajorVersion('file:../local')).toBeNull();
    expect(parseMajorVersion('git+https://github.com/foo/bar')).toBeNull();
    expect(parseMajorVersion('github:foo/bar')).toBeNull();
    expect(parseMajorVersion('*')).toBeNull();
  });
});

describe('scanLibraries', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'peaks-scan-libraries-'));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writePkg(body: object | string, dir: string = tmpDir): Promise<void> {
    const content = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    await writeFile(join(dir, 'package.json'), content, 'utf8');
  }

  async function writeWorkspaceYaml(content: string, dir: string = tmpDir): Promise<void> {
    await writeFile(join(dir, 'pnpm-workspace.yaml'), content, 'utf8');
  }

  test('returns empty report with warning when package.json does not exist', async () => {
    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.libraries).toEqual([]);
    expect(report.totalCount).toBe(0);
    expect(report.byScope).toEqual({ dependencies: 0, devDependencies: 0, peerDependencies: 0, optionalDependencies: 0 });
    expect(report.workspaces).toEqual([]);
    expect(report.warnings).toContain('package.json not found; nothing to scan.');
  });

  test('parses dependencies with semver caret-prefix and extracts major', async () => {
    await writePkg({
      dependencies: { antd: '^5.18.0', lodash: '^4.17.21' }
    });
    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.libraries).toHaveLength(2);
    const antd = report.libraries.find((l) => l.name === 'antd');
    expect(antd?.version).toBe('^5.18.0');
    expect(antd?.major).toBe(5);
    expect(antd?.scope).toBe('dependencies');
    expect(antd?.ecosystem).toBe('npm');
    const lodash = report.libraries.find((l) => l.name === 'lodash');
    expect(lodash?.major).toBe(4);
  });

  test('parses all 4 dependency scopes with byScope tally', async () => {
    await writePkg({
      dependencies: { react: '^18.0.0' },
      devDependencies: { vitest: '^2.0.0' },
      peerDependencies: { 'react-dom': '^18.0.0' },
      optionalDependencies: { fsevents: '^2.3.0' }
    });
    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.totalCount).toBe(4);
    expect(report.byScope).toEqual({
      dependencies: 1,
      devDependencies: 1,
      peerDependencies: 1,
      optionalDependencies: 1
    });
  });

  test('returns major=null for non-semver specs (workspace:*, file:, git+https://)', async () => {
    await writePkg({
      dependencies: { 'my-pkg': 'workspace:*', 'local-pkg': 'file:../local', 'git-pkg': 'git+https://github.com/foo/bar' }
    });
    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.libraries).toHaveLength(3);
    for (const lib of report.libraries) {
      expect(lib.major).toBeNull();
    }
  });

  test('returns warning when package.json is malformed JSON', async () => {
    await writePkg('{ this is not json');
    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.libraries).toEqual([]);
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings[0]).toMatch(/package\.json is not valid JSON/);
  });

  test('libraries are sorted by name, then scope order (deps > dev > peer > optional)', async () => {
    await writePkg({
      dependencies: { antd: '^5.0.0', zod: '^3.0.0' },
      devDependencies: { antd: '^5.0.0' },
      peerDependencies: { antd: '^5.0.0' },
      optionalDependencies: { antd: '^5.0.0' }
    });
    const report = await scanLibraries({ projectRoot: tmpDir });
    const antd = report.libraries.filter((l) => l.name === 'antd');
    expect(antd).toHaveLength(4);
    expect(antd.map((l) => l.scope)).toEqual([
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies'
    ]);
    // 4 antd entries first (alphabetical), then zod
    expect(report.libraries.length).toBe(5);
    expect(report.libraries[4]?.name).toBe('zod');
    expect(report.libraries[4]?.scope).toBe('dependencies');
  });

  test('handles package.json with no deps block (just name + version)', async () => {
    await writePkg({ name: 'empty-pkg', version: '1.0.0' });
    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.libraries).toEqual([]);
    expect(report.totalCount).toBe(0);
    expect(report.workspaces).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});

describe('scanLibraries — monorepo', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'peaks-scan-libraries-mono-'));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writePkg(body: object | string, relDir: string): Promise<void> {
    const full = join(tmpDir, relDir);
    await mkdir(full, { recursive: true });
    const content = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    await writeFile(join(full, 'package.json'), content, 'utf8');
  }

  test('discovers and scans sub-packages declared in pnpm-workspace.yaml globs', async () => {
    await writeFile(join(tmpDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n", 'utf8');
    await writePkg({ name: 'root', version: '0.0.0' }, '.');
    await writePkg({ name: 'admin', version: '1.0.0', dependencies: { 'a-dep': '^1.0.0' } }, 'packages/admin');
    await writePkg({ name: 'client', version: '1.0.0', dependencies: { 'b-dep': '^1.0.0', 'c-dep': '^2.0.0' } }, 'packages/client');
    await writePkg({ name: 'server', version: '1.0.0', devDependencies: { 'vitest': '^2.0.0' } }, 'packages/server');

    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.workspaces).toHaveLength(3);
    // Sorted by path.
    const paths = report.workspaces.map((w) => w.path).sort();
    expect(paths).toEqual([
      join(tmpDir, 'packages/admin/package.json'),
      join(tmpDir, 'packages/client/package.json'),
      join(tmpDir, 'packages/server/package.json')
    ]);
    const endsWithSep = (s: string) => (w: { path: string }) =>
      w.path.endsWith(`${s}${sep}package.json`) || w.path.endsWith(`${s}/package.json`);
    expect(report.workspaces.find(endsWithSep('admin'))?.count).toBe(1);
    expect(report.workspaces.find(endsWithSep('client'))?.count).toBe(2);
    expect(report.workspaces.find(endsWithSep('server'))?.count).toBe(1);
    // root has 0 deps, so total = 0 + 1 + 2 + 1 = 4
    expect(report.totalCount).toBe(4);
    expect(report.byScope.dependencies).toBe(3);
    expect(report.byScope.devDependencies).toBe(1);
    // per-workspace name + version surface
    const admin = report.workspaces.find(endsWithSep('admin'));
    expect(admin?.name).toBe('admin');
    expect(admin?.version).toBe('1.0.0');
  });

  test('discovers and scans sub-packages declared in npm workspaces field', async () => {
    await writePkg({ name: 'root', version: '0.0.0', workspaces: ['packages/*'] }, '.');
    await writePkg({ name: 'pkg-a', dependencies: { x: '^1.0.0' } }, 'packages/a');
    await writePkg({ name: 'pkg-b', dependencies: { y: '^1.0.0' } }, 'packages/b');

    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.workspaces).toHaveLength(2);
    expect(report.totalCount).toBe(2);
  });

  test('discovers and scans sub-packages declared in yarn workspaces field', async () => {
    await writePkg(
      { name: 'root', version: '0.0.0', workspaces: { packages: ['packages/*'] } },
      '.'
    );
    await writePkg({ name: 'pkg-a', dependencies: { x: '^1.0.0' } }, 'packages/a');
    await writePkg({ name: 'pkg-b', dependencies: { y: '^1.0.0' } }, 'packages/b');

    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.workspaces).toHaveLength(2);
    expect(report.totalCount).toBe(2);
  });

  test('handles nested workspace globs (e.g. packages/hermes-agent/*)', async () => {
    await writeFile(
      join(tmpDir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/*'\n  - 'packages/hermes-agent/*'\n",
      'utf8'
    );
    await writePkg({ name: 'root', version: '0.0.0' }, '.');
    await writePkg({ name: 'admin', dependencies: { a: '^1.0.0' } }, 'packages/admin');
    // Nested sub-packages — matched by both globs but should dedupe to one entry.
    await writePkg({ name: 'ui-tui', dependencies: { b: '^1.0.0' } }, 'packages/hermes-agent/ui-tui');
    await writePkg({ name: 'web', dependencies: { c: '^1.0.0' } }, 'packages/hermes-agent/web');

    const report = await scanLibraries({ projectRoot: tmpDir });
    // Dedupe: hermes-agent/* matches the 2 sub-packages; packages/* matches
    // admin + hermes-agent (directory, no package.json) — we should not include
    // hermes-agent itself since it has no package.json. So total = 3 workspaces.
    const pkgPaths = report.workspaces.map((w) => w.path).sort();
    expect(pkgPaths).toEqual([
      join(tmpDir, 'packages/admin/package.json'),
      join(tmpDir, 'packages/hermes-agent/ui-tui/package.json'),
      join(tmpDir, 'packages/hermes-agent/web/package.json')
    ]);
    expect(report.workspaces).toHaveLength(3);
    expect(report.totalCount).toBe(3);
  });

  test('prefers pnpm-workspace.yaml over npm workspaces field when both present', async () => {
    // pnpm-workspace.yaml lists 2 packages, package.json's workspaces lists 1.
    await writeFile(
      join(tmpDir, 'pnpm-workspace.yaml'),
      "packages:\n  - 'packages/pnpm-a'\n  - 'packages/pnpm-b'\n",
      'utf8'
    );
    await writePkg(
      { name: 'root', version: '0.0.0', workspaces: ['packages/npm-a'] },
      '.'
    );
    await writePkg({ name: 'pnpm-a', dependencies: { x: '^1.0.0' } }, 'packages/pnpm-a');
    await writePkg({ name: 'pnpm-b', dependencies: { y: '^1.0.0' } }, 'packages/pnpm-b');
    // The npm-listed package is also on disk, but pnpm-wins, so its library
    // should NOT be in the report.
    await writePkg({ name: 'npm-a', dependencies: { z: '^1.0.0' } }, 'packages/npm-a');

    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.workspaces).toHaveLength(2);
    const names = report.workspaces.map((w) => w.path).sort();
    expect(names).toEqual([
      join(tmpDir, 'packages/pnpm-a/package.json'),
      join(tmpDir, 'packages/pnpm-b/package.json')
    ]);
    // totalCount = root (0) + pnpm-a (1) + pnpm-b (1) = 2
    expect(report.totalCount).toBe(2);
    expect(report.libraries.find((l) => l.name === 'z')).toBeUndefined();
  });

  test('returns workspaces: [] for single-package projects (byte-identical to today)', async () => {
    await writePkg({ name: 'solo', version: '1.0.0', dependencies: { lodash: '^4.0.0' } }, '.');
    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.workspaces).toEqual([]);
    expect(report.libraries).toHaveLength(1);
    expect(report.totalCount).toBe(1);
    expect(report.byScope.dependencies).toBe(1);
  });

  test('aggregates totalCount and byScope across all workspaces by default', async () => {
    await writeFile(join(tmpDir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n", 'utf8');
    await writePkg({ name: 'root', version: '0.0.0' }, '.');
    await writePkg(
      { name: 'a', dependencies: { foo: '^1.0.0' }, devDependencies: { bar: '^1.0.0' } },
      'packages/a'
    );
    await writePkg(
      { name: 'b', dependencies: { foo: '^1.0.0' }, devDependencies: { bar: '^1.0.0' } },
      'packages/b'
    );

    const report = await scanLibraries({ projectRoot: tmpDir });
    // 2 workspaces × (1 dep + 1 dev) = 4 total
    expect(report.totalCount).toBe(4);
    expect(report.byScope).toEqual({
      dependencies: 2,
      devDependencies: 2,
      peerDependencies: 0,
      optionalDependencies: 0
    });
  });
});
