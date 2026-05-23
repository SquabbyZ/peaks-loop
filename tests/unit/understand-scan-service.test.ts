import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { scanUnderstandAnything } from '../../src/services/understand/understand-scan-service.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-understand-scan-'));
}

async function writeGraph(project: string, body: unknown): Promise<void> {
  const dir = join(project, '.understand-anything');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'knowledge-graph.json'), JSON.stringify(body, null, 2), 'utf8');
}

describe('scanUnderstandAnything', () => {
  test('returns exists=false when .understand-anything directory is missing', async () => {
    const project = await makeProject();

    const result = await scanUnderstandAnything({ projectRoot: project });

    expect(result.exists).toBe(false);
    expect(result.graph.exists).toBe(false);
  });

  test('returns exists=true with graph=absent when only the artifact directory exists', async () => {
    const project = await makeProject();
    await mkdir(join(project, '.understand-anything'), { recursive: true });

    const result = await scanUnderstandAnything({ projectRoot: project });

    expect(result.exists).toBe(true);
    expect(result.graph.exists).toBe(false);
  });

  test('returns parsed top-level field summary when knowledge-graph.json exists', async () => {
    const project = await makeProject();
    await writeGraph(project, {
      generatedAt: '2026-05-23T12:00:00.000Z',
      nodes: [{ id: 'src/index.ts', kind: 'file' }],
      edges: [{ from: 'src/index.ts', to: 'src/util.ts', kind: 'imports' }],
      layers: [{ name: 'API', members: ['src/index.ts'] }],
      tours: [{ name: 'getting-started', steps: ['src/index.ts'] }]
    });

    const result = await scanUnderstandAnything({ projectRoot: project });

    expect(result.exists).toBe(true);
    expect(result.graph.exists).toBe(true);
    expect(result.graph.path).toBe(join(project, '.understand-anything', 'knowledge-graph.json'));
    expect(result.graph.topLevelFields?.sort()).toEqual(['edges', 'generatedAt', 'layers', 'nodes', 'tours']);
    expect(result.graph.counts).toEqual({ nodes: 1, edges: 1, layers: 1, tours: 1 });
    expect(result.graph.sizeBytes).toBeGreaterThan(0);
    expect(result.graph.parseError).toBeUndefined();
  });

  test('records a parse error when knowledge-graph.json is malformed', async () => {
    const project = await makeProject();
    await mkdir(join(project, '.understand-anything'), { recursive: true });
    await writeFile(join(project, '.understand-anything', 'knowledge-graph.json'), '{ not json', 'utf8');

    const result = await scanUnderstandAnything({ projectRoot: project });

    expect(result.graph.exists).toBe(true);
    expect(result.graph.parseError).toMatch(/JSON|parse/i);
    expect(result.graph.topLevelFields).toBeUndefined();
  });

  test('detects optional intermediate and diff-overlay scratch artifacts', async () => {
    const project = await makeProject();
    await mkdir(join(project, '.understand-anything', 'intermediate'), { recursive: true });
    await writeFile(join(project, '.understand-anything', 'diff-overlay.json'), '{}', 'utf8');

    const result = await scanUnderstandAnything({ projectRoot: project });

    expect(result.intermediate.exists).toBe(true);
    expect(result.diffOverlay.exists).toBe(true);
  });

  test('returns count 0 for arrays that are absent or non-array', async () => {
    const project = await makeProject();
    await writeGraph(project, { generatedAt: '2026-05-23', nodes: 'not-an-array' });

    const result = await scanUnderstandAnything({ projectRoot: project });

    expect(result.graph.counts).toEqual({ nodes: 0, edges: 0, layers: 0, tours: 0 });
  });

  test('treats a knowledge-graph.json that is not a JSON object as parse error', async () => {
    const project = await makeProject();
    await mkdir(join(project, '.understand-anything'), { recursive: true });
    await writeFile(join(project, '.understand-anything', 'knowledge-graph.json'), '[1,2,3]', 'utf8');

    const result = await scanUnderstandAnything({ projectRoot: project });

    expect(result.graph.parseError).toMatch(/object/i);
  });

  test('respects a custom artifactDir option', async () => {
    const project = await makeProject();
    const customDir = join(project, 'custom', '.ua');
    await mkdir(customDir, { recursive: true });
    await writeFile(join(customDir, 'knowledge-graph.json'), JSON.stringify({ nodes: [] }), 'utf8');

    const result = await scanUnderstandAnything({ projectRoot: project, artifactDir: customDir });

    expect(result.exists).toBe(true);
    expect(result.graph.exists).toBe(true);
    expect(result.graph.path).toBe(join(customDir, 'knowledge-graph.json'));
  });
});
