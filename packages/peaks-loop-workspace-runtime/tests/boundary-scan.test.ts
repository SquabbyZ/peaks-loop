import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The two properties that make this package importable by a host that is not
 * peaks-loop:
 *
 *   - it does not name the peaks-loop runtime layout anywhere except the one
 *     function whose job that is;
 *   - it reads no environment, no working directory, and starts no process.
 */

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_ROOT = join(PACKAGE_ROOT, 'src');
const STATE_ROOT_FILE = 'state-root.ts';
const LAYOUT_LITERAL = '.peaks';

/** Every `.ts` file under `src/`, as a POSIX path relative to `src/`. */
function sourceFiles(dir = SRC_ROOT, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(join(dir, entry.name), rel) : [rel];
  });
}

type LiteralHit = { readonly file: string; readonly line: number; readonly text: string };

function layoutLiteralHits(files: readonly string[]): LiteralHit[] {
  return files.flatMap((file) =>
    readFileSync(join(SRC_ROOT, file), 'utf8')
      .split('\n')
      .map((text, index) => ({ file, line: index, text }))
      .filter((row) => row.text.includes(LAYOUT_LITERAL))
  );
}

/** The line span of the `defaultStateRoot` declaration, located by its braces. */
function defaultStateRootSpan(): { readonly start: number; readonly end: number } {
  const lines = readFileSync(join(SRC_ROOT, STATE_ROOT_FILE), 'utf8').split('\n');
  const start = lines.findIndex((line) => line.includes('export function defaultStateRoot'));
  if (start === -1) throw new Error('state-root.ts no longer declares defaultStateRoot');
  const end = lines.findIndex((line, index) => index > start && line === '}');
  if (end === -1) throw new Error('the defaultStateRoot declaration has no closing brace');
  return { start, end };
}

function offendersOf(needle: string): string[] {
  return sourceFiles().filter((file) =>
    readFileSync(join(SRC_ROOT, file), 'utf8').includes(needle)
  );
}

describe('the package names no host layout of its own', () => {
  it('when scanning src, should find the layout literal only inside defaultStateRoot', () => {
    // given:
    const files = sourceFiles();
    const hits = layoutLiteralHits(files);
    const span = defaultStateRootSpan();
    // when:
    const strays = hits.filter(
      (hit) => hit.file !== STATE_ROOT_FILE || hit.line < span.start || hit.line > span.end
    );
    // then:
    expect(files.length).toBeGreaterThan(0);
    expect(hits.length).toBeGreaterThan(0);
    expect(strays).toEqual([]);
  });
});

describe('the package reads nothing from its host', () => {
  it('when scanning src, should find no environment read', () => {
    // given:
    const files = sourceFiles();
    // when:
    const offenders = offendersOf('process.env');
    // then:
    expect(files.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('when scanning src, should find no working-directory read', () => {
    // given:
    const files = sourceFiles();
    // when:
    const offenders = offendersOf('process.cwd');
    // then:
    expect(files.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it('when scanning src, should find no child-process import', () => {
    // given:
    const files = sourceFiles();
    // when:
    const offenders = offendersOf('node:child_process');
    // then:
    expect(files.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
