import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadOpenSpecChange, scanOpenSpec } from '../../src/services/openspec/openspec-scan-service.js';

async function makeOpenSpecRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'peaks-openspec-'));
  await mkdir(join(root, 'changes'), { recursive: true });
  return root;
}

async function writeChange(
  root: string,
  id: string,
  files: { proposal?: string; tasks?: string; design?: string; specs?: Record<string, string> }
): Promise<void> {
  const changeRoot = join(root, 'changes', id);
  await mkdir(changeRoot, { recursive: true });
  if (files.proposal !== undefined) {
    await writeFile(join(changeRoot, 'proposal.md'), files.proposal, 'utf8');
  }
  if (files.tasks !== undefined) {
    await writeFile(join(changeRoot, 'tasks.md'), files.tasks, 'utf8');
  }
  if (files.design !== undefined) {
    await writeFile(join(changeRoot, 'design.md'), files.design, 'utf8');
  }
  if (files.specs !== undefined) {
    await mkdir(join(changeRoot, 'specs'), { recursive: true });
    for (const [capability, body] of Object.entries(files.specs)) {
      const capDir = join(changeRoot, 'specs', capability);
      await mkdir(capDir, { recursive: true });
      await writeFile(join(capDir, 'spec.md'), body, 'utf8');
    }
  }
}

const SAMPLE_PROPOSAL = `# Change: sample
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
- risk-two

## Acceptance Criteria

- accept-one
- accept-two
`;

const SAMPLE_TASKS = `# Tasks

> Some preamble

## 1. First

- [ ] Open task
- [x] Done task
- not a checkbox

## 2. Second

- [ ] Another open
- [ ] Yet another
- [x] Done
`;

describe('scanOpenSpec', () => {
  test('returns exists=false when openspec root is missing', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'peaks-openspec-missing-'));
    const report = await scanOpenSpec({ openspecRoot: join(tmp, 'openspec') });

    expect(report.exists).toBe(false);
    expect(report.changes).toEqual([]);
  });

  test('returns empty changes when changes directory does not exist', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'peaks-openspec-empty-'));
    await mkdir(join(tmp, 'openspec'), { recursive: true });

    const report = await scanOpenSpec({ openspecRoot: join(tmp, 'openspec') });

    expect(report.exists).toBe(true);
    expect(report.changes).toEqual([]);
  });

  test('lists changes with proposal/tasks/design/specs detection and task progress', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'add-foo', {
      proposal: SAMPLE_PROPOSAL,
      tasks: SAMPLE_TASKS,
      design: '# Design',
      specs: { 'peaks-foo': '# Spec', 'peaks-bar': '# Spec' }
    });
    await writeChange(root, 'tasks-only', { tasks: SAMPLE_TASKS });

    const report = await scanOpenSpec({ openspecRoot: root });

    expect(report.changes.map((change) => change.id).sort()).toEqual(['add-foo', 'tasks-only']);
    const addFoo = report.changes.find((change) => change.id === 'add-foo');
    expect(addFoo).toBeDefined();
    expect(addFoo?.paths.proposal).toContain('proposal.md');
    expect(addFoo?.paths.tasks).toContain('tasks.md');
    expect(addFoo?.paths.design).toContain('design.md');
    expect(addFoo?.specs.sort()).toEqual(['peaks-bar', 'peaks-foo']);
    expect(addFoo?.taskProgress).toEqual({
      totalTodo: 5,
      doneTodo: 2,
      sections: [
        { heading: '1. First', total: 2, done: 1 },
        { heading: '2. Second', total: 3, done: 1 }
      ]
    });

    const tasksOnly = report.changes.find((change) => change.id === 'tasks-only');
    expect(tasksOnly?.paths.proposal).toBeNull();
    expect(tasksOnly?.paths.design).toBeNull();
    expect(tasksOnly?.specs).toEqual([]);
  });

  test('records null task progress when tasks.md is absent', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'no-tasks', { proposal: SAMPLE_PROPOSAL });

    const report = await scanOpenSpec({ openspecRoot: root });

    expect(report.changes[0]?.taskProgress).toBeNull();
  });

  test('parses real project openspec changes directory without throwing', async () => {
    const projectRoot = process.cwd();
    const report = await scanOpenSpec({ openspecRoot: join(projectRoot, 'openspec') });

    expect(report.exists).toBe(true);
    expect(report.changes.length).toBeGreaterThanOrEqual(4);
    for (const change of report.changes) {
      expect(typeof change.id).toBe('string');
      expect(change.id.length).toBeGreaterThan(0);
    }
  });

  test('defaults openspec root to <cwd>/openspec when no option is provided', async () => {
    const report = await scanOpenSpec();

    expect(report.openspecRoot).toBe(join(process.cwd(), 'openspec'));
    expect(report.exists).toBe(true);
  });
});

describe('loadOpenSpecChange', () => {
  test('returns null when change directory does not exist', async () => {
    const root = await makeOpenSpecRoot();
    const detail = await loadOpenSpecChange('does-not-exist', { openspecRoot: root });

    expect(detail).toBeNull();
  });

  test('defaults openspec root to <cwd>/openspec when no option is provided', async () => {
    const detail = await loadOpenSpecChange('add-tech-dry-run-gate');

    expect(detail?.id).toBe('add-tech-dry-run-gate');
    expect(detail?.proposal?.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  test('returns parsed proposal sections and bullets', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'detail', { proposal: SAMPLE_PROPOSAL });

    const detail = await loadOpenSpecChange('detail', { openspecRoot: root });

    expect(detail).not.toBeNull();
    expect(detail?.proposal).toEqual({
      why: 'Sample reason text.',
      whatChanges: ['Add foo', 'Add bar'],
      outOfScope: ['Not this'],
      dependencies: ['dep-one'],
      risks: ['risk-one', 'risk-two'],
      acceptanceCriteria: ['accept-one', 'accept-two']
    });
  });

  test('returns null proposal field when proposal.md is missing', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'no-proposal', { tasks: SAMPLE_TASKS });

    const detail = await loadOpenSpecChange('no-proposal', { openspecRoot: root });

    expect(detail?.proposal).toBeNull();
  });

  test('treats missing sections as empty bullets and empty why', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'sparse', { proposal: '# Sparse change\n\nNo sections here.\n' });

    const detail = await loadOpenSpecChange('sparse', { openspecRoot: root });

    expect(detail?.proposal).toEqual({
      why: '',
      whatChanges: [],
      outOfScope: [],
      dependencies: [],
      risks: [],
      acceptanceCriteria: []
    });
  });

  test('ignores tasks.md headings without numeric prefix when counting sections', async () => {
    const root = await makeOpenSpecRoot();
    await writeChange(root, 'weird-tasks', {
      tasks: `# Tasks\n\n## Preamble heading\n\n- [ ] should still count globally\n\n## 1. Counted\n\n- [x] done\n`
    });

    const detail = await loadOpenSpecChange('weird-tasks', { openspecRoot: root });

    expect(detail?.taskProgress?.totalTodo).toBe(2);
    expect(detail?.taskProgress?.doneTodo).toBe(1);
    expect(detail?.taskProgress?.sections.map((section) => section.heading)).toEqual(['Preamble heading', '1. Counted']);
  });
});
