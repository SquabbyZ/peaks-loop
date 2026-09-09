// tests/unit/services/memory/memory-ingest.test.ts
//
// Unit tests for `peaks memory ingest` (slice
// 2026-09-09-memory-system-overhaul, slice A).
//
// Contract pinned here:
//   - the IDE-side source dir is read-only; writes only land in .peaks/memory
//   - frontmatter is normalized to the peaks contract (metadata.type)
//   - idempotent: byte-identical destinations are skipped
//   - a differing destination is a conflict — both copies are left alone
//   - unresolvable kinds are reported, never invented
//
// Run with:
//   pnpm vitest run tests/unit/services/memory/memory-ingest.test.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultIdeMemoryDir,
  encodeIdeProjectDir,
  executeMemoryIngest
} from '~/src/services/memory/memory-ingest-service';

let projectRoot: string;
let sourceRoot: string;
let sourceDir: string;
let memoryDir: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-ingest-proj-'));
  sourceRoot = mkdtempSync(join(tmpdir(), 'peaks-ingest-src-'));
  sourceDir = join(sourceRoot, 'memory');
  memoryDir = join(projectRoot, '.peaks', 'memory');
  mkdirSync(sourceDir, { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(sourceRoot, { recursive: true, force: true });
});

function writeSource(fileName: string, content: string): void {
  writeFileSync(join(sourceDir, fileName), content, 'utf8');
}

const NESTED_PROJECT = [
  '---',
  'name: nested-project',
  'description: Already in the peaks contract',
  'metadata:',
  '  type: project',
  '---',
  '',
  'A body long enough to be summarized deterministically.',
  ''
].join('\n');

const TOP_LEVEL_KIND = [
  '---',
  'name: legacy-kind',
  'description: Legacy top-level kind',
  'kind: lesson',
  '---',
  '',
  'A body long enough to be summarized deterministically.',
  ''
].join('\n');

describe('encodeIdeProjectDir / defaultIdeMemoryDir', () => {
  it('mirrors Claude Code project-dir encoding', () => {
    expect(encodeIdeProjectDir('D:\\peaks-loop')).toBe('D--peaks-loop');
    expect(encodeIdeProjectDir('/home/me/peaks-loop')).toBe('-home-me-peaks-loop');
  });

  it('resolves the default source dir under the injected home', () => {
    const resolved = defaultIdeMemoryDir('D:\\peaks-loop', '/home/test');
    expect(resolved).toBe(join('/home/test', '.claude', 'projects', 'D--peaks-loop', 'memory'));
  });
});

describe('executeMemoryIngest', () => {
  it('dry-run lists imports without writing anything', () => {
    writeSource('nested-project.md', NESTED_PROJECT);

    const report = executeMemoryIngest({ projectRoot, sourceDir, apply: false });
    expect(report.sourceExists).toBe(true);
    expect(report.scannedFiles).toBe(1);
    expect(report.imported).toHaveLength(1);
    expect(report.imported[0]!.kind).toBe('project');
    expect(report.writtenFiles).toHaveLength(0);
    expect(existsSync(join(memoryDir, 'nested-project.md'))).toBe(false);
  });

  it('--apply normalizes a top-level `kind:` into metadata.type', () => {
    writeSource('legacy-kind.md', TOP_LEVEL_KIND);

    const report = executeMemoryIngest({ projectRoot, sourceDir, apply: true });
    expect(report.imported).toHaveLength(1);
    expect(report.imported[0]!.kind).toBe('lesson');

    const written = readFileSync(join(memoryDir, 'legacy-kind.md'), 'utf8');
    expect(written).toContain('name: legacy-kind');
    expect(written).toContain('metadata:');
    expect(written).toContain('  type: lesson');
    expect(written).not.toMatch(/^kind:/m);
  });

  it('preserves non-contract metadata keys as provenance', () => {
    writeSource('prov.md', [
      '---',
      'name: prov',
      'description: Provenance test',
      'metadata:',
      '  type: rule',
      '  originSessionId: abc-123',
      '  modified: 2026-09-08T00:00:00.000Z',
      '---',
      '',
      'A body long enough to be summarized deterministically.',
      ''
    ].join('\n'));

    executeMemoryIngest({ projectRoot, sourceDir, apply: true });
    const written = readFileSync(join(memoryDir, 'prov.md'), 'utf8');
    expect(written).toContain('  type: rule');
    expect(written).toContain('  originSessionId: abc-123');
    expect(written).toContain('  modified: 2026-09-08T00:00:00.000Z');
  });

  it('is idempotent: a second run skips the byte-identical destination', () => {
    writeSource('nested-project.md', NESTED_PROJECT);

    const first = executeMemoryIngest({ projectRoot, sourceDir, apply: true });
    expect(first.imported).toHaveLength(1);

    const second = executeMemoryIngest({ projectRoot, sourceDir, apply: true });
    expect(second.imported).toHaveLength(0);
    expect(second.skippedIdentical).toHaveLength(1);
    expect(second.conflicts).toHaveLength(0);
    expect(second.writtenFiles).toHaveLength(0);
  });

  it('leaves both copies when the destination differs (conflict)', () => {
    writeSource('nested-project.md', NESTED_PROJECT);
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'nested-project.md'), '---\nname: nested-project\nmetadata:\n  type: rule\n---\n\nUser-authored local copy.\n', 'utf8');

    const report = executeMemoryIngest({ projectRoot, sourceDir, apply: true });
    expect(report.imported).toHaveLength(0);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]!.reason).toContain('different content');

    // Destination untouched, source untouched.
    expect(readFileSync(join(memoryDir, 'nested-project.md'), 'utf8')).toContain('User-authored local copy.');
    expect(readFileSync(join(sourceDir, 'nested-project.md'), 'utf8')).toBe(NESTED_PROJECT);
  });

  it('reports a source file with no resolvable kind', () => {
    writeSource('plain.md', 'A plain note with no frontmatter.\n');

    const report = executeMemoryIngest({ projectRoot, sourceDir, apply: true });
    expect(report.imported).toHaveLength(0);
    expect(report.needsClassification).toHaveLength(1);
    expect(report.needsClassification[0]!.name).toBe('plain');
    expect(report.needsClassification[0]!.rawKind).toBeNull();
  });

  it('never writes into the IDE-side source directory', () => {
    writeSource('nested-project.md', NESTED_PROJECT);
    writeSource('MEMORY.md', '# IDE index\n');
    const before = readdirSync(sourceDir).sort();

    executeMemoryIngest({ projectRoot, sourceDir, apply: true });

    expect(readdirSync(sourceDir).sort()).toEqual(before);
  });

  it('skips the IDE-side MEMORY.md index and says so', () => {
    writeSource('MEMORY.md', '# IDE index\n');
    writeSource('nested-project.md', NESTED_PROJECT);

    const report = executeMemoryIngest({ projectRoot, sourceDir, apply: true });
    expect(report.scannedFiles).toBe(1);
    expect(report.warnings.join(' ')).toContain('MEMORY.md');
  });

  it('returns an empty, warned report when the source dir is missing', () => {
    const report = executeMemoryIngest({ projectRoot, sourceDir: join(sourceRoot, 'nope'), apply: true });
    expect(report.sourceExists).toBe(false);
    expect(report.imported).toHaveLength(0);
    expect(report.warnings).toHaveLength(1);
  });

  it('refuses sensitive source content instead of importing it', () => {
    writeSource('secret.md', [
      '---',
      'name: secret',
      'description: Contains a credential',
      'metadata:',
      '  type: reference',
      '---',
      '',
      'api_key: sk-abcdef1234567890',
      ''
    ].join('\n'));

    const report = executeMemoryIngest({ projectRoot, sourceDir, apply: true });
    expect(report.imported).toHaveLength(0);
    expect(report.refused).toHaveLength(1);
    expect(existsSync(join(memoryDir, 'secret.md'))).toBe(false);
  });
});
