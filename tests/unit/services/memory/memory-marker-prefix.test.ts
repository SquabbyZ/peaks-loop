// tests/unit/services/memory/memory-marker-prefix.test.ts
//
// Unit tests for the sediment-marker prefix tolerance in
// `parseMemoryFrontmatter` (slice 2026-09-10-memory-marker-prefix).
//
// Defect pinned: the parser required the file to start with the `---` fence at
// byte 0, so any memory written with the documented
// `<!-- peaks-memory:start -->` marker BEFORE its frontmatter was rejected
// outright (`hasFrontmatter: false`, `kind: null`) and reported as
// unclassified by `peaks memory reindex` — even when it carried a valid kind.
//
// The fix skips a leading run of HTML-comment lines (at least one required)
// before looking for the fence. Everything else is unchanged: the closing
// fence is still mandatory, kind resolution is untouched, and the body is
// still the text after the closing fence.
//
// Run with:
//   pnpm vitest run tests/unit/services/memory/memory-marker-prefix.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  executeMemoryReindex,
  parseMemoryFrontmatter,
  parseStoredMemoryFile
} from '~/src/services/memory/project-memory-service/index';

const START_MARKER = '<!-- peaks-memory:start -->';
const END_MARKER = '<!-- peaks-memory:end -->';

let root: string;
let memoryDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-marker-prefix-'));
  memoryDir = join(root, '.peaks', 'memory');
  mkdirSync(memoryDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeMemory(fileName: string, content: string): void {
  writeFileSync(join(memoryDir, fileName), content, 'utf8');
}

describe('parseMemoryFrontmatter tolerates a leading sediment marker', () => {
  it('parses a marker-prefixed file and resolves the kind from `metadata.type`', () => {
    const content = [
      START_MARKER,
      '---',
      'name: marker-memory',
      'description: A marker-prefixed memory',
      'metadata:',
      '  type: lesson',
      '---',
      '',
      'Body text long enough to be summarized by the index builder.',
      ''
    ].join('\n');

    const parsed = parseMemoryFrontmatter(content);

    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.kind).toEqual({ kind: 'lesson', source: 'metadata.type', rawKind: 'lesson' });
    expect(parsed.name).toBe('marker-memory');
    expect(parsed.body).toBe('Body text long enough to be summarized by the index builder.');
    // The marker is NOT part of the returned frontmatter block.
    expect(parsed.frontmatter).not.toContain('peaks-memory');
    expect(parsed.frontmatter.startsWith('name: marker-memory')).toBe(true);
  });

  it('resolves a top-level `kind:` behind the marker (the on-disk defect shape)', () => {
    const content = [
      START_MARKER,
      '---',
      'title: 2026-09-03 codegraph lifecycle closure',
      'kind: lesson',
      'date: 2026-09-03',
      '---',
      '',
      'Body text long enough to be summarized.',
      ''
    ].join('\n');

    const parsed = parseMemoryFrontmatter(content);

    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.kind).toEqual({ kind: 'lesson', source: 'kind', rawKind: 'lesson' });
    expect(parsed.title).toBe('2026-09-03 codegraph lifecycle closure');
  });

  it('tolerates several leading comment lines and blank lines', () => {
    const content = [
      '',
      '<!-- peaks-memory:start -->',
      '<!-- a second comment line -->',
      '',
      '---',
      'kind: bug',
      '---',
      '',
      'Body text long enough to be summarized.',
      ''
    ].join('\n');

    const parsed = parseMemoryFrontmatter(content);

    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.kind.kind).toBe('bug');
  });

  it('extracts the body after the fence when the block is closed by the end marker', () => {
    // Pinned semantic: the body is the text after the closing `---` fence, so
    // the trailing end marker remains part of the body — body extraction was
    // deliberately left unchanged.
    const content = [
      START_MARKER,
      '---',
      'kind: lesson',
      '---',
      '',
      'Body text long enough to be summarized.',
      END_MARKER,
      ''
    ].join('\n');

    const parsed = parseMemoryFrontmatter(content);

    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.body).toBe(`Body text long enough to be summarized.\n${END_MARKER}`);
  });

  it('still rejects a marker-prefixed file with no frontmatter fence', () => {
    const content = `${START_MARKER}\nA hand-written note with no frontmatter.\n${END_MARKER}\n`;
    const parsed = parseMemoryFrontmatter(content);

    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.kind).toEqual({ kind: null, source: 'none', rawKind: null });
    expect(parsed.frontmatter).toBe('');
    // No-frontmatter body semantics are unchanged: the whole file, trimmed.
    expect(parsed.body).toBe(content.trim());
    expect(parseStoredMemoryFile(content, join(memoryDir, 'no-fence.md'))).toBeNull();
  });

  it('still rejects a marker-prefixed file whose fence is never closed', () => {
    const content = `${START_MARKER}\n---\nkind: lesson\n\nBody without a closing fence.\n`;
    expect(parseMemoryFrontmatter(content).hasFrontmatter).toBe(false);
  });

  it('leaves a plain `---`-first file unchanged', () => {
    const content = ['---', 'name: plain', 'kind: rule', '---', '', 'Plain body.', ''].join('\n');
    const parsed = parseMemoryFrontmatter(content);

    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.kind).toEqual({ kind: 'rule', source: 'kind', rawKind: 'rule' });
    expect(parsed.frontmatter).toBe('name: plain\nkind: rule');
    expect(parsed.body).toBe('Plain body.');
  });

  it('does not treat leading blank lines alone as a marker prefix', () => {
    // A blank line before the fence is NOT tolerated — behaviour identical to
    // before the fix (the fence must be at byte 0, or after comment lines).
    const content = `\n---\nkind: lesson\n---\n\nBody.\n`;
    expect(parseMemoryFrontmatter(content).hasFrontmatter).toBe(false);
  });
});

describe('reindex no longer reports marker-prefixed memories as unclassified', () => {
  it('indexes a marker-prefixed file that carries a valid kind', () => {
    writeMemory('marker-lesson.md', [
      START_MARKER,
      '---',
      'title: Marker Lesson',
      'kind: lesson',
      '---',
      '',
      'Body text long enough to be summarized.',
      END_MARKER,
      ''
    ].join('\n'));

    const report = executeMemoryReindex({ projectRoot: root, apply: false });

    expect(report.indexed).toBe(1);
    expect(report.unclassified).toEqual([]);
    expect(report.indexedByKind.lesson).toBe(1);
  });

  it('still reports a marker-prefixed file with no resolvable kind', () => {
    writeMemory('marker-unknown.md', [
      START_MARKER,
      '---',
      'title: Marker Unknown',
      'kind: not-a-kind',
      '---',
      '',
      'Body text long enough to be summarized.',
      ''
    ].join('\n'));

    const report = executeMemoryReindex({ projectRoot: root, apply: false });

    expect(report.indexed).toBe(0);
    expect(report.unclassified).toHaveLength(1);
    expect(report.unclassified[0]!.rawKind).toBe('not-a-kind');
  });
});
