/**
 * Integration test: write 10 project memory files through the public
 * project-memory-service surface, then read them back through every
 * read-side entry point, and verify that metadata (kind, sourceArtifact,
 * name, title, body) round-trips correctly.
 *
 * This test is part of the rid-003 split (2026-07-26) — it exercises
 * the actual filesystem layout that the parsers/, store/, and index/
 * submodules collaborate on. No mocks, no fixtures, no git dependency:
 * each test creates its own `tmpdir` subdirectory and writes real
 * markdown files into it.
 *
 * Coverage:
 *   - write 10 memories via `executeProjectMemoryExtract({ apply: true })`
 *   - read them back via `readProjectMemories`, `readProjectMemoryBody`,
 *     and `readMemoryIndex`
 *   - assert that for every memory: name, title, kind, sourceArtifact,
 *     body match what we wrote
 *   - assert that `byKind` buckets the memories correctly
 *   - assert that `readMemoryIndex` produces a v1 hot/warm index with
 *     entries for every memory
 *   - assert that running `executeProjectMemoryExtract` a second time
 *     on the same artifacts is idempotent (no overwrites, no new writes)
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  ensureMemoryBootstrap,
  executeProjectMemoryExtract,
  readMemoryIndex,
  readProjectMemories,
  readProjectMemoryBody,
  type ExtractedProjectMemory,
  type ProjectMemoryKind
} from '../../src/services/memory/project-memory-service/index.js';

interface MemoryFixture {
  readonly title: string;
  readonly kind: ProjectMemoryKind;
  readonly body: string;
}

const FIXTURES: readonly MemoryFixture[] = [
  { title: 'Provider rotation policy', kind: 'rule', body: 'Rotate provider credentials every 90 days and on role change.' },
  { title: 'CLI_VERSION shared chicken-egg', kind: 'lesson', body: 'peaks-loop imports CLI_VERSION from peaks-loop-shared; the npm pack rewrites the workspace:* dep.' },
  { title: 'Index hot kinds include feedback', kind: 'reference', body: 'feedback, decision, rule, convention, module, lesson are the hot kinds.' },
  { title: 'Apply gates must run before archive', kind: 'convention', body: 'Never archive an OpenSpec change before the Apply gate passes.' },
  { title: 'Marketplace approval chain', kind: 'decision', body: 'Marketplace publishing is only allowed after team publishing succeeds.' },
  { title: 'Refusing content with suspicious patterns', kind: 'feedback', body: 'If a memory body matches a sensitive regex, the extract path throws.' },
  { title: 'Module layout for memory service', kind: 'module', body: 'parsers/, store/, index/, types.ts, index.ts facade.' },
  { title: 'Idempotent re-extract', kind: 'project', body: 'Re-running executeProjectMemoryExtract on the same artifact does not overwrite existing files.' },
  { title: 'Read-side bootstrap creates missing dir', kind: 'rule', body: 'readProjectMemories on a fresh project creates .peaks/memory/ + index.json.' },
  { title: 'Backup workspace must be outside project root', kind: 'reference', body: 'createProjectMemoryBackupPlan throws if artifactWorkspace is inside the project root.' }
];

// The single artifact path the test writes — every fixture will share
// this sourceArtifact in the stored memory and the index.
const ARTIFACT_RELATIVE_PATH = 'artifacts/rd.md';

let projectRoot: string;

beforeEach(() => {
  projectRoot = join(tmpdir(), `peaks-memory-roundtrip-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function buildArtifact(fixtures: readonly MemoryFixture[]): string {
  const blocks = fixtures.map((fixture) => [
    '<!-- peaks-memory:start -->',
    `title: ${fixture.title}`,
    `kind: ${fixture.kind}`,
    '---',
    fixture.body,
    '<!-- peaks-memory:end -->'
  ].join('\n'));
  return blocks.join('\n');
}

describe('project memory filesystem round-trip', () => {
  test('writes 10 memory files, reads them back, validates metadata', () => {
    expect(FIXTURES).toHaveLength(10);

    // 1. Write the artifact that contains 10 stable memory blocks.
    const artifactPath = join(projectRoot, 'artifacts', 'rd.md');
    mkdirSync(join(projectRoot, 'artifacts'), { recursive: true });
    writeFileSync(artifactPath, buildArtifact(FIXTURES), 'utf8');

    // 2. Run the extract path with apply=true so the memory files land
    //    on disk inside .peaks/memory/.
    const result = executeProjectMemoryExtract({
      projectRoot,
      artifactPaths: [artifactPath],
      apply: true
    });

    // 3. Verify the write result.
    expect(result.apply).toBe(true);
    expect(result.writtenFiles).toHaveLength(10);
    for (const writtenPath of result.writtenFiles) {
      expect(existsSync(writtenPath)).toBe(true);
      const { mtimeMs } = statSync(writtenPath);
      expect(mtimeMs).toBeGreaterThan(0);
    }

    // 4. Verify the on-disk directory layout.
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    expect(existsSync(memoryDir)).toBe(true);
    const onDiskFiles = readdirSync(memoryDir).filter((name) => name.endsWith('.md'));
    expect(onDiskFiles).toHaveLength(10);

    // 5. Read everything back through readProjectMemories.
    const readResult = readProjectMemories(projectRoot);
    expect(readResult.total).toBe(10);
    expect(readResult.memories).toHaveLength(10);

    // 6. For every fixture, find the matching stored memory and verify
    //    metadata round-trips exactly (title, kind, body, sourceArtifact).
    for (const fixture of FIXTURES) {
      const stored = readResult.memories.find((memory) => memory.title === fixture.title);
      expect(stored, `no stored memory with title "${fixture.title}"`).toBeDefined();
      expect(stored!.kind).toBe(fixture.kind);
      expect(stored!.body).toBe(fixture.body);
      expect(stored!.sourceArtifact).toBe(ARTIFACT_RELATIVE_PATH);
      // The stored `name` is the slugified title — assert that the
      // file on disk exists with that slug.
      const expectedSlug = stored!.name;
      expect(expectedSlug.length).toBeGreaterThan(0);
      expect(onDiskFiles).toContain(`${expectedSlug}.md`);
    }

    // 7. Verify byKind buckets everything correctly.
    const expectedByKind: Record<ProjectMemoryKind, ExtractedProjectMemory[]> = {
      project: [], rule: [], decision: [], reference: [], feedback: [], convention: [], module: [], lesson: []
    };
    for (const fixture of FIXTURES) {
      expectedByKind[fixture.kind].push({ ...fixture, sourceArtifact: ARTIFACT_RELATIVE_PATH });
    }
    for (const kind of Object.keys(expectedByKind) as ProjectMemoryKind[]) {
      expect(readResult.byKind[kind]).toHaveLength(expectedByKind[kind].length);
    }

    // 8. Verify the index.json generated on extract.
    const index = readMemoryIndex(projectRoot);
    expect(index).not.toBeNull();
    expect(index!.version).toBe(1);
    const allIndexEntries = [
      ...Object.values(index!.hot).flat(),
      ...Object.values(index!.warm).flat()
    ];
    expect(allIndexEntries).toHaveLength(10);
    for (const fixture of FIXTURES) {
      const entry = allIndexEntries.find((e) => e.kind === fixture.kind && e.sourceArtifact === ARTIFACT_RELATIVE_PATH);
      expect(entry, `no index entry for kind=${fixture.kind}`).toBeDefined();
      expect(typeof entry!.description).toBe('string');
      expect(entry!.description.length).toBeGreaterThan(0);
    }

    // 9. Verify readProjectMemoryBody returns the exact body for each
    //    slug (covers the single-memory lookup path).
    for (const memory of readResult.memories) {
      const body = readProjectMemoryBody(projectRoot, memory.name);
      expect(body, `readProjectMemoryBody returned null for "${memory.name}"`).not.toBeNull();
      expect(body!.body).toBe(memory.body);
      expect(body!.kind).toBe(memory.kind);
      expect(body!.title).toBe(memory.title);
      expect(body!.pretty).toBe(true);
    }

    // 10. Verify idempotent re-extract: running executeProjectMemoryExtract
    //     again on the same artifact does NOT overwrite the existing
    //     files (the O_EXCL path must skip them).
    const mtimesBefore = readResult.memories.map((m) => statSync(m.filePath).mtimeMs);
    const reExtractResult = executeProjectMemoryExtract({
      projectRoot,
      artifactPaths: [artifactPath],
      apply: true
    });
    expect(reExtractResult.writtenFiles).toHaveLength(0);
    const reReadResult = readProjectMemories(projectRoot);
    const mtimesAfter = reReadResult.memories.map((m) => statSync(m.filePath).mtimeMs);
    expect(mtimesAfter).toEqual(mtimesBefore);
  });

  test('ensureMemoryBootstrap creates the directory and index on a fresh project', () => {
    // No prior state — neither .peaks/ nor .peaks/memory/ exists.
    expect(existsSync(join(projectRoot, '.peaks'))).toBe(false);

    const ok = ensureMemoryBootstrap(projectRoot);
    expect(ok).toBe(true);

    const memDir = join(projectRoot, '.peaks', 'memory');
    expect(existsSync(memDir)).toBe(true);
    const indexPath = join(memDir, 'index.json');
    expect(existsSync(indexPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(parsed.version).toBe(1);
    // Hot + warm together cover the 8-kind union with empty arrays.
    const totalKeys = Object.keys(parsed.hot).length + Object.keys(parsed.warm).length;
    expect(totalKeys).toBe(8);
  });
});