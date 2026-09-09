// tests/unit/services/memory/memory-kind-vocabulary.test.ts
//
// Unit tests for the expanded memory-kind vocabulary (slice
// 2026-09-10-memory-vocab-and-rotate, E).
//
// Pins two things:
//   1. the accepted kind set — the single exported constant the parser,
//      index, doctor, and CLI all derive from;
//   2. the hot/warm tier mapping for every accepted kind.
//
// Run with:
//   pnpm vitest run tests/unit/services/memory/memory-kind-vocabulary.test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  executeMemoryReindex,
  HOT_MEMORY_KINDS,
  MEMORY_KIND_TIER,
  PROJECT_MEMORY_KINDS,
  resolveMemoryKind,
  VALID_PROJECT_MEMORY_KINDS,
  WARM_MEMORY_KINDS
} from '~/src/services/memory/project-memory-service/index';

/** The 8 kinds that existed before the slice — must keep working unchanged. */
const ORIGINAL_KINDS = ['project', 'rule', 'decision', 'reference', 'feedback', 'convention', 'module', 'lesson'] as const;

/** Values observed on disk with a real kind the index schema used to reject. */
const EXPANDED_KINDS = [
  'design',
  'handoff',
  'session-handoff',
  'project-todo',
  'publish-closure',
  'project-rule',
  'project-closure',
  'slice-closure',
  'slice-pilot-findings',
  'bug',
  'investigation',
  'technical-pattern',
  'sediment'
] as const;

const HOT = [
  'feedback',
  'decision',
  'rule',
  'convention',
  'module',
  'lesson',
  'bug',
  'investigation',
  'technical-pattern',
  'project-rule'
] as const;

const WARM = [
  'project',
  'reference',
  'design',
  'handoff',
  'session-handoff',
  'project-todo',
  'publish-closure',
  'project-closure',
  'slice-closure',
  'slice-pilot-findings',
  'sediment'
] as const;

describe('memory kind vocabulary', () => {
  it('accepts the original 8 kinds plus the 13 observed values', () => {
    expect([...PROJECT_MEMORY_KINDS].sort()).toEqual([...ORIGINAL_KINDS, ...EXPANDED_KINDS].sort());
    expect(PROJECT_MEMORY_KINDS).toHaveLength(21);
    expect(VALID_PROJECT_MEMORY_KINDS).toHaveLength(21);
  });

  it('keeps every original kind accepted', () => {
    for (const kind of ORIGINAL_KINDS) {
      expect(PROJECT_MEMORY_KINDS).toContain(kind);
    }
  });

  it('pins the hot/warm tier mapping for every kind', () => {
    expect([...HOT_MEMORY_KINDS].sort()).toEqual([...HOT].sort());
    expect([...WARM_MEMORY_KINDS].sort()).toEqual([...WARM].sort());
    for (const kind of HOT) expect(MEMORY_KIND_TIER[kind]).toBe('hot');
    for (const kind of WARM) expect(MEMORY_KIND_TIER[kind]).toBe('warm');
  });

  it('partitions the accepted set into exactly one tier per kind', () => {
    const tiered = [...HOT_MEMORY_KINDS, ...WARM_MEMORY_KINDS];
    expect(tiered.sort()).toEqual([...PROJECT_MEMORY_KINDS].sort());
    expect(new Set(tiered).size).toBe(PROJECT_MEMORY_KINDS.length);
    for (const kind of PROJECT_MEMORY_KINDS) {
      expect(['hot', 'warm']).toContain(MEMORY_KIND_TIER[kind]);
    }
  });

  it('resolves every expanded kind through the shared frontmatter parser', () => {
    for (const kind of EXPANDED_KINDS) {
      const content = ['---', `name: sample-${kind}`, `description: ${kind} sample`, 'metadata:', `  type: ${kind}`, '---', '', 'Body.', ''].join('\n');
      const resolution = resolveMemoryKind(content);
      expect(resolution.kind).toBe(kind);
      expect(resolution.rawKind).toBe(kind);
    }
  });

  it('still reports a genuinely unknown kind as unclassified', () => {
    const content = ['---', 'name: sample', 'description: sample', 'metadata:', '  type: not-a-real-kind', '---', '', 'Body.', ''].join('\n');
    const resolution = resolveMemoryKind(content);
    expect(resolution.kind).toBeNull();
    expect(resolution.rawKind).toBe('not-a-real-kind');
  });
});

describe('expanded kinds in the index', () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-vocab-'));
    memoryDir = join(root, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeMemory(name: string, kind: string): void {
    writeFileSync(join(memoryDir, `${name}.md`), [
      '---',
      `name: ${name}`,
      `description: ${name}`,
      'metadata:',
      `  type: ${kind}`,
      '---',
      '',
      `Body for ${name}.`,
      ''
    ].join('\n'), 'utf8');
  }

  it('indexes every expanded kind into its declared tier bucket', () => {
    for (const kind of EXPANDED_KINDS) writeMemory(`sample-${kind}`, kind);

    const report = executeMemoryReindex({ projectRoot: root, apply: true });
    expect(report.scannedFiles).toBe(EXPANDED_KINDS.length);
    expect(report.indexed).toBe(EXPANDED_KINDS.length);
    expect(report.unclassified).toHaveLength(0);

    const index = JSON.parse(readFileSync(join(memoryDir, 'index.json'), 'utf8')) as {
      hot: Record<string, Array<{ name: string; kind: string }>>;
      warm: Record<string, Array<{ name: string; kind: string }>>;
    };

    for (const kind of EXPANDED_KINDS) {
      const bucket = MEMORY_KIND_TIER[kind] === 'hot' ? index.hot : index.warm;
      expect(bucket[kind], `${kind} should be indexed in ${MEMORY_KIND_TIER[kind]}`).toHaveLength(1);
      expect(bucket[kind]![0]!.kind).toBe(kind);
    }
  });
});
