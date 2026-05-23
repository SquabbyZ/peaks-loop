import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { pathExists } from '../../src/shared/fs.js';
import { archiveOpenSpecChange } from '../../src/services/openspec/openspec-archive-service.js';

async function makeOpenSpecRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'peaks-openspec-archive-'));
  await mkdir(join(root, 'changes'), { recursive: true });
  return root;
}

async function seedChange(root: string, id: string): Promise<void> {
  const changeRoot = join(root, 'changes', id);
  await mkdir(changeRoot, { recursive: true });
  await writeFile(join(changeRoot, 'proposal.md'), `# Change: ${id}\n`, 'utf8');
}

describe('archiveOpenSpecChange (dry-run)', () => {
  test('returns null when the source change does not exist', async () => {
    const root = await makeOpenSpecRoot();

    const result = await archiveOpenSpecChange('nope', { openspecRoot: root });

    expect(result).toBeNull();
  });

  test('returns a preview without moving files when apply is false', async () => {
    const root = await makeOpenSpecRoot();
    await seedChange(root, 'ready-to-archive');

    const result = await archiveOpenSpecChange('ready-to-archive', { openspecRoot: root });

    expect(result?.applied).toBe(false);
    expect(result?.from).toBe(join(root, 'changes', 'ready-to-archive'));
    expect(result?.to).toBe(join(root, 'changes', 'archive', 'ready-to-archive'));
    expect(await pathExists(join(root, 'changes', 'ready-to-archive'))).toBe(true);
    expect(await pathExists(join(root, 'changes', 'archive', 'ready-to-archive'))).toBe(false);
  });

  test('rejects invalid changeIds before touching the filesystem', async () => {
    const root = await makeOpenSpecRoot();

    await expect(
      archiveOpenSpecChange('.hidden', { openspecRoot: root })
    ).rejects.toThrowError(/changeId/);
  });
});

describe('archiveOpenSpecChange (apply)', () => {
  test('moves the change directory under changes/archive/<id>/', async () => {
    const root = await makeOpenSpecRoot();
    await seedChange(root, 'moving');

    const result = await archiveOpenSpecChange('moving', { openspecRoot: root, apply: true });

    expect(result?.applied).toBe(true);
    expect(await pathExists(join(root, 'changes', 'moving'))).toBe(false);
    expect(await pathExists(join(root, 'changes', 'archive', 'moving', 'proposal.md'))).toBe(true);
  });

  test('refuses to overwrite an existing archived entry', async () => {
    const root = await makeOpenSpecRoot();
    await seedChange(root, 'duplicate');
    await mkdir(join(root, 'changes', 'archive', 'duplicate'), { recursive: true });
    await writeFile(join(root, 'changes', 'archive', 'duplicate', 'proposal.md'), 'old', 'utf8');

    await expect(
      archiveOpenSpecChange('duplicate', { openspecRoot: root, apply: true })
    ).rejects.toThrowError(/archive/i);

    expect(await pathExists(join(root, 'changes', 'duplicate'))).toBe(true);
  });

  test('respects a custom archive directory name', async () => {
    const root = await makeOpenSpecRoot();
    await seedChange(root, 'custom-dir');

    const result = await archiveOpenSpecChange('custom-dir', { openspecRoot: root, apply: true, archiveDirName: 'shipped' });

    expect(result?.to).toBe(join(root, 'changes', 'shipped', 'custom-dir'));
    expect(await pathExists(join(root, 'changes', 'shipped', 'custom-dir', 'proposal.md'))).toBe(true);
  });

  test('defaults openspec root to <cwd>/openspec when not provided', async () => {
    const result = await archiveOpenSpecChange('never-existed-default-root');

    expect(result).toBeNull();
  });
});
