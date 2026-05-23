import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { projectOpenSpecToRdInput } from '../../src/services/openspec/openspec-bridge-service.js';

async function makeOpenSpecRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'peaks-openspec-bridge-'));
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

const PROPOSAL = `# Change: bridge-sample
## Why

Sample reason text.

## What Changes

- Add foo
- Add bar

## Out of Scope

- Not this

## Dependencies

- dep-one

## Risks

- risk-one

## Acceptance Criteria

- accept-one
- accept-two
`;

const TASKS = `# Tasks

## 1. Discovery

- [ ] scan code
- [x] inventory complete

## 2. Implementation

- [ ] implement parser
- [ ] implement CLI
- [x] write tests
`;

describe('projectOpenSpecToRdInput', () => {
  test('returns null when the change does not exist', async () => {
    const root = await makeOpenSpecRoot();

    const projection = await projectOpenSpecToRdInput('nope', { openspecRoot: root });

    expect(projection).toBeNull();
  });

  test('projects proposal sections and task sections into an RD input shape', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'bridge-sample', { proposal: PROPOSAL, tasks: TASKS });

    const projection = await projectOpenSpecToRdInput('bridge-sample', { openspecRoot: root });

    expect(projection).not.toBeNull();
    expect(projection?.changeId).toBe('bridge-sample');
    expect(projection?.acceptance).toEqual(['accept-one', 'accept-two']);
    expect(projection?.whatChanges).toEqual(['Add foo', 'Add bar']);
    expect(projection?.dependencies).toEqual(['dep-one']);
    expect(projection?.risks).toEqual(['risk-one']);
    expect(projection?.outOfScope).toEqual(['Not this']);
    expect(projection?.commitBoundaries).toEqual([
      { heading: '1. Discovery', todos: ['scan code'], doneItems: ['inventory complete'] },
      { heading: '2. Implementation', todos: ['implement parser', 'implement CLI'], doneItems: ['write tests'] }
    ]);
  });

  test('returns empty proposal sections when proposal.md is absent', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'no-proposal', { tasks: TASKS });

    const projection = await projectOpenSpecToRdInput('no-proposal', { openspecRoot: root });

    expect(projection?.acceptance).toEqual([]);
    expect(projection?.whatChanges).toEqual([]);
    expect(projection?.dependencies).toEqual([]);
    expect(projection?.risks).toEqual([]);
    expect(projection?.outOfScope).toEqual([]);
    expect(projection?.commitBoundaries.length).toBeGreaterThan(0);
  });

  test('returns empty commit boundaries when tasks.md is absent', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'no-tasks', { proposal: PROPOSAL });

    const projection = await projectOpenSpecToRdInput('no-tasks', { openspecRoot: root });

    expect(projection?.commitBoundaries).toEqual([]);
  });

  test('ignores tasks lines that are not checkbox bullets', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'noisy', {
      tasks: `# Tasks\n\n## 1. Section\n\n- not a checkbox\n- [ ] real todo\n- [x] real done\n`
    });

    const projection = await projectOpenSpecToRdInput('noisy', { openspecRoot: root });

    expect(projection?.commitBoundaries[0]).toEqual({
      heading: '1. Section',
      todos: ['real todo'],
      doneItems: ['real done']
    });
  });

  test('drops empty sections that contain no checkboxes', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'mixed', {
      tasks: `# Tasks\n\n## 1. Empty\n\nNo checkboxes here.\n\n## 2. Has Items\n\n- [ ] something\n`
    });

    const projection = await projectOpenSpecToRdInput('mixed', { openspecRoot: root });

    expect(projection?.commitBoundaries).toEqual([
      { heading: '2. Has Items', todos: ['something'], doneItems: [] }
    ]);
  });

  test('projects a real project openspec change without throwing', async () => {
    const projection = await projectOpenSpecToRdInput('add-tech-dry-run-gate');

    expect(projection).not.toBeNull();
    expect(projection?.acceptance.length).toBeGreaterThan(0);
    expect(projection?.commitBoundaries.length).toBeGreaterThan(0);
  });
});
