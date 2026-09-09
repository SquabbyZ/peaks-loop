// tests/unit/services/memory/memory-name-fallback.test.ts
//
// Unit tests for the stored-memory name fallback chain (slice
// 2026-09-10-memory-name-fallback).
//
// Defect pinned: `parseStoredMemoryFile` required a `name:` frontmatter field
// and silently rejected a file that had a valid kind but only a `title:`
// field — 5 files on disk were never indexed. The reader now resolves
// `name:` → `title:` → filename stem, deterministically, and reindex reports
// any name collision across files instead of letting one entry shadow another.
//
// Run with:
//   pnpm vitest run tests/unit/services/memory/memory-name-fallback.test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  executeMemoryReindex,
  parseMemoryFrontmatter,
  parseStoredMemoryFile,
  resolveMemoryName
} from '~/src/services/memory/project-memory-service/index';

let root: string;
let memoryDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-name-fallback-'));
  memoryDir = join(root, '.peaks', 'memory');
  mkdirSync(memoryDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeMemory(fileName: string, content: string): void {
  writeFileSync(join(memoryDir, fileName), content, 'utf8');
}

function frontmatter(lines: readonly string[], body = 'Body text long enough to be summarized.'): string {
  return ['---', ...lines, '---', '', body, ''].join('\n');
}

describe('name fallback chain (name -> title -> filename stem)', () => {
  it('prefers `name:` when present', () => {
    const parsed = parseStoredMemoryFile(frontmatter(['name: canonical', 'title: A Title', 'kind: lesson']), join(memoryDir, 'some-stem.md'));
    expect(parsed?.name).toBe('canonical');
  });

  it('falls back to `title:` when `name:` is absent (the on-disk defect shape)', () => {
    const filePath = join(memoryDir, 'rid-001-closeout.md');
    const parsed = parseStoredMemoryFile(frontmatter(['title: rid-001 envelope closure closeout', 'kind: sediment']), filePath);
    expect(parsed).not.toBeNull();
    expect(parsed?.name).toBe('rid-001 envelope closure closeout');
    expect(parsed?.kind).toBe('sediment');
  });

  it('falls back to the filename stem when neither `name:` nor `title:` exists', () => {
    const filePath = join(memoryDir, 'stem-only-memory.md');
    const parsed = parseStoredMemoryFile(frontmatter(['kind: lesson']), filePath);
    expect(parsed?.name).toBe('stem-only-memory');
  });

  it('skips an empty `name:` and continues down the chain', () => {
    const filePath = join(memoryDir, 'empty-name.md');
    const parsed = parseStoredMemoryFile(frontmatter(['name:', 'title: Real Title', 'kind: lesson']), filePath);
    expect(parsed?.name).toBe('Real Title');
  });

  it('does not treat a nested `metadata.title` as a name fallback', () => {
    const filePath = join(memoryDir, 'nested-title.md');
    const parsed = parseStoredMemoryFile(frontmatter(['kind: lesson', 'metadata:', '  title: Nested Title']), filePath);
    expect(parsed?.name).toBe('nested-title');
  });

  it('still rejects a file with no frontmatter at all', () => {
    expect(parseStoredMemoryFile('Hand-written note, no frontmatter.\n', join(memoryDir, 'x.md'))).toBeNull();
  });

  it('resolveMemoryName reports which source won', () => {
    const parsed = parseMemoryFrontmatter(frontmatter(['title: A Title', 'kind: lesson']));
    expect(resolveMemoryName(parsed, join(memoryDir, 'stem.md'))).toEqual({ name: 'A Title', source: 'title' });
    expect(resolveMemoryName(parseMemoryFrontmatter(frontmatter(['kind: lesson'])), join(memoryDir, 'stem.md')))
      .toEqual({ name: 'stem', source: 'stem' });
  });
});

describe('reindex reports name conflicts instead of shadowing an entry', () => {
  it('reports two files that resolve to the same explicit `name:`', () => {
    writeMemory('alpha.md', frontmatter(['name: dup', 'kind: lesson']));
    writeMemory('beta.md', frontmatter(['name: dup', 'kind: lesson']));

    const report = executeMemoryReindex({ projectRoot: root, apply: false });

    expect(report.indexed).toBe(2);
    expect(report.nameConflicts).toHaveLength(1);
    expect(report.nameConflicts[0]!.name).toBe('dup');
    expect(report.nameConflicts[0]!.filePaths).toEqual([
      join(memoryDir, 'alpha.md'),
      join(memoryDir, 'beta.md')
    ]);
  });

  it('reports a fallback-driven collision (title of one file vs name of another)', () => {
    writeMemory('alpha.md', frontmatter(['title: shared', 'kind: lesson']));
    writeMemory('beta.md', frontmatter(['name: shared', 'kind: lesson']));

    const report = executeMemoryReindex({ projectRoot: root, apply: true });

    expect(report.nameConflicts).toHaveLength(1);
    expect(report.nameConflicts[0]!.filePaths).toHaveLength(2);

    // Both files keep their own index entry — the conflict is reported, not
    // resolved by overwriting one of them.
    const index = JSON.parse(readFileSync(join(memoryDir, 'index.json'), 'utf8')) as {
      hot: Record<string, Array<{ name: string; sourcePath: string }>>;
    };
    expect(index.hot.lesson).toHaveLength(2);
    expect(index.hot.lesson!.map((entry) => entry.sourcePath).sort()).toEqual([
      join(memoryDir, 'alpha.md'),
      join(memoryDir, 'beta.md')
    ]);
  });

  it('reports no conflict when every resolved name is unique', () => {
    writeMemory('alpha.md', frontmatter(['name: alpha', 'kind: lesson']));
    writeMemory('beta.md', frontmatter(['title: beta', 'kind: lesson']));
    writeMemory('gamma.md', frontmatter(['kind: lesson']));

    const report = executeMemoryReindex({ projectRoot: root, apply: false });

    expect(report.nameConflicts).toEqual([]);
    expect(report.indexed).toBe(3);
  });
});
