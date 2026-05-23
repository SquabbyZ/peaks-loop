import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

async function makeProjectWithOpenSpec(): Promise<string> {
  const project = await mkdtemp(join(tmpdir(), 'peaks-openspec-cli-'));
  await mkdir(join(project, 'openspec', 'changes', 'sample-change'), { recursive: true });
  await writeFile(
    join(project, 'openspec', 'changes', 'sample-change', 'proposal.md'),
    `# Change: sample-change\n## Why\n\nMust ship.\n\n## Acceptance Criteria\n\n- accept-one\n`,
    'utf8'
  );
  await writeFile(
    join(project, 'openspec', 'changes', 'sample-change', 'tasks.md'),
    `# Tasks\n\n## 1. Section\n\n- [ ] open\n- [x] done\n`,
    'utf8'
  );
  return project;
}

describe('peaks openspec commands', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('lists openspec changes for the current project by default', async () => {
    const result = await runCommand(['openspec', 'list', '--json']);
    const output = parseJsonOutput<{ exists: boolean; changes: Array<{ id: string }> }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('openspec.list');
    expect(output.data.exists).toBe(true);
    expect(output.data.changes.length).toBeGreaterThanOrEqual(4);
  });

  test('lists openspec changes for a provided --project path', async () => {
    const project = await makeProjectWithOpenSpec();
    const result = await runCommand(['openspec', 'list', '--project', project, '--json']);
    const output = parseJsonOutput<{ changes: Array<{ id: string }> }>(result.stdout);

    expect(output.data.changes.map((change) => change.id)).toEqual(['sample-change']);
  });

  test('shows a parsed openspec change for --project path', async () => {
    const project = await makeProjectWithOpenSpec();
    const result = await runCommand(['openspec', 'show', 'sample-change', '--project', project, '--json']);
    const output = parseJsonOutput<{ id: string; proposal: { acceptanceCriteria: string[] } | null }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.id).toBe('sample-change');
    expect(output.data.proposal?.acceptanceCriteria).toEqual(['accept-one']);
  });

  test('returns OPENSPEC_CHANGE_NOT_FOUND when change is missing', async () => {
    const project = await makeProjectWithOpenSpec();
    const result = await runCommand(['openspec', 'show', 'nope', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('OPENSPEC_CHANGE_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('returns OPENSPEC_LIST_FAILED when scan throws', async () => {
    const openspecModule = await import('../../src/services/openspec/openspec-scan-service.js');
    const spy = vi.spyOn(openspecModule, 'scanOpenSpec').mockRejectedValueOnce(new Error('synthetic openspec failure'));

    const result = await runCommand(['openspec', 'list', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('OPENSPEC_LIST_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });

  test('returns OPENSPEC_SHOW_FAILED when load throws', async () => {
    const openspecModule = await import('../../src/services/openspec/openspec-scan-service.js');
    const spy = vi.spyOn(openspecModule, 'loadOpenSpecChange').mockRejectedValueOnce(new Error('synthetic load failure'));

    const result = await runCommand(['openspec', 'show', 'whatever', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('OPENSPEC_SHOW_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });

  test('projects an openspec change to RD input shape', async () => {
    const project = await makeProjectWithOpenSpec();
    const result = await runCommand(['openspec', 'to-rd', 'sample-change', '--project', project, '--json']);
    const output = parseJsonOutput<{ changeId: string; acceptance: string[]; commitBoundaries: Array<{ heading: string }> }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('openspec.to-rd');
    expect(output.data.changeId).toBe('sample-change');
    expect(output.data.acceptance).toEqual(['accept-one']);
    expect(output.data.commitBoundaries.map((boundary) => boundary.heading)).toEqual(['1. Section']);
  });

  test('returns OPENSPEC_CHANGE_NOT_FOUND when to-rd target is missing', async () => {
    const project = await makeProjectWithOpenSpec();
    const result = await runCommand(['openspec', 'to-rd', 'nope', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('OPENSPEC_CHANGE_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('returns OPENSPEC_TO_RD_FAILED when projection throws', async () => {
    const bridgeModule = await import('../../src/services/openspec/openspec-bridge-service.js');
    const spy = vi.spyOn(bridgeModule, 'projectOpenSpecToRdInput').mockRejectedValueOnce(new Error('synthetic projection failure'));

    const result = await runCommand(['openspec', 'to-rd', 'whatever', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('OPENSPEC_TO_RD_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });

  test('normalizes trailing slash in --project path', async () => {
    const project = await makeProjectWithOpenSpec();
    const result = await runCommand(['openspec', 'list', '--project', `${project}/`, '--json']);
    const output = parseJsonOutput<{ exists: boolean }>(result.stdout);

    expect(output.data.exists).toBe(true);
  });
});
