/**
 * `src/services/scan/api-surface-service.ts` — path normalization and the
 * non-zero guarantee, exercised through the public `scanApiSurface` entry.
 *
 * The scanner classifies a file by testing its repo-relative path against
 * `src/cli/commands/` and `src/services/`. On Windows `path.relative` returns
 * `src\services\…`, so those filters never match and every count collapses to
 * zero. The scanner normalizes with `.split(sep).join('/')`; the first test
 * proves the reported `sourceFile` values are POSIX on any host, and the
 * second proves a real repository scan is not empty.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { scanApiSurface } from '../../../../src/services/scan/api-surface-service.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function writeSource(root: string, rel: string, body: string): void {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

describe('scanApiSurface', () => {
  it('reports POSIX source paths when the host relative() uses backslashes', async () => {
    // given:
    //   a scratch project with one CLI command file and one service export file
    // when:
    //   the scanner walks it on this host
    // then:
    //   every sourceFile uses forward slashes, so the src/ filters classify it
    const root = mkdtempSync(join(tmpdir(), 'peaks-api-surface-'));
    roots.push(root);
    writeSource(
      root,
      join('src', 'cli', 'commands', 'demo.ts'),
      "program.command('demo').description('demo command');"
    );
    writeSource(
      root,
      join('src', 'services', 'demo', 'thing.ts'),
      ['export function doThing(): void {}', 'export interface Thing { id: string }'].join('\n')
    );

    const report = await scanApiSurface({ projectRoot: root });

    expect(report.counts).toEqual({ cli: 1, service: 1, type: 1, constant: 0 });
    const sourceFiles = [
      ...report.cli.map((entry) => entry.sourceFile),
      ...report.service.map((entry) => entry.sourceFile),
      ...report.type.map((entry) => entry.sourceFile)
    ];
    expect(sourceFiles.length).toBeGreaterThan(0);
    expect(sourceFiles.every((file) => file.startsWith('src/'))).toBe(true);
    expect(sourceFiles.every((file) => !file.includes('\\'))).toBe(true);
  });

  it('finds non-zero CLI and service counts when scanning this repository', async () => {
    // given:
    //   this repository's real src/cli and src/services trees
    // when:
    //   the scanner runs with the default include dirs
    // then:
    //   both CLI subcommands and service exports are found
    const report = await scanApiSurface({ projectRoot: REPO });

    expect(report.counts.cli).toBeGreaterThan(0);
    expect(report.counts.service).toBeGreaterThan(0);
  });
});
