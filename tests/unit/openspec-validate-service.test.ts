import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { validateOpenSpecChange, type OpenSpecValidateOptions } from '../../src/services/openspec/openspec-validate-service.js';

async function makeOpenSpecRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'peaks-openspec-validate-'));
  await mkdir(join(root, 'changes'), { recursive: true });
  return root;
}

async function writeChange(
  root: string,
  id: string,
  files: { proposal?: string; tasks?: string }
): Promise<void> {
  const changeRoot = join(root, 'changes', id);
  await mkdir(changeRoot, { recursive: true });
  if (files.proposal !== undefined) {
    await writeFile(join(changeRoot, 'proposal.md'), files.proposal, 'utf8');
  }
  if (files.tasks !== undefined) {
    await writeFile(join(changeRoot, 'tasks.md'), files.tasks, 'utf8');
  }
}

const VALID_PROPOSAL = `# Change: valid
## Why

Real reason.

## What Changes

- Add one
- Add two

## Out of Scope

- Skip this

## Dependencies

- dep

## Risks

- risk

## Acceptance Criteria

- accept one
- accept two
`;

function externalRunnerStub(result: { ok: boolean; stdout?: string; stderr?: string; exitCode?: number }) {
  return vi.fn().mockResolvedValue({
    available: true,
    exitCode: result.exitCode ?? (result.ok ? 0 : 1),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  });
}

function noExternalRunner() {
  return vi.fn().mockResolvedValue({ available: false, exitCode: null, stdout: '', stderr: '' });
}

describe('validateOpenSpecChange (internal lint)', () => {
  test('returns null when the change does not exist', async () => {
    const root = await makeOpenSpecRoot();

    const result = await validateOpenSpecChange('nope', { openspecRoot: root, externalRunner: noExternalRunner() });

    expect(result).toBeNull();
  });

  test('passes a fully populated proposal with no issues', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'valid', { proposal: VALID_PROPOSAL });

    const result = await validateOpenSpecChange('valid', { openspecRoot: root, externalRunner: noExternalRunner() });

    expect(result?.valid).toBe(true);
    expect(result?.source).toBe('internal');
    expect(result?.issues.filter((issue) => issue.level === 'error')).toEqual([]);
  });

  test('reports missing proposal.md as a hard error', async () => {
    const root = await makeOpenSpecRoot();
    await mkdir(join(root, 'changes', 'no-proposal'), { recursive: true });

    const result = await validateOpenSpecChange('no-proposal', { openspecRoot: root, externalRunner: noExternalRunner() });

    expect(result?.valid).toBe(false);
    expect(result?.issues.some((issue) => issue.rule === 'proposal-exists' && issue.level === 'error')).toBe(true);
  });

  test('reports empty What Changes as a hard error', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'empty-what', {
      proposal: `# Change: empty-what\n## Why\n\nx\n\n## What Changes\n\n## Acceptance Criteria\n\n- y\n`
    });

    const result = await validateOpenSpecChange('empty-what', { openspecRoot: root, externalRunner: noExternalRunner() });

    expect(result?.valid).toBe(false);
    expect(result?.issues.some((issue) => issue.rule === 'what-changes-non-empty')).toBe(true);
  });

  test('reports empty Acceptance Criteria as a hard error', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'empty-accept', {
      proposal: `# Change: empty-accept\n## Why\n\nx\n\n## What Changes\n\n- y\n\n## Acceptance Criteria\n`
    });

    const result = await validateOpenSpecChange('empty-accept', { openspecRoot: root, externalRunner: noExternalRunner() });

    expect(result?.valid).toBe(false);
    expect(result?.issues.some((issue) => issue.rule === 'acceptance-non-empty')).toBe(true);
  });

  test('warns when Why is empty', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'empty-why', {
      proposal: `# Change: empty-why\n## Why\n\n## What Changes\n\n- x\n\n## Acceptance Criteria\n\n- y\n`
    });

    const result = await validateOpenSpecChange('empty-why', { openspecRoot: root, externalRunner: noExternalRunner() });

    expect(result?.issues.some((issue) => issue.rule === 'why-non-empty' && issue.level === 'warning')).toBe(true);
    expect(result?.valid).toBe(true);
  });

  test('reports invalid changeId as an error', async () => {
    const root = await makeOpenSpecRoot();
    await mkdir(join(root, 'changes', '.hidden'), { recursive: true });
    await writeFile(join(root, 'changes', '.hidden', 'proposal.md'), VALID_PROPOSAL, 'utf8');

    const result = await validateOpenSpecChange('.hidden', { openspecRoot: root, externalRunner: noExternalRunner() });

    expect(result?.valid).toBe(false);
    expect(result?.issues.some((issue) => issue.rule === 'change-id-format')).toBe(true);
  });

  test('defaults openspec root to <cwd>/openspec when not provided', async () => {
    const result = await validateOpenSpecChange('add-tech-dry-run-gate', { externalRunner: noExternalRunner() });

    expect(result).not.toBeNull();
    expect(result?.source).toBe('internal');
  });
});

describe('validateOpenSpecChange (external CLI delegation)', () => {
  test('uses the external runner when preferExternal is true and openspec CLI is available', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'ext-pass', { proposal: VALID_PROPOSAL });
    const runner = externalRunnerStub({ ok: true, stdout: 'openspec: valid\n' });

    const result = await validateOpenSpecChange('ext-pass', { openspecRoot: root, preferExternal: true, externalRunner: runner });

    expect(result?.source).toBe('openspec-cli');
    expect(result?.valid).toBe(true);
    expect(result?.cliOutput).toContain('valid');
    expect(runner).toHaveBeenCalled();
  });

  test('records cli failure as invalid and surfaces stderr', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'ext-fail', { proposal: VALID_PROPOSAL });
    const runner = externalRunnerStub({ ok: false, stderr: 'openspec: missing required section', exitCode: 2 });

    const result = await validateOpenSpecChange('ext-fail', { openspecRoot: root, preferExternal: true, externalRunner: runner });

    expect(result?.source).toBe('openspec-cli');
    expect(result?.valid).toBe(false);
    expect(result?.cliOutput).toContain('missing required section');
    expect(result?.issues.some((issue) => issue.rule === 'openspec-cli-failed')).toBe(true);
  });

  test('records null exit code when the external CLI is available but did not finish cleanly', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'ext-null-exit', { proposal: VALID_PROPOSAL });
    const runner = vi.fn().mockResolvedValue({ available: true, exitCode: null, stdout: '', stderr: 'killed' });

    const result = await validateOpenSpecChange('ext-null-exit', { openspecRoot: root, preferExternal: true, externalRunner: runner });

    expect(result?.valid).toBe(false);
    expect(result?.issues[0]?.message).toContain('null');
  });

  test('falls back to internal lint when preferExternal is true but openspec CLI is not available', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'fallback', { proposal: VALID_PROPOSAL });
    const runner = vi.fn().mockResolvedValue({ available: false, exitCode: null, stdout: '', stderr: '' });

    const result = await validateOpenSpecChange('fallback', { openspecRoot: root, preferExternal: true, externalRunner: runner });

    expect(result?.source).toBe('internal');
    expect(result?.issues.some((issue) => issue.rule === 'openspec-cli-unavailable' && issue.level === 'warning')).toBe(true);
  });
});

describe('validateOpenSpecChange default external runner', () => {
  test('uses internal lint when neither preferExternal nor externalRunner is set', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'plain', { proposal: VALID_PROPOSAL });

    const result = await validateOpenSpecChange('plain', { openspecRoot: root });

    expect(result?.source).toBe('internal');
    expect(result?.valid).toBe(true);
  });

  test('uses built-in default external runner (reports unavailable and falls back) when only preferExternal is set', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'default-runner', { proposal: VALID_PROPOSAL });

    const result = await validateOpenSpecChange('default-runner', { openspecRoot: root, preferExternal: true });

    expect(result?.source).toBe('internal');
    expect(result?.issues.some((issue) => issue.rule === 'openspec-cli-unavailable')).toBe(true);
  });

  test('returns null when preferExternal is set, runner is unavailable, and the change does not exist', async () => {
    const root = await makeOpenSpecRoot();

    const result = await validateOpenSpecChange('missing-change', { openspecRoot: root, preferExternal: true, externalRunner: noExternalRunner() });

    expect(result).toBeNull();
  });
});

describe('validateOpenSpecChange option wiring', () => {
  test('respects custom externalRunner via options', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'custom', { proposal: VALID_PROPOSAL });
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: OpenSpecValidateOptions['externalRunner'] = async (command, args) => {
      calls.push({ command, args });
      return { available: true, exitCode: 0, stdout: 'ok', stderr: '' };
    };

    await validateOpenSpecChange('custom', { openspecRoot: root, preferExternal: true, externalRunner: runner });

    expect(calls[0]?.command).toBe('openspec');
    expect(calls[0]?.args).toEqual(['validate', 'custom']);
  });
});
