import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildUnderstandContext } from '../../src/services/understand/understand-hybrid-service.js';
import type { CodegraphExecutionResult, CodegraphInvocation, CodegraphProcessRunner } from '../../src/services/codegraph/codegraph-service.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-understand-hybrid-'));
}

async function writeGraph(project: string, body: unknown): Promise<void> {
  const dir = join(project, '.understand-anything');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'knowledge-graph.json'), JSON.stringify(body, null, 2), 'utf8');
}

async function writePackageJson(project: string): Promise<void> {
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'fixture' }, null, 2), 'utf8');
}

function okRunner(payload: unknown = { files: [] }): CodegraphProcessRunner {
  return async (_invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => ({
    exitCode: 0,
    stdout: JSON.stringify(payload),
    stderr: ''
  });
}

function failingRunner(stderr = 'boom'): CodegraphProcessRunner {
  return async (_invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> => ({
    exitCode: 2,
    stdout: '',
    stderr
  });
}

describe('buildUnderstandContext', () => {
  test('returns source=ua-only when UA graph exists and no codegraph runner is provided', async () => {
    const project = await makeProject();
    await writeGraph(project, {
      generatedAt: '2026-07-02T00:00:00.000Z',
      nodes: [{ id: 'src/index.ts' }],
      edges: [],
      layers: [{ name: 'API' }],
      tours: []
    });

    const result = await buildUnderstandContext({ projectRoot: project });

    expect(result.source).toBe('ua-only');
    expect(result.ua?.scan.exists).toBe(true);
    expect(result.ua?.summary?.counts.nodes).toBe(1);
    expect(result.codegraph).toBeUndefined();
  });

  test('returns source=ua-missing-fallback-codegraph when UA absent and codegraph affected succeeds', async () => {
    const project = await makeProject();
    await writePackageJson(project);

    const result = await buildUnderstandContext({
      projectRoot: project,
      files: ['package.json'],
      codegraphRunner: okRunner({ files: ['package.json'] })
    });

    expect(result.source).toBe('ua-missing-fallback-codegraph');
    expect(result.ua).toBeUndefined();
    expect(result.codegraph?.invocation.subcommand).toBe('affected');
    expect(result.codegraph?.invocation.files).toEqual(['package.json']);
    expect((result.codegraph?.payload as { files: string[] }).files).toEqual(['package.json']);
  });

  test('returns source=ua-and-codegraph-hybrid when both are present', async () => {
    const project = await makeProject();
    await writeGraph(project, {
      generatedAt: '2026-07-02T00:00:00.000Z',
      nodes: [{ id: 'package.json' }],
      edges: [],
      layers: [],
      tours: []
    });
    await writePackageJson(project);

    const result = await buildUnderstandContext({
      projectRoot: project,
      files: ['package.json'],
      codegraphRunner: okRunner({ files: ['package.json'] })
    });

    expect(result.source).toBe('ua-and-codegraph-hybrid');
    expect(result.ua?.scan.exists).toBe(true);
    expect(result.codegraph?.invocation.subcommand).toBe('affected');
  });

  test('returns source=both-missing when UA absent and codegraph exits non-zero', async () => {
    const project = await makeProject();
    await writePackageJson(project);

    const result = await buildUnderstandContext({
      projectRoot: project,
      files: ['package.json'],
      codegraphRunner: failingRunner('codegraph not initialized')
    });

    expect(result.source).toBe('both-missing');
    expect(result.warnings.some((w) => w.includes('exited with code 2'))).toBe(true);
    expect(result.codegraph).toBeUndefined();
  });
});
