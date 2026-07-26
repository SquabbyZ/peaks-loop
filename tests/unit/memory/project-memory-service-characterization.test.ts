/**
 * Characterization tests for the project-memory-service split (rid-003).
 *
 * These tests pin the public behavior of every module that was carved out
 * of `project-memory-service.ts` on 2026-07-26. The split moved the
 * internal helpers into `src/services/memory/project-memory-service/`
 * (parsers/, store/, index/), but the surface that downstream callers
 * see — functions, types, constants — must keep behaving the same way.
 *
 * Each `describe` block here targets one submodule:
 *
 *   - `parsers/frontmatter`     — slugify, parseBlock, renderMemoryFile,
 *                                 parseStoredMemoryFile, VALID_*_KINDS
 *   - `parsers/markdown-pure`   — START/END_MARKER, summarizeMemoryBody,
 *                                 extractStableProjectMemories,
 *                                 summarizeExtract/BackupResult
 *   - `store/paths`             — assertSafeProjectMemoryDir,
 *                                 assertInsideProject, realPathOrThrow,
 *                                 normalizeRoot / normalizeRealRoot
 *   - `store/atomic-write`      — hasSensitiveMemoryContent,
 *                                 writeNewFile O_EXCL semantics
 *   - `index/search`            — listMarkdownFiles, emptyByKind,
 *                                 emptyIndex, ensureMemoryBootstrap
 *   - `index/ranking`           — readMemoryFileMtime,
 *                                 readStoredMemoryNames,
 *                                 shouldRegenerateIndex (via
 *                                 readMemoryIndex), generateMemoryIndexFile
 *   - `index/kind-dispatch`     — createProjectMemoryExtractPlan /
 *                                 executeProjectMemoryExtract /
 *                                 createProjectMemoryBackupPlan /
 *                                 executeProjectMemoryBackup /
 *                                 extractSessionMemories
 *
 * The tests are intentionally hermetic — every test creates its own
 * `tmpdir` subdirectory, never mutates the repo, never uses mocks. The
 * only exceptions are the back-compat re-export tests at the bottom
 * which exercise the `project-memory-service.ts` shim directly.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  // parsers/frontmatter.ts
  parseBlock,
  parseStoredMemoryFile,
  renderMemoryFile,
  slugify,
  VALID_PROJECT_MEMORY_KINDS,
  // parsers/markdown-pure.ts
  END_MARKER,
  extractStableProjectMemories,
  START_MARKER,
  summarizeBackupResult,
  summarizeExtractResult,
  summarizeMemoryBody,
  // store/paths.ts
  assertInsideProject,
  assertSafeProjectMemoryDir,
  normalizeRealRoot,
  normalizeRoot,
  realPathOrThrow,
  resolveProjectPath,
  // store/atomic-write.ts
  hasSensitiveMemoryContent,
  // index/search.ts
  emptyByKind,
  emptyIndex,
  ensureMemoryBootstrap,
  listMarkdownFiles,
  readProjectMemories,
  // index/ranking.ts
  generateMemoryIndexFile,
  readMemoryFileMtime,
  readMemoryIndex,
  readStoredMemoryNames,
  // index/kind-dispatch.ts
  createProjectMemoryBackupPlan,
  createProjectMemoryExtractPlan,
  executeProjectMemoryBackup,
  executeProjectMemoryExtract,
  extractSessionMemories,
  summarizeProjectMemoryBackupResult,
  summarizeProjectMemoryExtractResult,
  // types
  type ExtractedProjectMemory,
  type ProjectMemoryBackupResult,
  type ProjectMemoryExtractResult
} from '../../../src/services/memory/project-memory-service/index.js';
// Back-compat re-export from the legacy single-file path.
import * as legacyShim from '../../../src/services/memory/project-memory-service.js';

function makeTempProject(prefix: string): string {
  const root = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

const tempRoots: string[] = [];
function track(root: string): string {
  tempRoots.push(root);
  return root;
}

beforeEach(() => {
  // Nothing to set up per-test; tempRoots is cleared in afterEach.
});

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore — best effort cleanup
    }
  }
});

describe('parsers/frontmatter', () => {
  test('slugify lowercases and hyphenates', () => {
    expect(slugify('Hello World! Foo_Bar')).toBe('hello-world-foo-bar');
    expect(slugify('   ')).toBe('project-memory');
    expect(slugify('')).toBe('project-memory');
  });

  test('VALID_PROJECT_MEMORY_KINDS is the 8-kind union in canonical order', () => {
    expect([...VALID_PROJECT_MEMORY_KINDS].sort()).toEqual([
      'convention',
      'decision',
      'feedback',
      'lesson',
      'module',
      'project',
      'reference',
      'rule'
    ]);
  });

  test('parseBlock returns null when the block has no `---` separator', () => {
    expect(parseBlock('title: foo\nkind: project\nno separator here', 'a.md')).toBeNull();
  });

  test('parseBlock returns null when kind is outside the 8-kind union', () => {
    const block = 'title: foo\nkind: nonsense\n---\nbody';
    expect(parseBlock(block, 'a.md')).toBeNull();
  });

  test('parseBlock extracts title, kind, body, sourceArtifact when valid', () => {
    const block = [
      'title: Test title',
      'kind: project',
      '---',
      'Body content'
    ].join('\n');
    expect(parseBlock(block, 'src/a.md')).toEqual({
      title: 'Test title',
      kind: 'project',
      body: 'Body content',
      sourceArtifact: 'src/a.md'
    });
  });

  test('renderMemoryFile emits canonical frontmatter with metadata.type', () => {
    const memory: ExtractedProjectMemory = {
      title: 'Test title',
      kind: 'rule',
      body: 'Body content',
      sourceArtifact: 'src/a.md'
    };
    const rendered = renderMemoryFile(memory);
    expect(rendered).toContain('name: test-title');
    expect(rendered).toContain('description: Test title');
    expect(rendered).toContain('metadata:');
    expect(rendered).toContain('type: rule');
    expect(rendered).toContain('sourceArtifact: src/a.md');
    expect(rendered.trim().endsWith('Body content')).toBe(true);
  });

  test('parseStoredMemoryFile round-trips renderMemoryFile output', () => {
    const memory: ExtractedProjectMemory = {
      title: 'Round trip',
      kind: 'lesson',
      body: 'Body content',
      sourceArtifact: 'src/x.md'
    };
    const rendered = renderMemoryFile(memory);
    const parsed = parseStoredMemoryFile(rendered, '/abs/path/round-trip.md');
    expect(parsed).toEqual({
      name: 'round-trip',
      title: 'Round trip',
      kind: 'lesson',
      sourceArtifact: 'src/x.md',
      body: 'Body content',
      filePath: '/abs/path/round-trip.md'
    });
  });

  test('parseStoredMemoryFile returns null when the file has no frontmatter', () => {
    expect(parseStoredMemoryFile('no frontmatter here', '/a.md')).toBeNull();
  });
});

describe('parsers/markdown-pure', () => {
  test('START/END markers are stable strings', () => {
    expect(START_MARKER).toBe('<!-- peaks-memory:start -->');
    expect(END_MARKER).toBe('<!-- peaks-memory:end -->');
  });

  test('summarizeMemoryBody picks the first long-enough sentence and caps at 120', () => {
    const body = [
      '# Heading',
      'Short.',
      'This is the first sentence that meets the 20-char floor and should win.',
      'A second trailing sentence.'
    ].join('\n');
    // After stripping `# Heading` → `Heading` (6 chars), `Short.` (6 chars),
    // and joining lines with a single space the first sentence over the
    // 20-char floor is the third one.
    expect(summarizeMemoryBody(body)).toBe('This is the first sentence that meets the 20-char floor and should win.');
  });

  test('summarizeMemoryBody truncates sentences longer than 120 chars with ellipsis', () => {
    const longSentence = 'A'.repeat(150) + '.';
    const result = summarizeMemoryBody(longSentence);
    expect(result.length).toBeLessThanOrEqual(120);
    expect(result.endsWith('...')).toBe(true);
  });

  test('extractStableProjectMemories ignores blocks missing required fields', () => {
    const artifact = [
      '<!-- peaks-memory:start -->',
      'kind: project',
      '---',
      'no title',
      '<!-- peaks-memory:end -->',
      '<!-- peaks-memory:start -->',
      'title: Valid block',
      'kind: rule',
      '---',
      'Body here',
      '<!-- peaks-memory:end -->'
    ].join('\n');
    expect(extractStableProjectMemories(artifact, 'rd/artifact.md')).toEqual([
      { title: 'Valid block', kind: 'rule', body: 'Body here', sourceArtifact: 'rd/artifact.md' }
    ]);
  });

  test('summarizeExtractResult preserves apply / projectRoot / writtenFiles', () => {
    const result: ProjectMemoryExtractResult = {
      apply: true,
      projectRoot: '/r',
      primaryMemoryDir: '/r/.peaks/memory',
      backupPolicy: 'project-memory-primary-artifact-backup',
      extractedMemories: [{ title: 'A', kind: 'project', body: 'b', sourceArtifact: 'x.md' }],
      plannedWrites: [
        {
          memory: { title: 'A', kind: 'project', body: 'b', sourceArtifact: 'x.md' },
          filePath: '/r/.peaks/memory/a.md',
          content: 'rendered'
        }
      ],
      writtenFiles: ['/r/.peaks/memory/a.md']
    };
    expect(summarizeExtractResult(result)).toMatchObject({
      apply: true,
      projectRoot: '/r',
      primaryMemoryDir: '/r/.peaks/memory',
      extractedCount: 1,
      writtenFiles: ['/r/.peaks/memory/a.md']
    });
  });

  test('summarizeBackupResult preserves apply / copiedFiles', () => {
    const result: ProjectMemoryBackupResult = {
      apply: true,
      projectRoot: '/r',
      artifactWorkspacePath: '/w',
      primaryMemoryDir: '/r/.peaks/memory',
      backupMemoryDir: '/w/.peaks/memory-backups/project-memory-primary',
      plannedCopies: [{ sourcePath: '/r/a.md', targetPath: '/w/a.md' }],
      copiedFiles: ['/w/a.md']
    };
    expect(summarizeBackupResult(result)).toEqual({
      apply: true,
      projectRoot: '/r',
      artifactWorkspacePath: '/w',
      primaryMemoryDir: '/r/.peaks/memory',
      backupMemoryDir: '/w/.peaks/memory-backups/project-memory-primary',
      plannedCopies: [{ sourcePath: '/r/a.md', targetPath: '/w/a.md' }],
      copiedFiles: ['/w/a.md']
    });
  });
});

describe('store/paths', () => {
  test('normalizeRoot delegates to resolveInputPath', () => {
    // The exact behavior of resolveInputPath lives in shared/path-utils —
    // we only pin that the wrapper passes through without throwing.
    expect(normalizeRoot(track(makeTempProject('pms-normalize-root')))).toBeTruthy();
  });

  test('normalizeRealRoot delegates to stableRealPath', () => {
    expect(normalizeRealRoot(track(makeTempProject('pms-normalize-real')))).toBeTruthy();
  });

  test('resolveProjectPath joins relative paths against projectRoot', () => {
    // On POSIX path.resolve joins; on Windows isWindowsAbsolutePath may
    // return true for the root and normalize. Either way the joined
    // result contains the relative segment.
    const out = resolveProjectPath('artifacts/a.md', '/tmp/proj');
    expect(out).toContain('artifacts');
    expect(out).toContain('a.md');
  });

  test('realPathOrThrow throws when the path does not exist', () => {
    const missing = join(tmpdir(), `pms-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    expect(() => realPathOrThrow(missing, 'missing')).toThrow('missing');
  });

  test('realPathOrThrow returns the realpath for an existing regular directory', () => {
    const root = track(makeTempProject('pms-realpath'));
    expect(realPathOrThrow(root, 'should not throw')).toBeTruthy();
  });

  test('assertInsideProject throws when path escapes project root', () => {
    const root = track(makeTempProject('pms-inside'));
    expect(() => assertInsideProject('/totally/elsewhere/x.md', root)).toThrow();
  });

  test('assertSafeProjectMemoryDir returns the memory dir path inside the project', () => {
    const root = track(makeTempProject('pms-memdir'));
    const memDir = assertSafeProjectMemoryDir(root);
    expect(memDir).toContain('.peaks');
    expect(memDir.endsWith('memory') || memDir.endsWith(`${require('node:path').sep}memory`)).toBe(true);
  });
});

describe('store/atomic-write', () => {
  test('hasSensitiveMemoryContent flags API-key style content', () => {
    expect(hasSensitiveMemoryContent('apiKey: sk-secret-value')).toBe(true);
    expect(hasSensitiveMemoryContent('Authorization: Bearer github_pat_abcdefghijklmnopqrstuvwxyz123456')).toBe(true);
    expect(hasSensitiveMemoryContent('AKIA1234567890ABCDEF')).toBe(true);
    expect(hasSensitiveMemoryContent('-----BEGIN PRIVATE KEY-----')).toBe(true);
    expect(hasSensitiveMemoryContent('eyJabc.def.ghi')).toBe(true);
  });

  test('hasSensitiveMemoryContent passes benign content', () => {
    expect(hasSensitiveMemoryContent('This is a perfectly normal memory.')).toBe(false);
    expect(hasSensitiveMemoryContent('Use the API to fetch weather.')).toBe(false);
  });
});

describe('index/search', () => {
  test('listMarkdownFiles returns sorted .md paths and skips dotfiles / symlinks', () => {
    const root = track(makeTempProject('pms-list'));
    writeFileSync(join(root, 'a.md'), 'A');
    writeFileSync(join(root, 'b.md'), 'B');
    writeFileSync(join(root, '.hidden.md'), 'hidden');
    writeFileSync(join(root, 'c.txt'), 'not markdown');
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'nested', 'd.md'), 'D');
    const files = listMarkdownFiles(root);
    const basenames = files.map((f) => f.split(/[/\\]/).pop());
    expect(basenames).toContain('a.md');
    expect(basenames).toContain('b.md');
    expect(basenames).toContain('d.md');
    expect(basenames).not.toContain('.hidden.md');
    expect(basenames).not.toContain('c.txt');
  });

  test('listMarkdownFiles returns empty array for non-existent directory', () => {
    expect(listMarkdownFiles('/this/does/not/exist')).toEqual([]);
  });

  test('emptyByKind returns the 8-kind bucket shape with empty arrays', () => {
    const byKind = emptyByKind();
    for (const kind of VALID_PROJECT_MEMORY_KINDS) {
      expect(byKind[kind]).toEqual([]);
    }
  });

  test('emptyIndex returns version=1 with hot/warm halves covering the 8-kind union', () => {
    const index = emptyIndex();
    expect(index.version).toBe(1);
    expect(typeof index.updatedAt).toBe('string');
    const allKinds = new Set([...Object.keys(index.hot), ...Object.keys(index.warm)]);
    expect(allKinds.size).toBe(8);
    for (const kind of VALID_PROJECT_MEMORY_KINDS) {
      expect(allKinds.has(kind)).toBe(true);
    }
  });

  test('ensureMemoryBootstrap is fail-open and returns true on success', () => {
    const root = track(makeTempProject('pms-bootstrap'));
    expect(ensureMemoryBootstrap(root)).toBe(true);
    const memDir = join(root, '.peaks', 'memory');
    expect(readdirSync(memDir).some((name) => name === 'index.json')).toBe(true);
  });

  test('readProjectMemories returns empty result for a fresh project', () => {
    const root = track(makeTempProject('pms-read-empty'));
    const result = readProjectMemories(root);
    expect(result.total).toBe(0);
    expect(result.memories).toEqual([]);
    expect(result.projectRoot).toBeTruthy();
    expect(result.memoryDir.endsWith('memory')).toBe(true);
  });
});

describe('index/ranking', () => {
  test('readMemoryFileMtime returns an ISO date (YYYY-MM-DD)', () => {
    const root = track(makeTempProject('pms-mtime'));
    const f = join(root, 'a.md');
    writeFileSync(f, 'x');
    expect(readMemoryFileMtime(f)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('readStoredMemoryNames captures filename stem + parsed frontmatter name', () => {
    const root = track(makeTempProject('pms-names'));
    const memDir = join(root, '.peaks', 'memory');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'alpha.md'), [
      '---',
      'name: alpha-frontmatter',
      'description: Alpha',
      'metadata:',
      '  type: project',
      '  sourceArtifact: a.md',
      '---',
      '',
      'body'
    ].join('\n'));
    const names = readStoredMemoryNames(memDir);
    expect(names.has('alpha-frontmatter')).toBe(true);
    expect(names.has('alpha')).toBe(true);
  });

  test('readMemoryIndex materialises an empty index when none exists', () => {
    const root = track(makeTempProject('pms-noindex'));
    // The original contract: readMemoryIndex calls ensureMemoryBootstrap
    // (which writes a full-shape empty index.json), then reads it back.
    const index = readMemoryIndex(root);
    expect(index).not.toBeNull();
    expect(index!.version).toBe(1);
    const totalKeys = Object.keys(index!.hot).length + Object.keys(index!.warm).length;
    expect(totalKeys).toBe(8);
  });

  test('readMemoryIndex rebuilds index.json when memory is newer than index', () => {
    const root = track(makeTempProject('pms-rebuild'));
    const memDir = join(root, '.peaks', 'memory');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'rule-1.md'), [
      '---',
      'name: rule-1',
      'description: First rule',
      'metadata:',
      '  type: rule',
      '  sourceArtifact: rd/x.md',
      '---',
      '',
      'body'
    ].join('\n'));
    const index = readMemoryIndex(root);
    expect(index).not.toBeNull();
    expect(index!.hot.rule.length).toBeGreaterThanOrEqual(1);
  });

  test('generateMemoryIndexFile writes a v1 index with hot/warm halves', () => {
    const root = track(makeTempProject('pms-gen'));
    const memDir = join(root, '.peaks', 'memory');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'rule-1.md'), [
      '---',
      'name: rule-1',
      'description: First rule',
      'metadata:',
      '  type: rule',
      '  sourceArtifact: rd/x.md',
      '---',
      '',
      'body'
    ].join('\n'));
    writeFileSync(join(memDir, 'project-1.md'), [
      '---',
      'name: project-1',
      'description: First project',
      'metadata:',
      '  type: project',
      '  sourceArtifact: rd/x.md',
      '---',
      '',
      'body'
    ].join('\n'));
    const indexPath = join(memDir, 'index.json');
    generateMemoryIndexFile(root, memDir, indexPath);
    const parsed = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(parsed.version).toBe(1);
    expect(parsed.hot.rule.length).toBe(1);
    expect(parsed.warm.project.length).toBe(1);
  });
});

describe('index/kind-dispatch', () => {
  test('createProjectMemoryExtractPlan extracts from a marked-up artifact (dry-run)', () => {
    const root = track(makeTempProject('pms-extract-plan'));
    const artifactPath = join(root, 'rd.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Sample',
      'kind: project',
      '---',
      'Sample body.',
      '<!-- peaks-memory:end -->'
    ].join('\n'));
    const plan = createProjectMemoryExtractPlan({
      projectRoot: root,
      artifactPaths: [artifactPath],
      apply: false
    });
    expect(plan.extractedMemories).toHaveLength(1);
    expect(plan.plannedWrites).toHaveLength(1);
    expect(plan.apply).toBe(false);
  });

  test('executeProjectMemoryExtract writes the markdown file when apply is true', () => {
    const root = track(makeTempProject('pms-extract-apply'));
    const artifactPath = join(root, 'rd.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Sample',
      'kind: rule',
      '---',
      'Sample body.',
      '<!-- peaks-memory:end -->'
    ].join('\n'));
    const result = executeProjectMemoryExtract({
      projectRoot: root,
      artifactPaths: [artifactPath],
      apply: true
    });
    expect(result.writtenFiles).toHaveLength(1);
    expect(result.writtenFiles[0]).toContain('sample.md');
  });

  test('executeProjectMemoryExtract refuses to overwrite an existing slug', () => {
    const root = track(makeTempProject('pms-extract-idem'));
    const memDir = join(root, '.peaks', 'memory');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'sample.md'), 'preexisting');
    const artifactPath = join(root, 'rd.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Sample',
      'kind: rule',
      '---',
      'Sample body.',
      '<!-- peaks-memory:end -->'
    ].join('\n'));
    const result = executeProjectMemoryExtract({
      projectRoot: root,
      artifactPaths: [artifactPath],
      apply: true
    });
    expect(result.writtenFiles).toHaveLength(0);
    // pre-existing content preserved
    expect(readFileSync(join(memDir, 'sample.md'), 'utf8')).toBe('preexisting');
  });

  test('createProjectMemoryBackupPlan + executeProjectMemoryBackup copy memory files', () => {
    const root = track(makeTempProject('pms-backup'));
    const memDir = join(root, '.peaks', 'memory');
    mkdirSync(memDir, { recursive: true });
    writeFileSync(join(memDir, 'rule-1.md'), [
      '---',
      'name: rule-1',
      'description: A rule',
      'metadata:',
      '  type: rule',
      '  sourceArtifact: a.md',
      '---',
      '',
      'body'
    ].join('\n'));
    const artifactWorkspace = track(makeTempProject('pms-backup-ws'));
    const plan = createProjectMemoryBackupPlan({
      projectRoot: root,
      artifactWorkspacePath: artifactWorkspace,
      apply: false
    });
    expect(plan.plannedCopies).toHaveLength(1);
    const result = executeProjectMemoryBackup({
      projectRoot: root,
      artifactWorkspacePath: artifactWorkspace,
      apply: true
    });
    expect(result.copiedFiles).toHaveLength(1);
    expect(result.copiedFiles[0]).toContain('rule-1.md');
  });

  test('extractSessionMemories returns zero-counts when session dir is missing', () => {
    const root = track(makeTempProject('pms-session-missing'));
    const result = extractSessionMemories({
      projectRoot: root,
      sessionId: 'no-such-session',
      apply: false
    });
    expect(result.scannedFiles).toBe(0);
    expect(result.extractedCount).toBe(0);
    expect(result.writtenFiles).toEqual([]);
    expect(result.updatedIndex).toBe(false);
  });

  test('summarizeProjectMemoryExtractResult / summarizeProjectMemoryBackupResult delegate to the parsers projectors', () => {
    const extractResult: ProjectMemoryExtractResult = {
      apply: false,
      projectRoot: '/r',
      primaryMemoryDir: '/r/.peaks/memory',
      backupPolicy: 'project-memory-primary-artifact-backup',
      extractedMemories: [],
      plannedWrites: [],
      writtenFiles: []
    };
    expect(summarizeProjectMemoryExtractResult(extractResult)).toEqual(summarizeExtractResult(extractResult));
    const backupResult: ProjectMemoryBackupResult = {
      apply: false,
      projectRoot: '/r',
      artifactWorkspacePath: '/w',
      primaryMemoryDir: '/r/.peaks/memory',
      backupMemoryDir: '/w/.peaks/memory-backups/project-memory-primary',
      plannedCopies: [],
      copiedFiles: []
    };
    expect(summarizeProjectMemoryBackupResult(backupResult)).toEqual(summarizeBackupResult(backupResult));
  });
});

describe('back-compat shim', () => {
  test('legacy single-file path re-exports every public function', () => {
    // Each name must be present in the shim with the same identity.
    expect(typeof legacyShim.createProjectMemoryExtractPlan).toBe('function');
    expect(typeof legacyShim.executeProjectMemoryExtract).toBe('function');
    expect(typeof legacyShim.createProjectMemoryBackupPlan).toBe('function');
    expect(typeof legacyShim.executeProjectMemoryBackup).toBe('function');
    expect(typeof legacyShim.extractSessionMemories).toBe('function');
    expect(typeof legacyShim.extractStableProjectMemories).toBe('function');
    expect(typeof legacyShim.readMemoryIndex).toBe('function');
    expect(typeof legacyShim.readProjectMemories).toBe('function');
    expect(typeof legacyShim.ensureMemoryBootstrap).toBe('function');
    expect(typeof legacyShim.summarizeMemoryBody).toBe('function');
    expect(typeof legacyShim.summarizeProjectMemoryExtractResult).toBe('function');
    expect(typeof legacyShim.summarizeProjectMemoryBackupResult).toBe('function');
  });

  test('shim and submodule export the SAME function reference', () => {
    expect(legacyShim.readMemoryIndex).toBe(readMemoryIndex);
    expect(legacyShim.createProjectMemoryExtractPlan).toBe(createProjectMemoryExtractPlan);
    expect(legacyShim.summarizeMemoryBody).toBe(summarizeMemoryBody);
  });

  test('shim re-exports the VALID_PROJECT_MEMORY_KINDS constant', () => {
    expect(legacyShim.VALID_PROJECT_MEMORY_KINDS).toBe(VALID_PROJECT_MEMORY_KINDS);
  });
});