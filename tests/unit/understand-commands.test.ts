import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getMockedHomeDir, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

const homeDir = getMockedHomeDir();

async function makeProject(name: string): Promise<string> {
  const project = join(homeDir, name);
  await mkdir(project, { recursive: true });
  return project;
}

describe('peaks understand status command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('reports exists=false with an install hint when UA is not installed in the project', async () => {
    const project = await makeProject('understand-not-installed');

    const result = await runCommand(['understand', 'status', '--project', project, '--json']);
    const output = parseJsonOutput<{ exists: boolean; graph: { exists: boolean } }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('understand.status');
    expect(output.data.exists).toBe(false);
    expect(output.data.graph.exists).toBe(false);
    expect(output.nextActions ?? []).toEqual(expect.arrayContaining([expect.stringContaining('/plugin install understand-anything')]));
  });

  test('reports the parsed graph summary when knowledge-graph.json exists', async () => {
    const project = await makeProject('understand-installed');
    await mkdir(join(project, '.understand-anything'), { recursive: true });
    await writeFile(
      join(project, '.understand-anything', 'knowledge-graph.json'),
      JSON.stringify({ nodes: [{ id: 'a' }], edges: [], layers: [], tours: [] }),
      'utf8'
    );

    const result = await runCommand(['understand', 'status', '--project', project, '--json']);
    const output = parseJsonOutput<{ exists: boolean; graph: { exists: boolean; counts: { nodes: number } } }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.exists).toBe(true);
    expect(output.data.graph.exists).toBe(true);
    expect(output.data.graph.counts.nodes).toBe(1);
  });

  test('hints to run /understand when only the artifact directory exists', async () => {
    const project = await makeProject('understand-dir-only');
    await mkdir(join(project, '.understand-anything'), { recursive: true });

    const result = await runCommand(['understand', 'status', '--project', project, '--json']);
    const output = parseJsonOutput<{ graph: { exists: boolean } }>(result.stdout);

    expect(output.data.graph.exists).toBe(false);
    expect(output.nextActions ?? []).toEqual(expect.arrayContaining([expect.stringContaining('/understand')]));
  });

  test('hints to regenerate the graph when knowledge-graph.json is malformed', async () => {
    const project = await makeProject('understand-bad-json');
    await mkdir(join(project, '.understand-anything'), { recursive: true });
    await writeFile(join(project, '.understand-anything', 'knowledge-graph.json'), '{ not json', 'utf8');

    const result = await runCommand(['understand', 'status', '--project', project, '--json']);
    const output = parseJsonOutput<{ graph: { parseError: string } }>(result.stdout);

    expect(output.data.graph.parseError).toBeDefined();
    expect(output.nextActions ?? []).toEqual(expect.arrayContaining([expect.stringContaining('regenerate')]));
  });

  test('honors --artifact-dir override', async () => {
    const project = await makeProject('understand-custom-dir');
    const customDir = join(project, 'custom-graph');
    await mkdir(customDir, { recursive: true });
    await writeFile(join(customDir, 'knowledge-graph.json'), JSON.stringify({ nodes: [] }), 'utf8');

    const result = await runCommand(['understand', 'status', '--project', project, '--artifact-dir', customDir, '--json']);
    const output = parseJsonOutput<{ artifactDir: string; graph: { exists: boolean } }>(result.stdout);

    expect(output.data.artifactDir).toBe(customDir);
    expect(output.data.graph.exists).toBe(true);
  });

  test('returns UNDERSTAND_STATUS_FAILED when the scanner throws', async () => {
    const scanModule = await import('../../src/services/understand/understand-scan-service.js');
    const spy = vi.spyOn(scanModule, 'scanUnderstandAnything').mockRejectedValueOnce(new Error('synthetic scan failure'));

    const project = await makeProject('understand-failure');
    const result = await runCommand(['understand', 'status', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNDERSTAND_STATUS_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });
});

describe('peaks understand show command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('summarizes the knowledge graph when it exists', async () => {
    const project = await makeProject('understand-show-ok');
    await mkdir(join(project, '.understand-anything'), { recursive: true });
    await writeFile(
      join(project, '.understand-anything', 'knowledge-graph.json'),
      JSON.stringify({
        generatedAt: '2026-05-23',
        nodes: [{ id: 'a' }, { id: 'b' }],
        layers: [{ name: 'API' }],
        tours: ['intro']
      }),
      'utf8'
    );

    const result = await runCommand(['understand', 'show', '--project', project, '--json']);
    const output = parseJsonOutput<{ counts: { nodes: number }; layerNames: string[]; tourNames: string[]; sampleNodes: string[] }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('understand.show');
    expect(output.data.counts.nodes).toBe(2);
    expect(output.data.layerNames).toEqual(['API']);
    expect(output.data.tourNames).toEqual(['intro']);
    expect(output.data.sampleNodes).toEqual(['a', 'b']);
  });

  test('honors --sample to limit returned sample node ids', async () => {
    const project = await makeProject('understand-show-sample');
    await mkdir(join(project, '.understand-anything'), { recursive: true });
    await writeFile(
      join(project, '.understand-anything', 'knowledge-graph.json'),
      JSON.stringify({ nodes: Array.from({ length: 10 }, (_unused, i) => ({ id: `n-${i}` })) }),
      'utf8'
    );

    const result = await runCommand(['understand', 'show', '--project', project, '--sample', '3', '--json']);
    const output = parseJsonOutput<{ sampleNodes: string[] }>(result.stdout);

    expect(output.data.sampleNodes).toHaveLength(3);
  });

  test('returns UNDERSTAND_GRAPH_MISSING when the artifact is absent', async () => {
    const project = await makeProject('understand-show-missing');

    const result = await runCommand(['understand', 'show', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNDERSTAND_GRAPH_MISSING');
    expect(result.exitCode).toBe(1);
    expect(output.nextActions ?? []).toEqual(expect.arrayContaining([expect.stringContaining('/plugin install')]));
  });

  test('returns UNDERSTAND_GRAPH_PARSE_ERROR when knowledge-graph.json is malformed', async () => {
    const project = await makeProject('understand-show-bad');
    await mkdir(join(project, '.understand-anything'), { recursive: true });
    await writeFile(join(project, '.understand-anything', 'knowledge-graph.json'), '{ not json', 'utf8');

    const result = await runCommand(['understand', 'show', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNDERSTAND_GRAPH_PARSE_ERROR');
    expect(result.exitCode).toBe(1);
  });

  test('returns UNDERSTAND_SHOW_FAILED when the service throws', async () => {
    const module = await import('../../src/services/understand/understand-scan-service.js');
    const spy = vi.spyOn(module, 'summarizeKnowledgeGraph').mockRejectedValueOnce(new Error('synthetic summary failure'));

    const project = await makeProject('understand-show-failure');
    const result = await runCommand(['understand', 'show', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNDERSTAND_SHOW_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });

  test('rejects --sample 0 via the Commander parser', async () => {
    const project = await makeProject('understand-show-bad-sample');

    await expect(
      runCommand(['understand', 'show', '--project', project, '--sample', '0', '--json'])
    ).rejects.toThrowError(/positive integer/i);
  });

  test('rejects --sample with non-digit input via the Commander parser', async () => {
    const project = await makeProject('understand-show-non-digit');

    await expect(
      runCommand(['understand', 'show', '--project', project, '--sample', 'abc', '--json'])
    ).rejects.toThrowError(/positive integer/i);
  });

  test('honors --artifact-dir for show', async () => {
    const project = await makeProject('understand-show-custom-dir');
    const dir = join(project, 'alt-graph');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'knowledge-graph.json'), JSON.stringify({ nodes: [{ id: 'alt' }] }), 'utf8');

    const result = await runCommand(['understand', 'show', '--project', project, '--artifact-dir', dir, '--json']);
    const output = parseJsonOutput<{ path: string; sampleNodes: string[] }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.path).toBe(join(dir, 'knowledge-graph.json'));
    expect(output.data.sampleNodes).toEqual(['alt']);
  });
});
