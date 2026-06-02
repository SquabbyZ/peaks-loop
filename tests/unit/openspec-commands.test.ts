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

  test('renders an openspec change pack in dry-run mode without writing', async () => {
    const project = await makeProjectWithOpenSpec();
    const requestPath = join(project, 'render-request.json');
    await writeFile(requestPath, JSON.stringify({
      changeId: 'rendered-from-cli',
      why: 'CLI smoke',
      whatChanges: ['add cli render'],
      acceptanceCriteria: ['written']
    }), 'utf8');

    const result = await runCommand(['openspec', 'render', '--request', requestPath, '--project', project, '--json']);
    const output = parseJsonOutput<{ applied: boolean; files: Array<{ path: string }> }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('openspec.render');
    expect(output.data.applied).toBe(false);
    expect(output.data.files.some((file) => file.path.endsWith('proposal.md'))).toBe(true);
  });

  test('renders an openspec change pack with --apply when no existing dir', async () => {
    const project = await makeProjectWithOpenSpec();
    const requestPath = join(project, 'render-apply.json');
    await writeFile(requestPath, JSON.stringify({
      changeId: 'rendered-applied',
      why: 'apply',
      whatChanges: ['x'],
      acceptanceCriteria: ['y'],
      tasks: [{ heading: '1. Section', todos: ['t1'] }],
      design: '# Design\n'
    }), 'utf8');

    const result = await runCommand(['openspec', 'render', '--request', requestPath, '--project', project, '--apply', '--json']);
    const output = parseJsonOutput<{ applied: boolean }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.applied).toBe(true);
  });

  test('passes --overwrite through to render when --apply is set', async () => {
    const project = await makeProjectWithOpenSpec();
    const requestPath = join(project, 'render-overwrite.json');
    await writeFile(requestPath, JSON.stringify({
      changeId: 'overwrite-target',
      why: 'over',
      whatChanges: ['y'],
      acceptanceCriteria: ['z']
    }), 'utf8');
    await mkdir(join(project, 'openspec', 'changes', 'overwrite-target'), { recursive: true });
    await writeFile(join(project, 'openspec', 'changes', 'overwrite-target', 'proposal.md'), 'old', 'utf8');

    const result = await runCommand(['openspec', 'render', '--request', requestPath, '--project', project, '--apply', '--overwrite', '--json']);
    const output = parseJsonOutput<{ applied: boolean }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.applied).toBe(true);
  });

  test('returns OPENSPEC_RENDER_FAILED when request JSON shape is invalid', async () => {
    const project = await makeProjectWithOpenSpec();
    const requestPath = join(project, 'bad-request.json');
    await writeFile(requestPath, '"not-an-object"', 'utf8');

    const result = await runCommand(['openspec', 'render', '--request', requestPath, '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('OPENSPEC_RENDER_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('validates a real openspec change and reports success', async () => {
    const result = await runCommand(['openspec', 'validate', 'add-tech-dry-run-gate', '--json']);
    const output = parseJsonOutput<{ valid: boolean; source: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('openspec.validate');
    expect(output.data.valid).toBe(true);
    expect(output.data.source).toBe('internal');
  });

  test('returns OPENSPEC_CHANGE_NOT_FOUND when validating a missing change', async () => {
    const result = await runCommand(['openspec', 'validate', 'no-such-change-id', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('OPENSPEC_CHANGE_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('returns OPENSPEC_VALIDATE_INVALID when proposal is missing', async () => {
    const project = await makeProjectWithOpenSpec();
    await mkdir(join(project, 'openspec', 'changes', 'broken'), { recursive: true });

    const result = await runCommand(['openspec', 'validate', 'broken', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('OPENSPEC_VALIDATE_INVALID');
    expect(result.exitCode).toBe(1);
  });

  test('passes --prefer-external through to the validator', async () => {
    const result = await runCommand(['openspec', 'validate', 'add-tech-dry-run-gate', '--prefer-external', '--json']);
    const output = parseJsonOutput<{ source: string; issues: Array<{ rule: string }> }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.source).toBe('internal');
    expect(output.data.issues.some((issue) => issue.rule === 'openspec-cli-unavailable')).toBe(true);
  });

  test('returns OPENSPEC_VALIDATE_FAILED when validation throws', async () => {
    const module = await import('../../src/services/openspec/openspec-validate-service.js');
    const spy = vi.spyOn(module, 'validateOpenSpecChange').mockRejectedValueOnce(new Error('synthetic validation failure'));

    const result = await runCommand(['openspec', 'validate', 'anything', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('OPENSPEC_VALIDATE_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });

  test('archive returns a dry-run preview by default', async () => {
    const project = await makeProjectWithOpenSpec();

    const result = await runCommand(['openspec', 'archive', 'sample-change', '--project', project, '--json']);
    const output = parseJsonOutput<{ applied: boolean; from: string; to: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('openspec.archive');
    expect(output.data.applied).toBe(false);
    expect(output.data.to).toContain('archive');
  });

  test('archive with --apply moves the change directory', async () => {
    const project = await makeProjectWithOpenSpec();

    const result = await runCommand(['openspec', 'archive', 'sample-change', '--project', project, '--apply', '--json']);
    const output = parseJsonOutput<{ applied: boolean }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.applied).toBe(true);
  });

  test('archive with --archive-dir customizes the target subdirectory', async () => {
    const project = await makeProjectWithOpenSpec();

    const result = await runCommand(['openspec', 'archive', 'sample-change', '--project', project, '--apply', '--archive-dir', 'shipped', '--json']);
    const output = parseJsonOutput<{ to: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.to).toContain(join('changes', 'shipped'));
  });

  test('archive returns OPENSPEC_CHANGE_NOT_FOUND when the source is missing', async () => {
    const project = await makeProjectWithOpenSpec();

    const result = await runCommand(['openspec', 'archive', 'never-existed', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('OPENSPEC_CHANGE_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('archive returns OPENSPEC_ARCHIVE_FAILED on invalid changeId', async () => {
    const result = await runCommand(['openspec', 'archive', '.hidden', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('OPENSPEC_ARCHIVE_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('normalizes trailing slash in --project path', async () => {
    const project = await makeProjectWithOpenSpec();
    const result = await runCommand(['openspec', 'list', '--project', `${project}/`, '--json']);
    const output = parseJsonOutput<{ exists: boolean }>(result.stdout);

    expect(output.data.exists).toBe(true);
  });

  describe('openspec init', () => {
    test('dry-run (default) plans writes without touching the filesystem', async () => {
      const project = await mkdtemp(join(tmpdir(), 'peaks-openspec-init-dry-'));
      const result = await runCommand(['openspec', 'init', '--project', project, '--json']);
      const output = parseJsonOutput<{
        ok: boolean;
        apply: boolean;
        alreadyInitialized: boolean;
        writtenFiles: string[];
        createdDirectories: string[];
        plannedWrites: Array<{ path: string; kind: string }>;
      }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.apply).toBe(false);
      expect(output.data.alreadyInitialized).toBe(false);
      expect(output.data.writtenFiles).toEqual([]);
      expect(output.data.createdDirectories).toEqual([]);

      const planPaths = output.data.plannedWrites.map((w) => w.path).sort();
      expect(planPaths).toEqual([
        join(project, 'openspec'),
        join(project, 'openspec', 'CHANGES.md'),
        join(project, 'openspec', 'README.md'),
        join(project, 'openspec', 'changes'),
        join(project, 'openspec', 'changes', 'archive')
      ].sort());

      // Nothing must be on disk after a dry run.
      const { existsSync } = await import('node:fs');
      expect(existsSync(join(project, 'openspec'))).toBe(false);
    });

    test('--apply scaffolds the openspec/ tree with README and CHANGES.md', async () => {
      const project = await mkdtemp(join(tmpdir(), 'peaks-openspec-init-apply-'));
      const result = await runCommand(['openspec', 'init', '--project', project, '--apply', '--json']);
      const output = parseJsonOutput<{
        ok: boolean;
        apply: boolean;
        alreadyInitialized: boolean;
        writtenFiles: string[];
        createdDirectories: string[];
      }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.apply).toBe(true);
      expect(output.data.alreadyInitialized).toBe(false);

      const { existsSync, readFileSync, statSync } = await import('node:fs');
      const openspecRoot = join(project, 'openspec');
      expect(existsSync(openspecRoot)).toBe(true);
      expect(existsSync(join(openspecRoot, 'changes'))).toBe(true);
      expect(existsSync(join(openspecRoot, 'changes', 'archive'))).toBe(true);
      expect(existsSync(join(openspecRoot, 'README.md'))).toBe(true);
      expect(existsSync(join(openspecRoot, 'CHANGES.md'))).toBe(true);

      const readme = readFileSync(join(openspecRoot, 'README.md'), 'utf8');
      expect(readme).toContain('render → validate');
      expect(readme).toContain('changes/');
      expect(readme).toContain('archive');

      const changes = readFileSync(join(openspecRoot, 'CHANGES.md'), 'utf8');
      expect(changes).toContain('# OpenSpec — change log');
      expect(changes).toContain('| Date | Change | Status |');

      // archive/ is a directory, not a file.
      expect(statSync(join(openspecRoot, 'changes', 'archive')).isDirectory()).toBe(true);

      expect(output.data.createdDirectories).toContain(join(openspecRoot, 'changes'));
      expect(output.data.writtenFiles).toContain(join(openspecRoot, 'README.md'));
      expect(output.data.writtenFiles).toContain(join(openspecRoot, 'CHANGES.md'));
    });

    test('is idempotent — second init against an existing openspec/ reports alreadyInitialized and does NOT overwrite', async () => {
      const project = await mkdtemp(join(tmpdir(), 'peaks-openspec-init-reinit-'));
      // First apply — fresh scaffold.
      const first = await runCommand(['openspec', 'init', '--project', project, '--apply', '--json']);
      expect(parseJsonOutput(first.stdout).ok).toBe(true);

      // Hand-modify README so we can detect any overwrite.
      const { readFileSync, writeFileSync } = await import('node:fs');
      const readmePath = join(project, 'openspec', 'README.md');
      writeFileSync(readmePath, '# USER-HAND-WRITTEN — must not be stomped', 'utf8');

      // Second apply — must report alreadyInitialized and leave README intact.
      const second = await runCommand(['openspec', 'init', '--project', project, '--apply', '--json']);
      const output = parseJsonOutput<{
        ok: boolean;
        alreadyInitialized: boolean;
        existingFiles: string[];
        writtenFiles: string[];
      }>(second.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.alreadyInitialized).toBe(true);
      expect(output.data.existingFiles).toContain(readmePath);
      expect(output.data.writtenFiles).toEqual([]);

      const after = readFileSync(readmePath, 'utf8');
      expect(after).toContain('USER-HAND-WRITTEN');
    });
  });
});
