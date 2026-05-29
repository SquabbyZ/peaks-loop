import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { platform, tmpdir } from 'node:os';
import { describe, expect, test, vi } from 'vitest';
import {
  createProjectMemoryBackupPlan,
  createProjectMemoryExtractPlan,
  executeProjectMemoryBackup,
  executeProjectMemoryExtract,
  extractStableProjectMemories
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

  test('does not overwrite existing project memory files', () => {
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

    expect(() => executeProjectMemoryExtract({ projectRoot, artifactPaths: [artifactPath], apply: true })).toThrow();
    expect(readFileSync(join(memoryDir, 'existing-memory.md'), 'utf8')).toBe('existing memory');
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
