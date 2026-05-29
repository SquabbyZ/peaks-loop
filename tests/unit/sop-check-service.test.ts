import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { checkGate, SopCheckError } from '../../src/services/sop/sop-check-service.js';
import type { SopGate, SopManifest } from '../../src/services/sop/sop-types.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-sopcheck-'));
}

async function seed(project: string, id: string, gates: SopGate[]): Promise<void> {
  const manifest: SopManifest = { id, name: id, description: '', phases: ['p'], gates };
  const dir = join(project, '.peaks', 'sops', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sop.json'), JSON.stringify(manifest), 'utf8');
}

describe('checkGate — file-exists', () => {
  test('pass when the file exists, fail when it does not', async () => {
    const project = await makeProject();
    await writeFile(join(project, 'CHANGELOG.md'), '# changes\n', 'utf8');
    await seed(project, 's', [
      { id: 'present', phase: 'p', check: { type: 'file-exists', path: 'CHANGELOG.md' } },
      { id: 'absent', phase: 'p', check: { type: 'file-exists', path: 'NOPE.md' } }
    ]);
    expect((await checkGate({ projectRoot: project, id: 's', gateId: 'present' })).result).toBe('pass');
    expect((await checkGate({ projectRoot: project, id: 's', gateId: 'absent' })).result).toBe('fail');
  });

  test('blocked when the path escapes the project root', async () => {
    const project = await makeProject();
    await seed(project, 's', [{ id: 'escape', phase: 'p', check: { type: 'file-exists', path: '../../etc/hosts' } }]);
    const result = await checkGate({ projectRoot: project, id: 's', gateId: 'escape' });
    expect(result.result).toBe('blocked');
    expect(result.reason).toMatch(/escapes the project root/);
  });
});

describe('checkGate — grep', () => {
  test('pass when the pattern matches, fail when it does not', async () => {
    const project = await makeProject();
    await mkdir(join(project, 'src'), { recursive: true });
    await writeFile(join(project, 'src', 'a.ts'), 'export const VERSION = 1;\n', 'utf8');
    await seed(project, 's', [
      { id: 'has-version', phase: 'p', check: { type: 'grep', file: 'src/a.ts', pattern: 'VERSION' } },
      { id: 'no-fixme', phase: 'p', check: { type: 'grep', file: 'src/a.ts', pattern: 'FIXME' } }
    ]);
    expect((await checkGate({ projectRoot: project, id: 's', gateId: 'has-version' })).result).toBe('pass');
    expect((await checkGate({ projectRoot: project, id: 's', gateId: 'no-fixme' })).result).toBe('fail');
  });

  test('blocked when the target file is missing or the pattern is invalid', async () => {
    const project = await makeProject();
    await writeFile(join(project, 'real.txt'), 'x', 'utf8');
    await seed(project, 's', [
      { id: 'missing', phase: 'p', check: { type: 'grep', file: 'ghost.txt', pattern: 'x' } },
      { id: 'bad-regex', phase: 'p', check: { type: 'grep', file: 'real.txt', pattern: '(' } }
    ]);
    expect((await checkGate({ projectRoot: project, id: 's', gateId: 'missing' })).result).toBe('blocked');
    expect((await checkGate({ projectRoot: project, id: 's', gateId: 'bad-regex' })).result).toBe('blocked');
  });
});

describe('checkGate — command', () => {
  test('blocked unless commands are explicitly allowed', async () => {
    const project = await makeProject();
    await seed(project, 's', [{ id: 'tests', phase: 'p', check: { type: 'command', run: [process.execPath, '-e', 'process.exit(0)'] } }]);
    const blocked = await checkGate({ projectRoot: project, id: 's', gateId: 'tests' });
    expect(blocked.result).toBe('blocked');
    expect(blocked.reason).toMatch(/--allow-commands/);
  });

  test('pass on exit 0, fail on non-zero (expectExitZero default)', async () => {
    const project = await makeProject();
    await seed(project, 's', [
      { id: 'ok', phase: 'p', check: { type: 'command', run: [process.execPath, '-e', 'process.exit(0)'] } },
      { id: 'bad', phase: 'p', check: { type: 'command', run: [process.execPath, '-e', 'process.exit(3)'] } }
    ]);
    expect((await checkGate({ projectRoot: project, id: 's', gateId: 'ok', allowCommands: true })).result).toBe('pass');
    expect((await checkGate({ projectRoot: project, id: 's', gateId: 'bad', allowCommands: true })).result).toBe('fail');
  });

  test('expectExitZero:false inverts the verdict', async () => {
    const project = await makeProject();
    await seed(project, 's', [{ id: 'inv', phase: 'p', check: { type: 'command', run: [process.execPath, '-e', 'process.exit(1)'], expectExitZero: false } }]);
    expect((await checkGate({ projectRoot: project, id: 's', gateId: 'inv', allowCommands: true })).result).toBe('pass');
  });

  test('blocked when the binary cannot be spawned', async () => {
    const project = await makeProject();
    await seed(project, 's', [{ id: 'ghost', phase: 'p', check: { type: 'command', run: ['peaks-no-such-binary-xyz'] } }]);
    const result = await checkGate({ projectRoot: project, id: 's', gateId: 'ghost', allowCommands: true });
    expect(result.result).toBe('blocked');
    expect(result.reason).toMatch(/could not be run/);
  });

  test('blocked (not crash) when an unvalidated command gate has an empty run array', async () => {
    const project = await makeProject();
    await seed(project, 's', [{ id: 'empty', phase: 'p', check: { type: 'command', run: [] } }]);
    const result = await checkGate({ projectRoot: project, id: 's', gateId: 'empty', allowCommands: true });
    expect(result.result).toBe('blocked');
    expect(result.reason).toMatch(/no executable/);
  });

  test('blocked when the command exceeds the timeout', async () => {
    const project = await makeProject();
    await seed(project, 's', [{ id: 'slow', phase: 'p', check: { type: 'command', run: [process.execPath, '-e', 'setTimeout(()=>{}, 5000)'] } }]);
    const result = await checkGate({ projectRoot: project, id: 's', gateId: 'slow', allowCommands: true, commandTimeoutMs: 150 });
    expect(result.result).toBe('blocked');
    expect(result.reason).toMatch(/timed out/);
  });
});

describe('checkGate — evaluator errors (ok:false territory)', () => {
  test('throws SOP_NOT_FOUND for a missing SOP', async () => {
    const project = await makeProject();
    await expect(checkGate({ projectRoot: project, id: 'ghost', gateId: 'g' })).rejects.toMatchObject({ code: 'SOP_NOT_FOUND' });
  });

  test('throws GATE_NOT_FOUND for an unknown gate id', async () => {
    const project = await makeProject();
    await seed(project, 's', [{ id: 'real', phase: 'p', check: { type: 'file-exists', path: 'x' } }]);
    await expect(checkGate({ projectRoot: project, id: 's', gateId: 'nope' })).rejects.toBeInstanceOf(SopCheckError);
  });
});
