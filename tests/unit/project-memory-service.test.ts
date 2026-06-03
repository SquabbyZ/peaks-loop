import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { platform, tmpdir } from 'node:os';
import { describe, expect, test, vi } from 'vitest';
import {
  createProjectMemoryBackupPlan,
  createProjectMemoryExtractPlan,
  ensureMemoryBootstrap,
  executeProjectMemoryBackup,
  executeProjectMemoryExtract,
  extractSessionMemories,
  extractStableProjectMemories,
  readMemoryIndex,
  readProjectMemories
} from '../../src/services/memory/project-memory-service.js';

function createTempDir(prefix: string): string {
  const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(path, { recursive: true });
  return path;
}

describe('project memory service', () => {
  test('extracts only explicitly marked stable project memories', () => {
    const artifact = [
      'temporary notes should be ignored',
      '<!-- peaks-memory:start -->',
      'title: Ice Cola skill lifecycle',
      'kind: project',
      '---',
      'Skill must move personal -> team -> marketplace. Personal skills cannot publish directly to marketplace.',
      '<!-- peaks-memory:end -->',
      'stack traces and logs should be ignored'
    ].join('\n');

    const memories = extractStableProjectMemories(artifact, 'rd/artifact.md');

    expect(memories).toEqual([
      {
        title: 'Ice Cola skill lifecycle',
        kind: 'project',
        body: 'Skill must move personal -> team -> marketplace. Personal skills cannot publish directly to marketplace.',
        sourceArtifact: 'rd/artifact.md'
      }
    ]);
  });

  test('parses CRLF memory blocks', () => {
    const artifact = [
      '<!-- peaks-memory:start -->',
      'title: CRLF memory',
      'kind: decision',
      '---',
      'Stable memory body',
      '<!-- peaks-memory:end -->'
    ].join('\r\n');

    const memories = extractStableProjectMemories(artifact, 'rd/crlf.md');

    expect(memories).toHaveLength(1);
    expect(memories[0]?.title).toBe('CRLF memory');
  });

  test('plans project .peaks/memory as the primary write target', () => {
    const projectRoot = createTempDir('peaks-memory-project');
    const artifactPath = join(projectRoot, '.peaks', 'changes', 'slice-1', 'rd.md');
    mkdirSync(join(projectRoot, '.peaks', 'changes', 'slice-1'), { recursive: true });
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Team approval boundary',
      'kind: rule',
      '---',
      'Team skill approval requires team admin or owner.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const plan = createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [artifactPath], apply: false });

    expect(plan.apply).toBe(false);
    expect(plan.primaryMemoryDir).toBe(join(projectRoot, '.peaks', 'memory'));
    expect(plan.backupPolicy).toBe('project-memory-primary-artifact-backup');
    expect(plan.extractedMemories).toHaveLength(1);
    expect(plan.plannedWrites[0]?.filePath).toBe(join(projectRoot, '.peaks', 'memory', 'team-approval-boundary.md'));
    expect(existsSync(join(projectRoot, '.peaks', 'memory', 'team-approval-boundary.md'))).toBe(false);
  });

  test('supports relative artifact paths and default dry-run apply values', () => {
    const projectRoot = createTempDir('peaks-memory-relative');
    const artifactWorkspace = createTempDir('peaks-memory-relative-artifacts');
    const relativeArtifactPath = join('artifacts', 'rd.md');
    const artifactPath = join(projectRoot, relativeArtifactPath);
    mkdirSync(join(projectRoot, 'artifacts'), { recursive: true });
    mkdirSync(join(projectRoot, '.peaks', 'memory'), { recursive: true });
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Relative artifact memory',
      'kind: project',
      '---',
      'Relative artifact paths resolve from the project root.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const extractPlan = createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [relativeArtifactPath] });
    const backupPlan = createProjectMemoryBackupPlan({ projectRoot, artifactWorkspacePath: artifactWorkspace });

    expect(extractPlan.apply).toBe(false);
    expect(extractPlan.extractedMemories[0]?.sourceArtifact).toBe('artifacts/rd.md');
    expect(backupPlan.apply).toBe(false);
  });

  test('resolves relative artifact paths against a non-Windows project root', () => {
    const projectRoot = createTempDir('peaks-memory-unix-project');
    const relativeArtifactPath = join('artifacts', 'unix.md');
    const artifactPath = join(projectRoot, relativeArtifactPath);
    mkdirSync(join(projectRoot, 'artifacts'), { recursive: true });
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Unix relative memory',
      'kind: project',
      '---',
      'Relative artifact paths resolve through resolve().',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const plan = createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [relativeArtifactPath], apply: false });

    expect(plan.extractedMemories[0]?.sourceArtifact).toBe('artifacts/unix.md');
  });

  test('resolves relative artifact paths for a mocked non-Windows project root', async () => {
    vi.resetModules();
    vi.doMock('../../src/shared/path-utils.js', async () => {
      const actual = await vi.importActual<typeof import('../../src/shared/path-utils.js')>('../../src/shared/path-utils.js');
      return {
        ...actual,
        isWindowsAbsolutePath: () => false,
        isInsidePath: (childPath: string, parentPath: string) => childPath === parentPath || childPath.startsWith(`${parentPath}/`),
        normalizePath: (value: string) => value.replaceAll('\\', '/'),
        resolveInputPath: (value: string) => value.replaceAll('\\', '/'),
        stableRealPath: (value: string) => value.replaceAll('\\', '/')
      };
    });
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      const normalizeMockPath = (value: unknown) => String(value).replaceAll('\\', '/').replace(/^[A-Za-z]:/, '');
      const projectRoot = '/tmp/project';
      const artifactPath = '/tmp/project/artifacts/unix.md';
      const knownPaths = new Set([projectRoot, artifactPath]);
      return {
        ...actual,
        existsSync: (path: Parameters<typeof actual.existsSync>[0]) => knownPaths.has(normalizeMockPath(path)),
        lstatSync: (path: Parameters<typeof actual.lstatSync>[0]) => {
          const normalizedPath = normalizeMockPath(path);
          if (!knownPaths.has(normalizedPath)) {
            throw new Error(`Unexpected path: ${normalizedPath}`);
          }
          return { isSymbolicLink: () => false } as ReturnType<typeof actual.lstatSync>;
        },
        realpathSync: (path: Parameters<typeof actual.realpathSync>[0]) => {
          const normalizedPath = normalizeMockPath(path);
          if (!knownPaths.has(normalizedPath)) {
            throw new Error(`Unexpected path: ${normalizedPath}`);
          }
          return normalizedPath;
        },
        readdirSync: () => [],
        readFileSync: (path: Parameters<typeof actual.readFileSync>[0]) => {
          if (normalizeMockPath(path) !== artifactPath) {
            throw new Error(`Unexpected path: ${String(path)}`);
          }
          return [
            '<!-- peaks-memory:start -->',
            'title: Mocked relative memory',
            'kind: project',
            '---',
            'Relative artifact paths resolve through resolve().',
            '<!-- peaks-memory:end -->'
          ].join('\n');
        }
      };
    });

    try {
      const { createProjectMemoryExtractPlan: createMockedProjectMemoryExtractPlan } = await import('../../src/services/memory/project-memory-service.js');
      const plan = createMockedProjectMemoryExtractPlan({ projectRoot: '/tmp/project', artifactPaths: ['artifacts/unix.md'], apply: false });

      expect(plan.extractedMemories[0]?.sourceArtifact).toBe('artifacts/unix.md');
    } finally {
      vi.doUnmock('../../src/shared/path-utils.js');
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('normalizes absolute artifact paths while resolving extraction plans', () => {
    const projectRoot = createTempDir('peaks-memory-absolute');
    const artifactPath = join(projectRoot, 'artifact.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Absolute artifact memory',
      'kind: project',
      '---',
      'Absolute artifact paths resolve directly.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const plan = createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [artifactPath], apply: false });

    expect(plan.extractedMemories[0]?.sourceArtifact).toBe('artifact.md');
  });

  test.runIf(platform() === 'win32')('supports drive-letter absolute artifact paths', () => {
    const projectRoot = createTempDir('peaks-memory-drive-letter');
    const artifactPath = join(projectRoot, 'artifact.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Drive letter memory',
      'kind: project',
      '---',
      'Drive-letter absolute paths resolve directly.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const plan = createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [artifactPath], apply: false });

    expect(plan.extractedMemories[0]?.sourceArtifact).toBe('artifact.md');
  });

  test.runIf(platform() === 'win32')('supports drive-rooted absolute artifact paths', () => {
    const projectRoot = createTempDir('peaks-memory-drive-rooted');
    const artifactPath = join(projectRoot, 'artifact.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Drive rooted memory',
      'kind: project',
      '---',
      'Drive-rooted absolute paths resolve from the current drive.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const driveRootedArtifact = artifactPath.slice(2);
    const plan = createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [driveRootedArtifact], apply: false });

    expect(plan.extractedMemories[0]?.sourceArtifact).toBe('artifact.md');
  });

  test('writes extracted memories only when apply is true and keeps output deterministic', () => {
    const projectRoot = createTempDir('peaks-memory-apply');
    const artifactPath = join(projectRoot, 'artifacts', 'qa.md');
    mkdirSync(join(projectRoot, 'artifacts'), { recursive: true });
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Marketplace approval chain',
      'kind: decision',
      '---',
      'Marketplace publishing is only allowed after team publishing succeeds.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const result = executeProjectMemoryExtract({ projectRoot, artifactPaths: [artifactPath], apply: true });
    const memoryPath = join(projectRoot, '.peaks', 'memory', 'marketplace-approval-chain.md');

    expect(result.writtenFiles.map((filePath) => filePath.replaceAll('\\', '/'))).toEqual([memoryPath.replaceAll('\\', '/')]);
    expect(readFileSync(memoryPath, 'utf8')).toContain('name: marketplace-approval-chain');
    expect(readFileSync(memoryPath, 'utf8')).toContain('Marketplace publishing is only allowed after team publishing succeeds.');
  });

  test('rejects sensitive extracted memory content', () => {
    const projectRoot = createTempDir('peaks-memory-secret');
    const artifactPath = join(projectRoot, 'artifact.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Provider token',
      'kind: project',
      '---',
      'apiKey: sk-secret-value',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    expect(() => createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [artifactPath], apply: false })).toThrow('Refusing to store sensitive memory content');
  });

  test('rejects common provider token formats in extracted memory content', () => {
    const projectRoot = createTempDir('peaks-memory-provider-secrets');
    const artifactPath = join(projectRoot, 'artifact.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: GitHub provider token',
      'kind: project',
      '---',
      'Authorization: Bearer github_pat_abcdefghijklmnopqrstuvwxyz123456',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    expect(() => createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [artifactPath], apply: false })).toThrow('Refusing to store sensitive memory content');
  });

  test('does not overwrite existing project memory files (idempotent on re-extract)', () => {
    // peaks-solo / peaks-txt may run `peaks memory extract --apply` more
    // than once on the same handoff (e.g. handoff is edited and
    // re-extracted). The CLI must skip writes for memories whose slug
    // already lives in .peaks/memory/ and not abort the batch. This
    // matches extractSessionMemories' behaviour and is what the skill
    // prompt relies on for retry safety.
    const projectRoot = createTempDir('peaks-memory-existing-target');
    const artifactPath = join(projectRoot, 'artifact.md');
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'existing-memory.md'), 'existing memory', 'utf8');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Existing memory',
      'kind: project',
      '---',
      'New memory should not overwrite existing memory.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    // No throw. writtenFiles is empty because the slug was already on disk.
    const result = executeProjectMemoryExtract({ projectRoot, artifactPaths: [artifactPath], apply: true });
    expect(result.writtenFiles).toEqual([]);
    // The pre-existing markdown is preserved byte-for-byte.
    expect(readFileSync(join(memoryDir, 'existing-memory.md'), 'utf8')).toBe('existing memory');
  });

  test('idempotent re-run on the same handoff writes zero new files but still regenerates the index', () => {
    // Re-running peaks memory extract --apply on an already-extracted
    // handoff is a normal peaks-solo retry pattern. The second run must
    // succeed (no EEXIST), report writtenFiles=[], and still leave the
    // index.json in a consistent state. Without the index regen on
    // idempotent re-runs, downstream readers could see a stale index if
    // the on-disk .md files were hand-edited between runs.
    const projectRoot = createTempDir('peaks-memory-idempotent');
    const artifactPath = join(projectRoot, 'handoff.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Stable fact about the project',
      'kind: convention',
      '---',
      'This is the body of the stable convention.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const first = executeProjectMemoryExtract({ projectRoot, artifactPaths: [artifactPath], apply: true });
    expect(first.writtenFiles).toHaveLength(1);

    // Second run — same handoff, same apply. Must not throw.
    const second = executeProjectMemoryExtract({ projectRoot, artifactPaths: [artifactPath], apply: true });
    expect(second.writtenFiles).toEqual([]);

    // Index still has the single entry and a version=1 shape.
    const indexPath = join(projectRoot, '.peaks', 'memory', 'index.json');
    const indexRaw = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(indexRaw.version).toBe(1);
    expect(indexRaw.hot.convention).toHaveLength(1);
    expect(indexRaw.hot.convention[0].name).toBe('stable-fact-about-the-project');
  });

  test('rejects duplicate memory titles', () => {
    const projectRoot = createTempDir('peaks-memory-duplicate');
    const artifactDir = join(projectRoot, 'artifacts');
    mkdirSync(artifactDir, { recursive: true });
    const firstArtifact = join(artifactDir, 'first.md');
    const secondArtifact = join(artifactDir, 'second.md');
    const block = [
      '<!-- peaks-memory:start -->',
      'title: Duplicate memory',
      'kind: rule',
      '---',
      'Stable body',
      '<!-- peaks-memory:end -->'
    ].join('\n');
    writeFileSync(firstArtifact, block, 'utf8');
    writeFileSync(secondArtifact, block, 'utf8');

    expect(() => createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [firstArtifact, secondArtifact], apply: false })).toThrow('Duplicate memory titles are not allowed');
  });

  test('extractSessionMemories is idempotent across repeated runs of the same session', () => {
    const projectRoot = createTempDir('peaks-memory-session-idempotent');
    const sessionDir = join(projectRoot, '.peaks', 'session-abc');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'note.md'), [
      '<!-- peaks-memory:start -->',
      'title: Session probe',
      'kind: feedback',
      '---',
      'Stable memory body',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const first = extractSessionMemories({ projectRoot, sessionId: 'session-abc', apply: true });
    const second = extractSessionMemories({ projectRoot, sessionId: 'session-abc', apply: true });

    expect(first.extractedCount).toBe(1);
    expect(first.writtenFiles).toHaveLength(1);
    expect(second.extractedCount).toBe(1);
    expect(second.writtenFiles).toHaveLength(0);
    expect(readFileSync(first.writtenFiles[0]!, 'utf8')).toContain('Stable memory body');
  });

  test('extractSessionMemories rejects session ids that resolve outside the project root', () => {
    const projectRoot = createTempDir('peaks-memory-session-escape');
    // Sibling of projectRoot (real directory that exists, but is not a
    // descendant of projectRoot). We put a memory block in it so the
    // scanner has something to find IF the guard is missing.
    const outsideDir = createTempDir('peaks-memory-escape-target');
    writeFileSync(join(outsideDir, 'note.md'), [
      '<!-- peaks-memory:start -->',
      'title: Escape attempt',
      'kind: feedback',
      '---',
      'should never be read',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    // Build a sessionId whose joined path resolves to outsideDir (a real
    // sibling), so the scanner would happily walk it without the guard.
    // .peaks/../<outsideBase> collapses to .peaks/<outsideBase>, then we
    // add an extra .. to climb out of projectRoot.
    const sessionId = join('..', '..', basename(outsideDir));
    const joined = join(projectRoot, '.peaks', sessionId);

    expect(existsSync(joined)).toBe(true); // sanity: confirms escape path is reachable

    expect(() => extractSessionMemories({ projectRoot, sessionId, apply: false }))
      .toThrow('Session directory must stay inside the project root');

    try { rmSync(outsideDir, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
  });

  test('readMemoryIndex exposes a hot entry per memory with kind, description, sourcePath, and mtime', () => {
    const projectRoot = createTempDir('peaks-memory-index-shape');
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    const before = new Date().toISOString().slice(0, 10);
    writeFileSync(join(memoryDir, 'feedback-example.md'), [
      '---',
      'name: feedback-example',
      'description: Feedback example',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      'Multi sentence body that is longer than twenty characters. Second sentence here.',
      ''
    ].join('\n'), 'utf8');

    const index = readMemoryIndex(projectRoot);
    expect(index).not.toBeNull();
    const entry = index!.hot.feedback.find((e) => e.name === 'feedback-example');
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe('feedback');
    expect(entry!.sourcePath).toBe(join(memoryDir, 'feedback-example.md'));
    expect(entry!.sourceArtifact).toBe('rd/artifact.md');
    expect(entry!.updatedAt).toBe(before);
    expect(entry!.description.length).toBeGreaterThan(20);
  });

  test('extractSessionMemories dry-run returns planned writes without touching the filesystem', () => {
    const projectRoot = createTempDir('peaks-memory-session-dry-run');
    const sessionDir = join(projectRoot, '.peaks', 'session-dry');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'note.md'), [
      '<!-- peaks-memory:start -->',
      'title: Dry run probe',
      'kind: feedback',
      '---',
      'Body for dry run',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const result = extractSessionMemories({ projectRoot, sessionId: 'session-dry', apply: false });
    const memoryDir = join(projectRoot, '.peaks', 'memory');

    expect(result.extractedCount).toBe(1);
    expect(result.writtenFiles).toHaveLength(0);
    expect(result.updatedIndex).toBe(false);
    expect(existsSync(join(memoryDir, 'dry-run-probe.md'))).toBe(false);
  });

  test('ignores malformed and incomplete memory blocks', () => {
    const memories = extractStableProjectMemories([
      '<!-- peaks-memory:start -->',
      'title: Missing separator',
      'kind: project',
      'Stable body',
      '<!-- peaks-memory:end -->',
      '<!-- peaks-memory:start -->',
      'title: Invalid kind',
      'kind: unknown',
      '---',
      'Stable body',
      '<!-- peaks-memory:end -->',
      '<!-- peaks-memory:start -->',
      'title: Empty body',
      'kind: rule',
      '---',
      '<!-- peaks-memory:end -->',
      '<!-- peaks-memory:start -->',
      'title: Incomplete memory',
      'kind: decision',
      '---',
      'No end marker'
    ].join('\n'), 'artifact.md');

    expect(memories).toEqual([]);
  });

  test('uses a fallback slug for titles without alphanumeric characters', () => {
    const projectRoot = createTempDir('peaks-memory-fallback-slug');
    const artifactPath = join(projectRoot, 'artifact.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: !!!',
      'kind: project',
      '---',
      'Stable punctuation-only title memory.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const plan = createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [artifactPath], apply: false });

    expect(plan.plannedWrites[0]?.filePath).toBe(join(projectRoot, '.peaks', 'memory', 'project-memory.md'));
  });

  test('rejects missing and outside-project artifact paths', () => {
    const projectRoot = createTempDir('peaks-memory-paths');
    const externalRoot = createTempDir('peaks-memory-outside');
    const externalArtifact = join(externalRoot, 'artifact.md');
    writeFileSync(externalArtifact, 'outside', 'utf8');

    expect(() => createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [join(projectRoot, 'missing.md')], apply: false })).toThrow('Artifact path must stay inside the project root');
    expect(() => createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [externalArtifact], apply: false })).toThrow('Artifact path must stay inside the project root');
  });

  test('rejects sensitive memory titles and backup file contents', () => {
    const projectRoot = createTempDir('peaks-memory-sensitive-title');
    const artifactPath = join(projectRoot, 'artifact.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: provider.apiKey',
      'kind: project',
      '---',
      'Stable body without secret values.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    expect(() => createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [artifactPath], apply: false })).toThrow('Refusing to store sensitive memory content');

    const artifactWorkspace = createTempDir('peaks-memory-sensitive-backup');
    mkdirSync(join(projectRoot, '.peaks', 'memory'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'memory', 'secret.md'), 'token: should-not-back-up', 'utf8');

    expect(() => createProjectMemoryBackupPlan({ projectRoot, artifactWorkspacePath: artifactWorkspace, apply: false })).toThrow('Refusing to back up sensitive memory content');
  });

  test.runIf(platform() !== 'win32')('rejects symlinked artifact paths outside the project', () => {
    const projectRoot = createTempDir('peaks-memory-symlink');
    const externalDir = createTempDir('peaks-memory-external');
    const artifactDir = join(projectRoot, 'artifacts');
    mkdirSync(artifactDir, { recursive: true });
    const externalFile = join(externalDir, 'leak.md');
    writeFileSync(externalFile, [
      '<!-- peaks-memory:start -->',
      'title: Linked memory',
      'kind: project',
      '---',
      'Should not be readable through symlink',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');
    const symlinkPath = join(artifactDir, 'linked.md');
    symlinkSync(externalFile, symlinkPath);

    expect(() => createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [symlinkPath], apply: false })).toThrow('Artifact path must stay inside the project root');
  });

  test.runIf(platform() !== 'win32')('rejects symlinked project memory directories', () => {
    const projectRoot = createTempDir('peaks-memory-project-link');
    const externalMemoryRoot = createTempDir('peaks-memory-external-root');
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    mkdirSync(externalMemoryRoot, { recursive: true });
    symlinkSync(externalMemoryRoot, join(projectRoot, '.peaks', 'memory'));

    expect(() => createProjectMemoryBackupPlan({ projectRoot, artifactWorkspacePath: createTempDir('peaks-memory-backup-root'), apply: false })).toThrow('Project memory directory must stay inside the project root');
  });

  test.runIf(platform() === 'win32')('rejects junctioned project memory directories', () => {
    const projectRoot = createTempDir('peaks-memory-project-junction');
    const externalMemoryRoot = createTempDir('peaks-memory-external-junction-root');
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    symlinkSync(externalMemoryRoot, join(projectRoot, '.peaks', 'memory'), 'junction');

    expect(() => createProjectMemoryBackupPlan({ projectRoot, artifactWorkspacePath: createTempDir('peaks-memory-backup-root'), apply: false })).toThrow('Project memory directory must stay inside the project root');
  });

  test.runIf(platform() !== 'win32')('rejects symlinked .peaks directories', () => {
    const projectRoot = createTempDir('peaks-memory-claude-link');
    const externalClaudeRoot = createTempDir('peaks-memory-external-claude');
    symlinkSync(externalClaudeRoot, join(projectRoot, '.peaks'));

    expect(() => createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [], apply: false })).toThrow('Project memory directory must stay inside the project root');
  });

  test.runIf(platform() === 'win32')('rejects junctioned .peaks directories', () => {
    const projectRoot = createTempDir('peaks-memory-claude-junction');
    const externalClaudeRoot = createTempDir('peaks-memory-external-claude-junction');
    symlinkSync(externalClaudeRoot, join(projectRoot, '.peaks'), 'junction');

    expect(() => createProjectMemoryExtractPlan({ projectRoot, artifactPaths: [], apply: false })).toThrow('Project memory directory must stay inside the project root');
  });

  test('plans artifact workspace backup from project .peaks/memory without making artifact the primary source', () => {
    const projectRoot = createTempDir('peaks-memory-primary');
    const artifactWorkspace = createTempDir('peaks-memory-artifacts');
    mkdirSync(join(projectRoot, '.peaks', 'memory', 'nested'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'memory', 'rule.md'), 'project rule', 'utf8');
    writeFileSync(join(projectRoot, '.peaks', 'memory', 'nested', 'decision.md'), 'nested decision', 'utf8');

    const plan = createProjectMemoryBackupPlan({ projectRoot, artifactWorkspacePath: artifactWorkspace, apply: false });

    expect(plan.apply).toBe(false);
    expect(plan.primaryMemoryDir).toBe(join(projectRoot, '.peaks', 'memory'));
    expect(plan.backupMemoryDir).toBe(join(artifactWorkspace, '.peaks', 'memory-backups', 'project-memory-primary'));
    expect(plan.plannedCopies).toEqual([
      {
        sourcePath: join(projectRoot, '.peaks', 'memory', 'nested', 'decision.md'),
        targetPath: join(artifactWorkspace, '.peaks', 'memory-backups', 'project-memory-primary', 'nested', 'decision.md')
      },
      {
        sourcePath: join(projectRoot, '.peaks', 'memory', 'rule.md'),
        targetPath: join(artifactWorkspace, '.peaks', 'memory-backups', 'project-memory-primary', 'rule.md')
      }
    ]);
  });

  test.runIf(platform() !== 'win32')('skips symlinked entries while planning backup copies', () => {
    const projectRoot = createTempDir('peaks-memory-backup-link');
    const artifactWorkspace = createTempDir('peaks-memory-backup-link-artifacts');
    const externalRoot = createTempDir('peaks-memory-link-target');
    mkdirSync(join(projectRoot, '.peaks', 'memory'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'memory', 'kept.md'), 'kept memory', 'utf8');
    writeFileSync(join(externalRoot, 'linked.md'), 'linked memory', 'utf8');
    symlinkSync(join(externalRoot, 'linked.md'), join(projectRoot, '.peaks', 'memory', 'linked.md'));

    const plan = createProjectMemoryBackupPlan({ projectRoot, artifactWorkspacePath: artifactWorkspace, apply: false });

    expect(plan.plannedCopies).toEqual([
      {
        sourcePath: join(projectRoot, '.peaks', 'memory', 'kept.md'),
        targetPath: join(artifactWorkspace, '.peaks', 'memory-backups', 'project-memory-primary', 'kept.md')
      }
    ]);
  });

  test.runIf(platform() === 'win32')('skips junctioned entries while planning backup copies', () => {
    const projectRoot = createTempDir('peaks-memory-backup-junction');
    const artifactWorkspace = createTempDir('peaks-memory-backup-junction-artifacts');
    const externalRoot = createTempDir('peaks-memory-junction-target');
    mkdirSync(join(projectRoot, '.peaks', 'memory'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'memory', 'kept.md'), 'kept memory', 'utf8');
    symlinkSync(externalRoot, join(projectRoot, '.peaks', 'memory', 'linked'), 'junction');

    const plan = createProjectMemoryBackupPlan({ projectRoot, artifactWorkspacePath: artifactWorkspace, apply: false });

    expect(plan.plannedCopies).toEqual([
      {
        sourcePath: join(projectRoot, '.peaks', 'memory', 'kept.md'),
        targetPath: join(artifactWorkspace, '.peaks', 'memory-backups', 'project-memory-primary', 'kept.md')
      }
    ]);
  });

  test('returns empty write and copy lists for dry-run execution', () => {
    const projectRoot = createTempDir('peaks-memory-dry-run');
    const artifactWorkspace = createTempDir('peaks-memory-dry-run-artifacts');
    const artifactPath = join(projectRoot, 'artifact.md');
    mkdirSync(join(projectRoot, '.peaks', 'memory'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'memory', 'decision.md'), 'stable decision', 'utf8');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Dry run memory',
      'kind: project',
      '---',
      'Stable dry-run memory.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    expect(executeProjectMemoryExtract({ projectRoot, artifactPaths: [artifactPath], apply: false }).writtenFiles).toEqual([]);
    expect(executeProjectMemoryBackup({ projectRoot, artifactWorkspacePath: artifactWorkspace, apply: false }).copiedFiles).toEqual([]);
  });

  test('rejects artifact workspaces inside the project root', () => {
    const projectRoot = createTempDir('peaks-memory-workspace-inside');
    const artifactWorkspace = join(projectRoot, '.peaks-artifacts');
    mkdirSync(artifactWorkspace, { recursive: true });

    expect(() => createProjectMemoryBackupPlan({ projectRoot, artifactWorkspacePath: artifactWorkspace, apply: false })).toThrow('Artifact workspace must be outside the project root');
  });

  test('copies project memory to artifact backup only when apply is true', () => {
    const projectRoot = createTempDir('peaks-memory-sync-primary');
    const artifactWorkspace = createTempDir('peaks-memory-sync-artifacts');
    mkdirSync(join(projectRoot, '.peaks', 'memory'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'memory', 'decision.md'), 'stable decision', 'utf8');

    const result = executeProjectMemoryBackup({ projectRoot, artifactWorkspacePath: artifactWorkspace, apply: true });
    const backupPath = join(artifactWorkspace, '.peaks', 'memory-backups', 'project-memory-primary', 'decision.md');

    expect(result.copiedFiles).toEqual([backupPath]);
    expect(readFileSync(backupPath, 'utf8')).toBe('stable decision');
  });
});

describe('ensureMemoryBootstrap (cold-start fix)', () => {
  test('creates .peaks/memory/ and a full-shape empty index.json from a stock project', () => {
    const projectRoot = createTempDir('peaks-memory-bootstrap-cold');
    // Pre-condition: no .peaks at all.
    expect(existsSync(join(projectRoot, '.peaks'))).toBe(false);

    const result = ensureMemoryBootstrap(projectRoot);

    expect(result).toBe(true);
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    const indexPath = join(memoryDir, 'index.json');
    expect(existsSync(memoryDir)).toBe(true);
    expect(existsSync(indexPath)).toBe(true);

    const raw = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(raw.version).toBe(1);
    expect(typeof raw.updatedAt).toBe('string');
    // Full-shape empty: every bucket present, every bucket empty.
    for (const kind of ['feedback', 'decision', 'rule', 'convention', 'module']) {
      expect(Array.isArray(raw.hot[kind])).toBe(true);
      expect(raw.hot[kind]).toHaveLength(0);
    }
    for (const kind of ['project', 'reference']) {
      expect(Array.isArray(raw.warm[kind])).toBe(true);
      expect(raw.warm[kind]).toHaveLength(0);
    }
  });

  test('is idempotent — second call does not change a populated index', () => {
    const projectRoot = createTempDir('peaks-memory-bootstrap-idempotent');
    ensureMemoryBootstrap(projectRoot);
    const indexPath = join(projectRoot, '.peaks', 'memory', 'index.json');
    const handCrafted = {
      version: 1,
      updatedAt: '2026-06-01T17:11:22.024Z',
      hot: { feedback: [{ name: 'a', kind: 'feedback', description: 'b', sourcePath: '/x', sourceArtifact: null, updatedAt: '2026-06-01' }], decision: [], rule: [], convention: [], module: [] },
      warm: { project: [], reference: [] }
    };
    writeFileSync(indexPath, JSON.stringify(handCrafted, null, 2), 'utf8');

    ensureMemoryBootstrap(projectRoot);

    const after = JSON.parse(readFileSync(indexPath, 'utf8'));
    expect(after.hot.feedback).toHaveLength(1);
    expect(after.hot.feedback[0].name).toBe('a');
  });

  test('readMemoryIndex returns a full-shape empty index from a stock project (read-side fallback)', () => {
    // This is the user-facing fix: `peaks project memories` on a stock
    // project must not return null. It should bootstrap a well-formed empty
    // index and return it.
    const projectRoot = createTempDir('peaks-memory-read-fallback');

    const index = readMemoryIndex(projectRoot);

    expect(index).not.toBeNull();
    expect(index!.version).toBe(1);
    expect(index!.hot.feedback).toEqual([]);
    expect(index!.hot.decision).toEqual([]);
    expect(index!.warm.project).toEqual([]);
    expect(index!.warm.reference).toEqual([]);

    // Side effect: the directory and index file were created.
    const indexPath = join(projectRoot, '.peaks', 'memory', 'index.json');
    expect(existsSync(indexPath)).toBe(true);
  });

  test('readProjectMemories returns empty byKind from a stock project (read-side bootstrap too)', () => {
    const projectRoot = createTempDir('peaks-memory-read-proj-fallback');

    const result = readProjectMemories(projectRoot);

    expect(result.total).toBe(0);
    expect(result.memories).toEqual([]);
    // every kind bucket is present, none has entries
    for (const kind of ['project', 'rule', 'decision', 'reference', 'feedback', 'convention', 'module']) {
      expect(result.byKind[kind as keyof typeof result.byKind]).toEqual([]);
    }
  });
});

describe('summarizeMemoryBody description truncation', () => {
  // Pin the truncation rule: descriptions are capped at MAX_DESCRIPTION_LENGTH
  // (120) characters. Sentences at or below the cap pass through unchanged;
  // sentences above the cap are truncated to (MAX_DESCRIPTION_LENGTH -
  // ELLIPSIS_RESERVE) chars and suffixed with "...". This locks the
  // 117 magic number down so future refactors cannot silently drift the
  // rule.
  test('passes through sentences at or below the 120-char cap, truncates above with ellipsis', () => {
    const projectRoot = createTempDir('peaks-memory-description-cap');
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });

    // 120-char sentence: ends in a period so the sentence splitter keeps it.
    const exactly120 = 'A'.repeat(119) + '.';
    // 121-char sentence: triggers the truncation branch.
    const exactly121 = 'A'.repeat(120) + '.';
    // 200-char sentence: well above the cap.
    const wayAbove = 'A'.repeat(199) + '.';
    // 118-char sentence: between 117 (start of truncate range) and 120
    // (pass-through cap). Pins the < 120 vs <= 120 comparison at L391 of
    // summarizeMemoryBody against future off-by-one refactors.
    const exactly118 = 'A'.repeat(117) + '.';

    writeFileSync(join(memoryDir, 'boundary-120.md'), [
      '---',
      'name: boundary-120',
      'description: Boundary 120',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      exactly120,
      ''
    ].join('\n'), 'utf8');
    writeFileSync(join(memoryDir, 'boundary-121.md'), [
      '---',
      'name: boundary-121',
      'description: Boundary 121',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      exactly121,
      ''
    ].join('\n'), 'utf8');
    writeFileSync(join(memoryDir, 'boundary-200.md'), [
      '---',
      'name: boundary-200',
      'description: Boundary 200',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      wayAbove,
      ''
    ].join('\n'), 'utf8');
    writeFileSync(join(memoryDir, 'boundary-118.md'), [
      '---',
      'name: boundary-118',
      'description: Boundary 118',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      exactly118,
      ''
    ].join('\n'), 'utf8');

    const index = readMemoryIndex(projectRoot);
    expect(index).not.toBeNull();

    const byName = (name: string) => index!.hot.feedback.find((entry) => entry.name === name);
    const desc120 = byName('boundary-120')?.description ?? '';
    const desc121 = byName('boundary-121')?.description ?? '';
    const desc200 = byName('boundary-200')?.description ?? '';
    const desc118 = byName('boundary-118')?.description ?? '';

    // 120 chars: passes through unchanged, no ellipsis.
    expect(desc120.length).toBe(120);
    expect(desc120.endsWith('...')).toBe(false);
    // 121 chars: truncated to 117 + "..." = 120 chars total.
    expect(desc121.length).toBe(120);
    expect(desc121.endsWith('...')).toBe(true);
    expect(desc121.slice(0, 117)).toBe('A'.repeat(117));
    // 200 chars: same rule, also lands at 120 chars with ellipsis.
    expect(desc200.length).toBe(120);
    expect(desc200.endsWith('...')).toBe(true);
    // 118 chars: pass-through branch (<= 120). No ellipsis.
    expect(desc118.length).toBe(118);
    expect(desc118.endsWith('...')).toBe(false);
  });

  test('falls back to body slice when no sentence exceeds MIN_BODY_SENTENCE_LENGTH', () => {
    // Sentences of length <= 20 are filtered out. With no surviving
    // sentence, summarizeMemoryBody falls back to cleaned.slice(0, 120) or
    // 'Project memory' if the cleaned body is empty. This pins the
    // fallback path.
    const projectRoot = createTempDir('peaks-memory-description-fallback');
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });

    writeFileSync(join(memoryDir, 'short-sentences.md'), [
      '---',
      'name: short-sentences',
      'description: Short sentences',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      'Hi. Ok. Yes. Done. No. Go. Up. Down. Left. Right. Big.',
      ''
    ].join('\n'), 'utf8');

    const index = readMemoryIndex(projectRoot);
    const entry = index!.hot.feedback.find((e) => e.name === 'short-sentences');
    expect(entry).toBeDefined();
    // The body has no sentence > MIN_BODY_SENTENCE_LENGTH, so the function
    // falls through to cleaned.slice(0, MAX_DESCRIPTION_LENGTH). The
    // cleaned body is the original string (no markdown markers), so the
    // description must be its exact first MAX_DESCRIPTION_LENGTH chars.
    // The literal 'Project memory' fallback would also satisfy a length
    // check, so we pin the body content here to confirm the slice path
    // actually ran.
    expect(entry!.description).toBe('Hi. Ok. Yes. Done. No. Go. Up. Down. Left. Right. Big.');
  });
});

describe('readMemoryIndex mtime-based regeneration guard', () => {
  // readMemoryIndex must not regenerate the index.json file when every
  // memory.md is older than (or equal to) index.json. Prior to this guard
  // the function rewrote index.json on every call when any memory existed,
  // which is a "read has write side effect" smell and inflates the
  // mtime-based cache invalidation cost for downstream readers.
  test('does not rewrite index.json when every memory.md is older than the existing index', () => {
    const projectRoot = createTempDir('peaks-memory-mtime-stable');
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });

    // Pre-create a memory file with a backdated mtime so it is "older
    // than" the index that readMemoryIndex will write.
    const memoryPath = join(memoryDir, 'old-memory.md');
    writeFileSync(memoryPath, [
      '---',
      'name: old-memory',
      'description: Old memory',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      'Original body that the first read should index.',
      ''
    ].join('\n'), 'utf8');
    const past = new Date(Date.now() - 60_000);
    utimesSync(memoryPath, past, past);

    // First call: index.json is created (or materialised empty + regen
    // via the always-rebuild path). This is the baseline.
    readMemoryIndex(projectRoot);
    const indexPath = join(memoryDir, 'index.json');
    const mtimeAfterFirst = statSync(indexPath).mtimeMs;
    const contentAfterFirst = readFileSync(indexPath, 'utf8');

    // Second call: nothing changed. The mtime must be byte-identical
    // (no rewrite). Wait a few ms so an erroneous rewrite would bump
    // mtimeMs and we can distinguish.
    const before = Date.now();
    while (Date.now() - before < 25) { /* spin briefly */ }
    readMemoryIndex(projectRoot);

    expect(statSync(indexPath).mtimeMs).toBe(mtimeAfterFirst);
    expect(readFileSync(indexPath, 'utf8')).toBe(contentAfterFirst);
  });

  test('rewrites index.json when a memory.md mtime exceeds the index mtime', () => {
    const projectRoot = createTempDir('peaks-memory-mtime-stale');
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });

    const memoryPath = join(memoryDir, 'fresh-memory.md');
    writeFileSync(memoryPath, [
      '---',
      'name: fresh-memory',
      'description: Fresh memory',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      'First version of the body.',
      ''
    ].join('\n'), 'utf8');
    const past = new Date(Date.now() - 60_000);
    utimesSync(memoryPath, past, past);

    readMemoryIndex(projectRoot);
    // Wait a few ms so a subsequent rewrite bumps mtimeMs by a detectable
    // amount — Windows NTFS mtime resolution is ~1ms and without this spin
    // the second read's rewrite can land in the same millisecond as the
    // first, masking whether a rewrite actually happened.
    const before = Date.now();
    while (Date.now() - before < 25) { /* spin briefly */ }
    const indexPath = join(memoryDir, 'index.json');
    const mtimeAfterFirst = statSync(indexPath).mtimeMs;
    const firstContent = readFileSync(indexPath, 'utf8');
    const firstIndex = JSON.parse(firstContent);
    expect(firstIndex.hot.feedback).toHaveLength(1);
    expect(firstIndex.hot.feedback[0].name).toBe('fresh-memory');

    // Edit the memory body and bump its mtime into the future relative
    // to the existing index.
    writeFileSync(memoryPath, [
      '---',
      'name: fresh-memory',
      'description: Fresh memory',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      'Second version of the body, after an edit.',
      ''
    ].join('\n'), 'utf8');
    const future = new Date(Date.now() + 60_000);
    utimesSync(memoryPath, future, future);

    readMemoryIndex(projectRoot);

    const mtimeAfterSecond = statSync(indexPath).mtimeMs;
    expect(mtimeAfterSecond).toBeGreaterThan(mtimeAfterFirst);

    const secondIndex = JSON.parse(readFileSync(indexPath, 'utf8'));
    // The memory was rewritten, so the index must contain the new body.
    expect(secondIndex.hot.feedback[0].name).toBe('fresh-memory');
    // The description is the summarized body, which changed.
    expect(secondIndex.hot.feedback[0].description).not.toBe(firstIndex.hot.feedback[0].description);
  });

  test('does not rewrite index.json when memory mtime equals index mtime', () => {
    // shouldRegenerateIndex uses strict `>` (not `>=`) at the mtime
    // comparison (project-memory-service.ts L541). A `>=` would force a
    // regen on every read when the memory mtime equals the index
    // mtime, defeating the guard. This test pins the strict-`>` choice
    // so a future refactor that "tidies" the comparison triggers a
    // failure here.
    const projectRoot = createTempDir('peaks-memory-mtime-equal');
    const memoryDir = join(projectRoot, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });

    const memoryPath = join(memoryDir, 'equal-memory.md');
    writeFileSync(memoryPath, [
      '---',
      'name: equal-memory',
      'description: Equal mtime memory',
      'metadata:',
      '  type: feedback',
      '  sourceArtifact: rd/artifact.md',
      '---',
      '',
      'Body content for equal-mtime test.',
      ''
    ].join('\n'), 'utf8');
    const past = new Date(Date.now() - 60_000);
    utimesSync(memoryPath, past, past);

    // First read populates the index.
    readMemoryIndex(projectRoot);
    const indexPath = join(memoryDir, 'index.json');
    // Capture the raw float mtime (preserves sub-ms precision on hosts
    // where the FS supports it; e.g. Windows NTFS stores mtime to 100ns).
    const mtimeAfterFirst = statSync(indexPath).mtimeMs;
    // Wrap in a Date (which truncates to integer ms) before passing to
    // utimesSync. The Date round-trip avoids the JS Number precision
    // loss that would occur if we passed fractional seconds directly
    // via `mtimeMs / 1000` (where (x / 1000) * 1000 does not round-trip
    // for 17-sig-fig floats, and the resulting memory mtime would be
    // ~1ms higher than the captured value, tripping the strict `>` in
    // shouldRegenerateIndex at L541).
    const indexMtime = new Date(mtimeAfterFirst);

    // Set the memory mtime EQUAL to the index mtime (truncated to integer
    // ms on both sides).
    utimesSync(memoryPath, indexMtime, indexMtime);

    // Wait long enough to be in a different filesystem-resolution bucket
    // (Windows NTFS is 1ms; 25ms is the same margin the existing tests use).
    const before = Date.now();
    while (Date.now() - before < 25) { /* spin briefly */ }
    readMemoryIndex(projectRoot);

    expect(statSync(indexPath).mtimeMs).toBe(mtimeAfterFirst);
  });
});
