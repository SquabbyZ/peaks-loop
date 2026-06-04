import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  async function writePkg(body: object | string): Promise<void> {
    const content = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    await writeFile(join(tmpDir, 'package.json'), content, 'utf8');
  }

  test('returns empty report with warning when package.json does not exist', async () => {
    const report = await scanLibraries({ projectRoot: tmpDir });
    expect(report.libraries).toEqual([]);
    expect(report.totalCount).toBe(0);
    expect(report.byScope).toEqual({ dependencies: 0, devDependencies: 0, peerDependencies: 0, optionalDependencies: 0 });
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
    expect(report.warnings).toEqual([]);
  });
});
