// tests/unit/services/memory/memory-reindex.test.ts
//
// Unit tests for `peaks memory reindex` (slice
// 2026-09-09-memory-system-overhaul, slice B).
//
// Defects this pins:
//   1. index/disk drift — reindex rebuilds index.json from every file on disk
//   2. silent kind drops — a top-level `kind:` now resolves (was dropped)
//   3. two unsynchronised indexes — MEMORY.md is regenerated from the index
//   4. "do not silently drop" — unclassified files are reported with a reason
//
// Run with:
//   pnpm vitest run tests/unit/services/memory/memory-reindex.test.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  executeMemoryReindex,
  MEMORY_MD_BANNER,
  MEMORY_MD_FILENAME
} from '~/src/services/memory/project-memory-service/index';

let root: string;
let memoryDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-reindex-'));
  memoryDir = join(root, '.peaks', 'memory');
  mkdirSync(memoryDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeMemory(fileName: string, content: string): void {
  writeFileSync(join(memoryDir, fileName), content, 'utf8');
}

const NESTED = [
  '---',
  'name: nested-rule',
  'description: A nested metadata.type memory',
  'metadata:',
  '  type: rule',
  '---',
  '',
  'Nested metadata.type bodies must be indexed.',
  ''
].join('\n');

const TOP_LEVEL_KIND = [
  '---',
  'name: legacy-kind',
  'description: A legacy top-level kind memory',
  'kind: lesson',
  '---',
  '',
  'Top-level kind files used to be dropped silently.',
  ''
].join('\n');

const NO_FRONTMATTER = 'Just a hand-written note with no frontmatter at all.\n';

describe('executeMemoryReindex', () => {
  it('dry-run reports drift without writing index.json or MEMORY.md', () => {
    writeMemory('nested-rule.md', NESTED);
    writeMemory('legacy-kind.md', TOP_LEVEL_KIND);
    writeMemory('no-frontmatter.md', NO_FRONTMATTER);

    const report = executeMemoryReindex({ projectRoot: root, apply: false });

    expect(report.apply).toBe(false);
    expect(report.scannedFiles).toBe(3);
    expect(report.indexed).toBe(2);
    expect(report.indexedByKind.rule).toBe(1);
    expect(report.indexedByKind.lesson).toBe(1);
    expect(report.unclassified).toHaveLength(1);
    expect(report.unclassified[0]!.name).toBe('no-frontmatter');
    expect(report.unclassified[0]!.rawKind).toBeNull();
    expect(report.orphanDisk).toHaveLength(1);
    expect(report.memoryMd.regenerated).toBe(false);

    expect(existsSync(join(memoryDir, 'index.json'))).toBe(false);
    expect(existsSync(join(memoryDir, MEMORY_MD_FILENAME))).toBe(false);
  });

  it('--apply rebuilds index.json and indexes a top-level `kind:` file', () => {
    writeMemory('legacy-kind.md', TOP_LEVEL_KIND);

    const report = executeMemoryReindex({ projectRoot: root, apply: true });
    expect(report.indexed).toBe(1);
    expect(report.writtenFiles).toContain(join(memoryDir, 'index.json'));

    const index = JSON.parse(readFileSync(join(memoryDir, 'index.json'), 'utf8')) as {
      version: number;
      hot: Record<string, Array<{ name: string; kind: string }>>;
      warm: Record<string, Array<{ name: string; kind: string }>>;
    };
    expect(index.version).toBe(1);
    // `lesson` is a hot kind.
    expect(index.hot.lesson).toHaveLength(1);
    expect(index.hot.lesson![0]!.name).toBe('legacy-kind');
    expect(index.hot.lesson![0]!.kind).toBe('lesson');
  });

  it('regenerates MEMORY.md with the do-not-edit banner and one line per entry', () => {
    writeMemory('nested-rule.md', NESTED);
    writeMemory('legacy-kind.md', TOP_LEVEL_KIND);

    executeMemoryReindex({ projectRoot: root, apply: true });

    const markdown = readFileSync(join(memoryDir, MEMORY_MD_FILENAME), 'utf8');
    expect(markdown.startsWith(MEMORY_MD_BANNER)).toBe(true);
    expect(markdown).toContain('## rule (1)');
    expect(markdown).toContain('## lesson (1)');
    expect(markdown).toContain('- [nested-rule](nested-rule.md) — ');
    expect(markdown).toContain('- [legacy-kind](legacy-kind.md) — ');
    // MEMORY.md itself is never indexed as a memory.
    expect(markdown).not.toContain('(MEMORY.md)');
  });

  it('MEMORY.md regeneration is deterministic across runs', () => {
    writeMemory('nested-rule.md', NESTED);
    writeMemory('legacy-kind.md', TOP_LEVEL_KIND);

    executeMemoryReindex({ projectRoot: root, apply: true });
    const first = readFileSync(join(memoryDir, MEMORY_MD_FILENAME), 'utf8');
    executeMemoryReindex({ projectRoot: root, apply: true });
    const second = readFileSync(join(memoryDir, MEMORY_MD_FILENAME), 'utf8');

    expect(second).toBe(first);
  });

  it('reports index entries whose sourcePath no longer exists', () => {
    writeMemory('nested-rule.md', NESTED);
    const vanished = join(memoryDir, 'vanished.md');
    writeFileSync(join(memoryDir, 'index.json'), JSON.stringify({
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      hot: { rule: [{ name: 'vanished', kind: 'rule', description: 'gone', sourcePath: vanished, sourceArtifact: null, updatedAt: '2026-01-01' }] },
      warm: {}
    }, null, 2), 'utf8');

    const report = executeMemoryReindex({ projectRoot: root, apply: false });
    expect(report.orphanIndex).toHaveLength(1);
    expect(report.orphanIndex[0]!.name).toBe('vanished');
    expect(report.orphanIndex[0]!.sourcePath).toBe(vanished);
  });

  it('scans archived/ because the reader includes it', () => {
    mkdirSync(join(memoryDir, 'archived'), { recursive: true });
    writeFileSync(join(memoryDir, 'archived', 'old.md'), NESTED, 'utf8');

    const report = executeMemoryReindex({ projectRoot: root, apply: true });
    expect(report.scannedFiles).toBe(1);
    expect(report.indexed).toBe(1);

    const markdown = readFileSync(join(memoryDir, MEMORY_MD_FILENAME), 'utf8');
    expect(markdown).toContain('(archived/old.md)');
  });

  it('reports an unrecognized kind value instead of inventing a type', () => {
    // `design` became a valid kind in slice 2026-09-10-memory-vocab-and-rotate
    // (E); use a value that is still outside the vocabulary.
    writeMemory('weird.md', [
      '---',
      'name: weird',
      'description: An unknown kind value',
      'metadata:',
      '  type: not-a-real-kind',
      '---',
      '',
      'Body text long enough to be summarized.',
      ''
    ].join('\n'));

    const report = executeMemoryReindex({ projectRoot: root, apply: false });
    expect(report.indexed).toBe(0);
    expect(report.unclassified).toHaveLength(1);
    expect(report.unclassified[0]!.rawKind).toBe('not-a-real-kind');
    expect(report.unclassified[0]!.reason).toContain('unrecognized kind value: not-a-real-kind');
  });
});
