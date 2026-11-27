// tests/unit/cli/commands/verify-files.test.ts
//
// `peaks sub-agent verify-files` is the fast lane's post-run merge gate. After
// a `--lane fast` run, the declared union is compared with what git says the
// working tree actually changed; any file in `outside[]` is an escape and must
// abort the merge. The pure parser/set-math arms run without a repository; the
// inside/escaped arms drive the registered CLI against a throwaway git repo, so
// the git read and the envelope are measured rather than described.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeCapturedIo } from '../../_setup/io.js';
import { parseCliEnvelope } from '~/src/cli/cli-envelope';
import { registerSubAgentCommands } from '~/src/cli/commands/sub-agent-commands';
import { computeFileEscape, parsePorcelainZ } from '~/src/services/dispatch/fast-lane-verify';

const roots: string[] = [];

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  while (roots.length > 0) {
    try {
      rmSync(roots.pop() as string, { recursive: true, force: true });
    } catch {
      // Windows open-handle race on the tmp dir; reapable either way.
    }
  }
});

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function initRepo(): string {
  const root = makeDir('verify-files-repo-');
  execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore', windowsHide: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  return root;
}

function writeDag(declared: readonly string[]): string {
  const dir = makeDir('verify-files-dag-');
  const file = join(dir, 'dag.json');
  const dag = { nodes: [{ id: 'N', role: 'rd', files: [...declared] }], edges: [] };
  writeFileSync(file, JSON.stringify(dag), 'utf8');
  return file;
}

async function runVerifyFiles(argv: readonly string[]) {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerSubAgentCommands(program, io);
  await program.parseAsync([...argv], { from: 'user' });
  return parseCliEnvelope(captured.text());
}

describe('verify-files — pure porcelain parsing and set math', () => {
  it('when porcelain output contains a rename, should report the new path and skip the source', () => {
    // given: a rename entry followed by an untracked file, NUL-separated
    // when: the -z capture is parsed
    // then: the rename source is not reported as a second change
    const output = 'R  src/new.ts\0src/old.ts\0?? src/untracked.ts\0';
    const paths = parsePorcelainZ(output);
    expect(paths).toEqual(['src/new.ts', 'src/untracked.ts']);
  });

  it('when declared and changed sets are compared, should list only the escaped files', () => {
    // given: a changed set that contains one file missing from the declaration
    // when: the escape is computed
    // then: everything is reported, and only the undeclared file is outside
    const declared = ['src/a.ts', 'src/b.ts'];
    const changed = ['src/b.ts', 'src/c.ts', 'src/a.ts'];
    const report = computeFileEscape(declared, changed);
    expect(report.declared).toEqual(['src/a.ts', 'src/b.ts']);
    expect(report.changed).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(report.outside).toEqual(['src/c.ts']);
  });
});

describe('verify-files — the registered CLI merge gate', () => {
  it('when every changed file is declared, should report ok with an empty outside[]', async () => {
    // given: the DAG declares both files the tree changed
    // when: verify-files reads the working tree
    // then: the run is clean and the main window may commit
    const root = initRepo();
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 2;\n');
    const dag = writeDag(['src/a.ts', 'src/b.ts']);
    const envelope = await runVerifyFiles([
      'sub-agent',
      'verify-files',
      '--dag',
      dag,
      '--project',
      root,
      '--json'
    ]);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.declared).toEqual(['src/a.ts', 'src/b.ts']);
    expect(envelope.data.changed).toEqual(['src/a.ts', 'src/b.ts']);
    expect(envelope.data.outside).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('when a changed file is outside the declared union, should refuse with FAST_LANE_FILES_ESCAPED', async () => {
    // given: the DAG declares only src/a.ts but the tree also changed src/b.ts
    // when: verify-files reads the working tree
    // then: the escape is named and the merge must abort
    const root = initRepo();
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(root, 'src', 'b.ts'), 'export const b = 2;\n');
    const dag = writeDag(['src/a.ts']);
    const envelope = await runVerifyFiles([
      'sub-agent',
      'verify-files',
      '--dag',
      dag,
      '--project',
      root,
      '--json'
    ]);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('FAST_LANE_FILES_ESCAPED');
    expect(envelope.data.outside).toEqual(['src/b.ts']);
    expect(envelope.data.changed).toEqual(['src/a.ts', 'src/b.ts']);
    expect(process.exitCode).toBe(1);
  });
});
