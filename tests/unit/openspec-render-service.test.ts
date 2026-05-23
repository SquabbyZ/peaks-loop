import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { pathExists } from '../../src/shared/fs.js';
import { renderOpenSpecChange, type OpenSpecRenderRequest } from '../../src/services/openspec/openspec-render-service.js';

async function makeOpenSpecRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-openspec-render-'));
}

function fullRequest(): OpenSpecRenderRequest {
  return {
    changeId: 'add-foo',
    why: 'Because reasons.',
    whatChanges: ['Add foo', 'Add bar'],
    outOfScope: ['Skip baz'],
    dependencies: ['dep-one'],
    risks: ['risk-one'],
    acceptanceCriteria: ['accept-one', 'accept-two'],
    tasks: [
      { heading: '1. Discovery', todos: ['scan code', 'inventory'], doneItems: ['confirm scope'] },
      { heading: '2. Implementation', todos: ['implement parser'] }
    ],
    design: '# Design Notes\n\nKeep it simple.\n'
  };
}

describe('renderOpenSpecChange (dry-run)', () => {
  test('produces proposal, tasks, and design content without writing files', async () => {
    const root = await makeOpenSpecRoot();

    const result = await renderOpenSpecChange(fullRequest(), { openspecRoot: root });

    expect(result.applied).toBe(false);
    expect(result.changeId).toBe('add-foo');
    expect(result.changeRoot).toBe(join(root, 'changes', 'add-foo'));

    const proposal = result.files.find((file) => file.path.endsWith('proposal.md'));
    expect(proposal?.content).toContain('# Change: add-foo');
    expect(proposal?.content).toContain('## Why\n\nBecause reasons.');
    expect(proposal?.content).toContain('- Add foo');
    expect(proposal?.content).toContain('- accept-two');
    expect(proposal?.content).toContain('## Out of Scope\n\n- Skip baz');

    const tasks = result.files.find((file) => file.path.endsWith('tasks.md'));
    expect(tasks?.content).toContain('## 1. Discovery');
    expect(tasks?.content).toContain('- [ ] scan code');
    expect(tasks?.content).toContain('- [x] confirm scope');
    expect(tasks?.content).toContain('## 2. Implementation');
    expect(tasks?.content).toContain('- [ ] implement parser');

    const design = result.files.find((file) => file.path.endsWith('design.md'));
    expect(design?.content).toBe('# Design Notes\n\nKeep it simple.\n');

    expect(await pathExists(join(root, 'changes', 'add-foo'))).toBe(false);
  });

  test('omits tasks.md and design.md when not provided', async () => {
    const root = await makeOpenSpecRoot();
    const request: OpenSpecRenderRequest = {
      changeId: 'lean',
      why: 'short',
      whatChanges: ['only this'],
      acceptanceCriteria: ['done']
    };

    const result = await renderOpenSpecChange(request, { openspecRoot: root });

    const paths = result.files.map((file) => file.path);
    expect(paths.some((path) => path.endsWith('proposal.md'))).toBe(true);
    expect(paths.some((path) => path.endsWith('tasks.md'))).toBe(false);
    expect(paths.some((path) => path.endsWith('design.md'))).toBe(false);
  });

  test('renders empty why as _None_ placeholder', async () => {
    const root = await makeOpenSpecRoot();
    const request: OpenSpecRenderRequest = {
      changeId: 'no-why',
      why: '',
      whatChanges: ['change'],
      acceptanceCriteria: ['done']
    };

    const result = await renderOpenSpecChange(request, { openspecRoot: root });
    const proposal = result.files.find((file) => file.path.endsWith('proposal.md'));

    expect(proposal?.content).toContain('## Why\n\n_None_');
  });

  test('renders empty proposal sections as headings without bullets when arrays are empty', async () => {
    const root = await makeOpenSpecRoot();
    const request: OpenSpecRenderRequest = {
      changeId: 'sparse',
      why: 'because',
      whatChanges: [],
      outOfScope: [],
      acceptanceCriteria: []
    };

    const result = await renderOpenSpecChange(request, { openspecRoot: root });
    const proposal = result.files.find((file) => file.path.endsWith('proposal.md'));

    expect(proposal?.content).toContain('## What Changes\n\n_None_');
    expect(proposal?.content).toContain('## Acceptance Criteria\n\n_None_');
  });
});

describe('renderOpenSpecChange (apply)', () => {
  test('writes proposal/tasks/design to disk when apply is true', async () => {
    const root = await makeOpenSpecRoot();

    const result = await renderOpenSpecChange(fullRequest(), { openspecRoot: root, apply: true });

    expect(result.applied).toBe(true);
    expect(await pathExists(join(root, 'changes', 'add-foo', 'proposal.md'))).toBe(true);
    expect(await pathExists(join(root, 'changes', 'add-foo', 'tasks.md'))).toBe(true);
    expect(await pathExists(join(root, 'changes', 'add-foo', 'design.md'))).toBe(true);

    const proposal = await readFile(join(root, 'changes', 'add-foo', 'proposal.md'), 'utf8');
    expect(proposal).toContain('# Change: add-foo');
  });

  test('refuses to overwrite an existing change directory without overwrite', async () => {
    const root = await makeOpenSpecRoot();
    await mkdir(join(root, 'changes', 'add-foo'), { recursive: true });
    await writeFile(join(root, 'changes', 'add-foo', 'proposal.md'), 'existing', 'utf8');

    await expect(
      renderOpenSpecChange(fullRequest(), { openspecRoot: root, apply: true })
    ).rejects.toThrowError(/exists/i);

    const proposal = await readFile(join(root, 'changes', 'add-foo', 'proposal.md'), 'utf8');
    expect(proposal).toBe('existing');
  });

  test('overwrites an existing change directory when overwrite is true', async () => {
    const root = await makeOpenSpecRoot();
    await mkdir(join(root, 'changes', 'add-foo'), { recursive: true });
    await writeFile(join(root, 'changes', 'add-foo', 'proposal.md'), 'old proposal', 'utf8');

    const result = await renderOpenSpecChange(fullRequest(), { openspecRoot: root, apply: true, overwrite: true });

    expect(result.applied).toBe(true);
    const proposal = await readFile(join(root, 'changes', 'add-foo', 'proposal.md'), 'utf8');
    expect(proposal).toContain('# Change: add-foo');
  });

  test('rejects invalid changeId with letters/digits/dashes only', async () => {
    const root = await makeOpenSpecRoot();

    await expect(
      renderOpenSpecChange({ ...fullRequest(), changeId: '../escape' }, { openspecRoot: root })
    ).rejects.toThrowError(/changeId/);

    await expect(
      renderOpenSpecChange({ ...fullRequest(), changeId: '' }, { openspecRoot: root })
    ).rejects.toThrowError(/changeId/);
  });

  test('defaults openspecRoot to <cwd>/openspec when not provided', async () => {
    const request: OpenSpecRenderRequest = {
      changeId: 'default-root-dryrun',
      why: 'x',
      whatChanges: [],
      acceptanceCriteria: []
    };

    const result = await renderOpenSpecChange(request);

    expect(result.changeRoot).toBe(join(process.cwd(), 'openspec', 'changes', 'default-root-dryrun'));
    expect(result.applied).toBe(false);
  });
});
