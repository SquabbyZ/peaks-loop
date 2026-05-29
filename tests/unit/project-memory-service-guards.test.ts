import { describe, expect, test, vi } from 'vitest';

const realPaths = new Map<string, string>([
  ['C:/project', 'C:/project'],
  ['C:/project/.peaks/memory', 'C:/outside/memory'],
  ['C:/artifact-project', 'C:/artifact-project'],
  ['C:/artifact-project/link.md', 'C:/artifact-project/link.md'],
  ['C:/write-project', 'C:/write-project'],
  ['C:/write-project/artifact.md', 'C:/write-project/artifact.md'],
  ['C:/write-project/.peaks/memory/race-memory.md', 'C:/outside/race-memory.md'],
  ['C:/backup-project', 'C:/backup-project'],
  ['C:/backup-project/.peaks/memory', 'C:/backup-project/.peaks/memory'],
  ['C:/backup-project/.peaks/memory/link.md', 'C:/outside/link.md'],
  ['C:/backup-workspace', 'C:/backup-workspace']
]);
const symlinkPaths = new Set<string>(['C:/artifact-project/link.md']);
let hasCreatedWriteMemoryDir = false;

function normalizeMockPath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const driveIndex = normalized.search(/[A-Za-z]:\//);
  return driveIndex >= 0 ? normalized.slice(driveIndex) : normalized;
}

vi.mock('node:fs', () => ({
  constants: { O_WRONLY: 1, O_CREAT: 64, O_EXCL: 128 },
  copyFileSync: vi.fn(),
  existsSync: vi.fn((path: string) => {
    const normalizedPath = normalizeMockPath(path);
    return realPaths.has(normalizedPath) || (normalizedPath === 'C:/write-project/.peaks/memory' && hasCreatedWriteMemoryDir);
  }),
  lstatSync: vi.fn((path: string) => ({
    isSymbolicLink: () => symlinkPaths.has(normalizeMockPath(path))
  })),
  mkdirSync: vi.fn((path: string) => {
    if (normalizeMockPath(path) === 'C:/write-project/.peaks/memory') {
      hasCreatedWriteMemoryDir = true;
    }
  }),
  readdirSync: vi.fn(() => [
    {
      name: 'link.md',
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true
    }
  ]),
  readFileSync: vi.fn((path: string) => normalizeMockPath(path).endsWith('/artifact.md')
    ? [
      '<!-- peaks-memory:start -->',
      'title: Race memory',
      'kind: project',
      '---',
      'Stable memory.',
      '<!-- peaks-memory:end -->'
    ].join('\n')
    : 'safe memory'),
  realpathSync: vi.fn((path: string) => {
    const normalizedPath = normalizeMockPath(path);
    return realPaths.get(normalizedPath) ?? normalizedPath;
  }),
  openSync: vi.fn(() => {
    throw new Error('existing symlink refused');
  }),
  closeSync: vi.fn(),
  writeFileSync: vi.fn()
}));

describe('project memory service guard branches', () => {
  test('rejects project memory directories whose realpath escapes the project root', async () => {
    const { createProjectMemoryExtractPlan } = await import('../../src/services/memory/project-memory-service.js');

    expect(() => createProjectMemoryExtractPlan({
      projectRoot: 'C:/project',
      artifactPaths: [],
      apply: false
    })).toThrow('Project memory directory must stay inside the project root');
  });

  test('rejects artifact paths whose own path is a symbolic link after normalization', async () => {
    const { createProjectMemoryExtractPlan } = await import('../../src/services/memory/project-memory-service.js');

    expect(() => createProjectMemoryExtractPlan({
      projectRoot: 'C:/artifact-project',
      artifactPaths: ['C:/artifact-project/link.md'],
      apply: false
    })).toThrow('Artifact path must stay inside the project root');
  });

  test('resolves relative artifact paths from Windows-style project roots', async () => {
    const { createProjectMemoryExtractPlan } = await import('../../src/services/memory/project-memory-service.js');

    const plan = createProjectMemoryExtractPlan({
      projectRoot: 'C:/write-project',
      artifactPaths: ['artifact.md'],
      apply: false
    });

    expect(plan.extractedMemories[0]?.sourceArtifact).toBe('artifact.md');
  });

  test('revalidates memory write targets during apply', async () => {
    const { executeProjectMemoryExtract } = await import('../../src/services/memory/project-memory-service.js');

    expect(() => executeProjectMemoryExtract({
      projectRoot: 'C:/write-project',
      artifactPaths: ['C:/write-project/artifact.md'],
      apply: true
    })).toThrow('Project memory write target must stay inside the project memory directory');
  });

  test('revalidates backup sources during apply', async () => {
    const { executeProjectMemoryBackup } = await import('../../src/services/memory/project-memory-service.js');

    expect(() => executeProjectMemoryBackup({
      projectRoot: 'C:/backup-project',
      artifactWorkspacePath: 'C:/backup-workspace',
      apply: true
    })).toThrow('Project memory source must stay inside the project memory directory');
  });
});
