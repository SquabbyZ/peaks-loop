// tests/unit/benchmarks/phase-a-baseline-runner.test.ts
//
// THE REGRESSION TEST OF THIS SLICE: running the Phase A baseline runner must not
// touch `.peaks/memory/`.
//
// WHY IT MATTERS. The runner used to write `.peaks/memory/2026-08-10-phase-A-baseline.md`
// — a path that is neither tracked nor gitignored, inside the directory holding this
// repository's tracked knowledge entries (which `peaks memory reindex` turns into the
// memory index), and reserved by the plan of record for a HUMAN's real measurement
// ("Update this file before `pnpm changeset version`"). Every run overwrote it with a
// `_TBD_` stub. So the runner now writes nothing there, and a `--out` path inside the
// memory library is refused rather than obeyed.
//
// TWO ARMS, BOTH HONEST. The temp-workspace arm compares the WHOLE memory directory
// before and after (nothing created, nothing modified, nothing deleted) with no risk
// of a concurrent writer. The repository arm runs the runner against the real
// `.peaks/memory/` and checks the two facts a run there could break: the plan's
// baseline file must not exist, and a tracked memory entry must be byte-identical.
//
// Dimensions covered: integration (the runner as a real process against a real file
// system), a11y (the exit codes and the refusal message a human reads).
// Dimensions omitted: render — the shape of the JSON result is pinned in
// `phase-a-baseline-gate.test.ts` and `bench-scripts.test.ts`; behavior — the state
// model is pinned in `phase-a-baseline-gate.test.ts`.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  EXIT_NOT_MEASURED,
  EXIT_RUNNER_ERROR
} from '../../../benchmarks/runtime-detached/baseline.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const RUNNER = resolve(REPO_ROOT, 'benchmarks', 'runtime-detached', 'baseline.ts');
const TSX_CLI = resolve(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
/** The file the plan of record reserves for a human's real measurement. */
const PLAN_BASELINE_FILE = '2026-08-10-phase-A-baseline.md';

declareDimensions(
  'tests/unit/benchmarks/phase-a-baseline-runner.test.ts',
  ['integration', 'a11y'],
  [
    { dim: 'render', reason: 'the JSON shape is pinned by the sibling files in this directory' },
    { dim: 'behavior', reason: 'the state model is pinned by phase-a-baseline-gate.test.ts' }
  ]
);

const temporaryWorkspaces: string[] = [];

afterEach(() => {
  while (temporaryWorkspaces.length > 0) {
    const workspace = temporaryWorkspaces.pop();
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  }
});

function makeWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), 'peaks-bench-'));
  temporaryWorkspaces.push(workspace);
  return workspace;
}

/** Every file under `dir`, keyed by its relative path, valued by its content hash. */
function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const key = relative(dir, full).split(sep).join('/');
      files.set(key, createHash('sha256').update(readFileSync(full)).digest('hex'));
    }
  };
  walk(dir);
  return files;
}

/** Run the baseline runner as a real process in `cwd`. */
function runRunner(
  cwd: string,
  args: string[] = []
): { status: number | null; stdout: string; stderr: string } {
  const spawned = spawnSync(process.execPath, [TSX_CLI, RUNNER, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (spawned.error !== undefined) throw spawned.error;
  return { status: spawned.status, stdout: spawned.stdout, stderr: spawned.stderr };
}

describe('Phase A baseline runner — integration', () => {
  it(
    'when the runner starts in a workspace with a memory library, should leave every memory file byte-identical',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a workspace whose memory library holds one entry
      // when: the runner starts there
      // then: nothing under the memory library was created, modified or deleted
      const workspace = makeWorkspace();
      const memoryDir = join(workspace, '.peaks', 'memory');
      mkdirSync(memoryDir, { recursive: true });
      writeFileSync(join(memoryDir, 'keep.md'), '# a memory entry\n');
      const before = snapshot(memoryDir);
      const run = runRunner(workspace);

      expect(run.status).toBe(EXIT_NOT_MEASURED);
      expect(snapshot(memoryDir)).toEqual(before);
      expect(existsSync(join(memoryDir, PLAN_BASELINE_FILE))).toBe(false);
    }
  );

  it(
    'when the runner starts in the repository, should leave the real memory library untouched',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: this repository's real memory library and one tracked entry in it
      // when: the runner starts in the repository root
      // then: the plan's baseline file was not created and the tracked entry is unchanged
      const memoryDir = join(REPO_ROOT, '.peaks', 'memory');
      const entry = join(memoryDir, '2026-08-10-runtime-detached-design.md');
      const before = readFileSync(entry);
      const run = runRunner(REPO_ROOT);

      expect(run.status).toBe(EXIT_NOT_MEASURED);
      expect(existsSync(join(memoryDir, PLAN_BASELINE_FILE))).toBe(false);
      expect(readFileSync(entry).equals(before)).toBe(true);
    }
  );
});

describe('Phase A baseline runner — a11y', () => {
  it(
    'when the runner is asked to write inside the memory library, should refuse and write nothing',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a workspace whose memory library must stay untouched
      // when: the runner is pointed at that directory
      // then: it refuses, names the reason, and writes nothing
      const workspace = makeWorkspace();
      const memoryDir = join(workspace, '.peaks', 'memory');
      mkdirSync(memoryDir, { recursive: true });
      const target = join(memoryDir, 'result.json');
      const run = runRunner(workspace, ['--out', target]);

      expect(run.status).toBe(EXIT_RUNNER_ERROR);
      expect(run.stderr).toContain('memory library');
      expect(existsSync(target)).toBe(false);
    }
  );

  it(
    'when the runner reports the unresolved gate, should print JSON on stdout and a sentence on stderr',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a run of the runner in the repository
      // when: its two output channels are read
      // then: stdout carries the machine-readable result and stderr the plain sentence
      const run = runRunner(REPO_ROOT);

      const parsed = JSON.parse(run.stdout.trim()) as { state: string };
      expect(parsed.state).toBe('not-measured');
      expect(run.stderr).toContain('NOT MEASURED');
    }
  );
});
