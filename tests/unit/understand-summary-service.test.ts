import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { summarizeKnowledgeGraph } from '../../src/services/understand/understand-scan-service.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-understand-summary-'));
}

async function writeGraph(project: string, body: unknown): Promise<void> {
  const dir = join(project, '.understand-anything');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'knowledge-graph.json'), JSON.stringify(body, null, 2), 'utf8');
}

describe('summarizeKnowledgeGraph', () => {
  test('returns exists=false summary when no graph is present', async () => {
    const project = await makeProject();

    const summary = await summarizeKnowledgeGraph({ projectRoot: project });

    expect(summary.exists).toBe(false);
    expect(summary.counts).toEqual({ nodes: 0, edges: 0, layers: 0, tours: 0 });
    expect(summary.sampleNodes).toEqual([]);
  });

  test('summarizes a rich graph with layers, tours, and sample nodes', async () => {
    const project = await makeProject();
    await writeGraph(project, {
      generatedAt: '2026-05-23T12:00:00.000Z',
      nodes: [
        { id: 'src/index.ts', kind: 'file' },
        { id: 'src/util.ts', kind: 'file' },
        { id: 'src/cli/command.ts', kind: 'file' }
      ],
      edges: [
        { from: 'src/index.ts', to: 'src/util.ts', kind: 'imports' }
      ],
      layers: [
        { name: 'API', members: ['src/index.ts'] },
        { name: 'Service', members: ['src/util.ts'] }
      ],
      tours: [
        { name: 'getting-started', steps: ['src/index.ts'] },
        { name: 'deep-dive', steps: ['src/cli/command.ts'] }
      ]
    });

    const summary = await summarizeKnowledgeGraph({ projectRoot: project });

    expect(summary.exists).toBe(true);
    expect(summary.generatedAt).toBe('2026-05-23T12:00:00.000Z');
    expect(summary.counts).toEqual({ nodes: 3, edges: 1, layers: 2, tours: 2 });
    expect(summary.layerNames).toEqual(['API', 'Service']);
    expect(summary.tourNames).toEqual(['getting-started', 'deep-dive']);
    expect(summary.sampleNodes).toEqual(['src/index.ts', 'src/util.ts', 'src/cli/command.ts']);
  });

  test('respects sampleSize when collecting sample nodes', async () => {
    const project = await makeProject();
    await writeGraph(project, {
      nodes: Array.from({ length: 10 }, (_unused, index) => ({ id: `node-${index}` }))
    });

    const summary = await summarizeKnowledgeGraph({ projectRoot: project, sampleSize: 3 });

    expect(summary.sampleNodes).toHaveLength(3);
    expect(summary.sampleNodes).toEqual(['node-0', 'node-1', 'node-2']);
  });

  test('returns parseError summary when knowledge-graph.json is malformed', async () => {
    const project = await makeProject();
    await mkdir(join(project, '.understand-anything'), { recursive: true });
    await writeFile(join(project, '.understand-anything', 'knowledge-graph.json'), '{ not json', 'utf8');

    const summary = await summarizeKnowledgeGraph({ projectRoot: project });

    expect(summary.exists).toBe(true);
    expect(summary.parseError).toMatch(/JSON|parse/i);
    expect(summary.counts).toEqual({ nodes: 0, edges: 0, layers: 0, tours: 0 });
  });

  test('handles string entries in layers / tours when upstream uses bare strings', async () => {
    const project = await makeProject();
    await writeGraph(project, {
      nodes: [],
      layers: ['API', 'UI'],
      tours: ['intro']
    });

    const summary = await summarizeKnowledgeGraph({ projectRoot: project });

    expect(summary.layerNames).toEqual(['API', 'UI']);
    expect(summary.tourNames).toEqual(['intro']);
  });

  test('falls back through id / path / name / label when collecting node samples', async () => {
    const project = await makeProject();
    await writeGraph(project, {
      nodes: [
        { id: 'with-id' },
        { path: 'src/with-path.ts' },
        { name: 'with-name' },
        { label: 'with-label' },
        { unknown: 'missing' }
      ]
    });

    const summary = await summarizeKnowledgeGraph({ projectRoot: project, sampleSize: 10 });

    expect(summary.sampleNodes).toEqual(['with-id', 'src/with-path.ts', 'with-name', 'with-label']);
  });

  test('skips layer / tour entries that are neither strings nor objects with id-like fields', async () => {
    const project = await makeProject();
    await writeGraph(project, {
      nodes: [],
      layers: ['valid-string', 42, null, [1, 2], { unknown: 'missing' }, { name: 'valid-object' }],
      tours: [null, 'real-tour']
    });

    const summary = await summarizeKnowledgeGraph({ projectRoot: project });

    expect(summary.layerNames).toEqual(['valid-string', 'valid-object']);
    expect(summary.tourNames).toEqual(['real-tour']);
  });

  test('treats non-array nodes field as empty for the sample without crashing', async () => {
    const project = await makeProject();
    await writeGraph(project, { nodes: 'not-an-array', layers: [] });

    const summary = await summarizeKnowledgeGraph({ projectRoot: project });

    expect(summary.exists).toBe(true);
    expect(summary.sampleNodes).toEqual([]);
    expect(summary.counts.nodes).toBe(0);
  });

  test('honors a custom artifactDir', async () => {
    const project = await makeProject();
    const dir = join(project, 'custom', 'graph-dir');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'knowledge-graph.json'), JSON.stringify({ nodes: [{ id: 'x' }] }), 'utf8');

    const summary = await summarizeKnowledgeGraph({ projectRoot: project, artifactDir: dir });

    expect(summary.exists).toBe(true);
    expect(summary.path).toBe(join(dir, 'knowledge-graph.json'));
    expect(summary.sampleNodes).toEqual(['x']);
  });
});
