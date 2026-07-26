import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const BIN_TIMEOUT_MS = 60_000;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runCli(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BIN_TIMEOUT_MS,
      env: { ...process.env, PEAKS_CALLER_ID: 'openspec-archive-coverage-gate-e2e' }
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (error: unknown) {
    const caught = error as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: typeof caught.stdout === 'string' ? caught.stdout : caught.stdout?.toString('utf8') ?? '',
      stderr: typeof caught.stderr === 'string' ? caught.stderr : caught.stderr?.toString('utf8') ?? '',
      code: caught.status ?? 1,
    };
  }
}

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-archive-gate-'));
}

function seedChangeWithEvidence(opts: {
  projectRoot: string;
  changeId: string;
  coverageBlock?: string;
  hasSpecs?: boolean;
}): void {
  const { projectRoot, changeId, hasSpecs = true } = opts;
  const coverageBlock = opts.coverageBlock ?? [
    '| capability | requirement | status | testAnchor |',
    '| --- | --- | --- | --- |',
    '| quality-gates | 100% coverage for included modules | covered | tests/unit/quality-gates.test.ts |',
    '| quality-gates | MVP implementation verification commands | covered | tests/unit/quality-gates.test.ts |'
  ].join('\n');

  const changeRoot = join(projectRoot, 'openspec', 'changes', changeId);
  const fs = require('node:fs') as typeof import('node:fs');
  fs.mkdirSync(changeRoot, { recursive: true });
  fs.writeFileSync(
    join(changeRoot, 'proposal.md'),
    [
      `# Change: ${changeId}`,
      '',
      '## Why',
      '',
      'Test change for coverage gate.',
      '',
      '## Acceptance Criteria',
      '',
      '- Behavior X works.',
      '',
      '## Coverage Evidence',
      '',
      ...coverageBlock.split('\n')
    ].join('\n'),
    'utf8'
  );

  if (hasSpecs) {
    const specDir = join(changeRoot, 'specs', 'quality-gates');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      join(specDir, 'spec.md'),
      '# Spec Delta: quality-gates\n\n## ADDED Requirements\n\n### Requirement: 100% coverage for included modules\n\nBody.\n\n### Requirement: MVP implementation verification commands\n\nBody.\n',
      'utf8'
    );
  }
}

const tmpRoots: string[] = [];
afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('peaks openspec archive -- coverage gate (Pre-cond 2)', () => {
  test('archive --apply with full-coverage evidence succeeds', () => {
    const projectRoot = makeProject();
    tmpRoots.push(projectRoot);
    seedChangeWithEvidence({ projectRoot, changeId: 'fully-covered' });

    const result = runCli(
      ['openspec', 'archive', 'fully-covered', '--project', projectRoot, '--apply', '--json'],
      projectRoot
    );

    expect(result.code, `stderr=${result.stderr}\nstdout=${result.stdout}`).toBe(0);
    expect(existsSync(join(projectRoot, 'openspec', 'changes', 'fully-covered'))).toBe(false);
    expect(existsSync(join(projectRoot, 'openspec', 'changes', 'archive', 'fully-covered', 'proposal.md'))).toBe(true);
  });

  test('archive --apply without a Coverage Evidence block refuses the gate', () => {
    const projectRoot = makeProject();
    tmpRoots.push(projectRoot);
    // Same proposal scaffold but without the Coverage Evidence heading.
    const changeRoot = join(projectRoot, 'openspec', 'changes', 'no-evidence');
    const fs = require('node:fs') as typeof import('node:fs');
    fs.mkdirSync(join(changeRoot, 'specs', 'quality-gates'), { recursive: true });
    fs.writeFileSync(
      join(changeRoot, 'proposal.md'),
      '# Change: no-evidence\n\n## Why\n\nNo coverage evidence block.\n',
      'utf8'
    );
    fs.writeFileSync(
      join(changeRoot, 'specs', 'quality-gates', 'spec.md'),
      '# Spec Delta: quality-gates\n\n## ADDED Requirements\n\n### Requirement: 100% coverage for included modules\n',
      'utf8'
    );

    const result = runCli(
      ['openspec', 'archive', 'no-evidence', '--project', projectRoot, '--apply', '--json'],
      projectRoot
    );

    expect(result.code, `stderr=${result.stderr}\nstdout=${result.stdout}`).toBe(1);
    const json = JSON.parse(result.stdout) as { ok: boolean; code: string; data: Record<string, unknown> };
    expect(json.ok).toBe(false);
    expect(json.code).toBe('OPENSPEC_COVERAGE_GATE_FAILED');
    expect(json.data).toMatchObject({ reason: 'no-coverage-evidence-block', changeId: 'no-evidence' });
    // No filesystem move happened.
    expect(existsSync(join(projectRoot, 'openspec', 'changes', 'no-evidence'))).toBe(true);
  });

  test('archive --apply with partial coverage refuses the gate and lists failing requirements', () => {
    const projectRoot = makeProject();
    tmpRoots.push(projectRoot);
    seedChangeWithEvidence({
      projectRoot,
      changeId: 'partial-coverage',
      coverageBlock: [
        '| capability | requirement | status | testAnchor |',
        '| --- | --- | --- | --- |',
        '| quality-gates | 100% coverage for included modules | covered | tests/unit/quality-gates.test.ts |',
        '| quality-gates | MVP implementation verification commands | partial | tests/unit/quality-gates.test.ts |'
      ].join('\n'),
    });

    const result = runCli(
      ['openspec', 'archive', 'partial-coverage', '--project', projectRoot, '--apply', '--json'],
      projectRoot
    );

    expect(result.code, `stderr=${result.stderr}\nstdout=${result.stdout}`).toBe(1);
    const json = JSON.parse(result.stdout) as {
      ok: boolean;
      code: string;
      data: { failing: Array<{ requirement: string; status: string }>; reason: string };
    };
    expect(json.ok).toBe(false);
    expect(json.code).toBe('OPENSPEC_COVERAGE_GATE_PARTIAL');
    expect(json.data.reason).toBe('requirement-not-fully-covered');
    expect(json.data.failing).toEqual([
      expect.objectContaining({ requirement: 'MVP implementation verification commands', status: 'partial' })
    ]);
    expect(existsSync(join(projectRoot, 'openspec', 'changes', 'partial-coverage'))).toBe(true);
  });

  test('archive --apply with --force bypasses a partial gate and emits a warning', () => {
    const projectRoot = makeProject();
    tmpRoots.push(projectRoot);
    seedChangeWithEvidence({
      projectRoot,
      changeId: 'forced-archive',
      coverageBlock: [
        '| capability | requirement | status | testAnchor |',
        '| --- | --- | --- | --- |',
        '| quality-gates | 100% coverage for included modules | uncovered | (none) |'
      ].join('\n'),
    });

    const result = runCli(
      ['openspec', 'archive', 'forced-archive', '--project', projectRoot, '--apply', '--force', '--json'],
      projectRoot
    );

    expect(result.code, `stderr=${result.stderr}\nstdout=${result.stdout}`).toBe(0);
    const json = JSON.parse(result.stdout) as {
      ok: boolean;
      data: { applied: boolean; coverageGateBypassed: boolean };
      warnings: string[];
    };
    expect(json.ok).toBe(true);
    expect(json.data.applied).toBe(true);
    expect(json.data.coverageGateBypassed).toBe(true);
    expect(json.warnings.some((w) => /bypassed via --force/.test(w))).toBe(true);
    expect(existsSync(join(projectRoot, 'openspec', 'changes', 'archive', 'forced-archive'))).toBe(true);
  });

  test('archive (dry-run) never blocks even when evidence is missing', () => {
    const projectRoot = makeProject();
    tmpRoots.push(projectRoot);
    const changeRoot = join(projectRoot, 'openspec', 'changes', 'dry-run-no-evidence');
    const fs = require('node:fs') as typeof import('node:fs');
    fs.mkdirSync(join(changeRoot, 'specs', 'quality-gates'), { recursive: true });
    fs.writeFileSync(join(changeRoot, 'proposal.md'), '# Change: dry-run-no-evidence\n', 'utf8');
    fs.writeFileSync(join(changeRoot, 'specs', 'quality-gates', 'spec.md'), '# Spec Delta: quality-gates\n', 'utf8');

    const result = runCli(
      ['openspec', 'archive', 'dry-run-no-evidence', '--project', projectRoot, '--json'],
      projectRoot
    );

    expect(result.code, `stderr=${result.stderr}\nstdout=${result.stdout}`).toBe(0);
    const json = JSON.parse(result.stdout) as { ok: boolean; data: { applied: boolean } };
    expect(json.ok).toBe(true);
    expect(json.data.applied).toBe(false);
  });

  test('archive --apply on a spec-less change skips the gate (back-compat)', () => {
    const projectRoot = makeProject();
    tmpRoots.push(projectRoot);
    seedChangeWithEvidence({ projectRoot, changeId: 'specless', hasSpecs: false });

    const result = runCli(
      ['openspec', 'archive', 'specless', '--project', projectRoot, '--apply', '--json'],
      projectRoot
    );

    expect(result.code, `stderr=${result.stderr}\nstdout=${result.stdout}`).toBe(0);
    expect(existsSync(join(projectRoot, 'openspec', 'changes', 'archive', 'specless'))).toBe(true);
  });
});