// tests/unit/cli/codegraph-config-restore-exit-codes.test.ts
//
// a11y half of the `peaks codegraph config-restore` test split (b1 filesplit
// campaign): the exit codes (0 / 77 / 1) and the loud refusal text. The
// render / behavior / integration scenarios stay in
// codegraph-config-restore.test.ts; the fixtures (real temp git work tree,
// real `repair-exclude` to produce the `.bak`) are shared verbatim from
// codegraph-config-restore-support.ts, and only the upstream binary spawn
// (`executeCodegraphInvocation`) is mocked — same as in the sibling file.
//
// Why the verb exists at all: the repair seams must NOT restore their own
// write, so the `.bak` is written and left, and putting the config BACK is an
// operator decision. A refused restore therefore has to be LOUD, and loud in
// a way a machine can act on: its own exit code, distinct from a broken
// invocation.
//
// Run with:
//   pnpm vitest run tests/unit/cli/codegraph-config-restore-exit-codes.test.ts

import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import {
  backupPathOf,
  CONFIG_RESTORE_EXIT_CODE,
  parseJson,
  repairOnce,
  runCodegraph,
  seedProject
} from './codegraph-config-restore-support.js';

declareDimensions(
  'tests/unit/cli/codegraph-config-restore-exit-codes.test.ts',
  ['a11y'],
  [
    { dim: 'render', reason: 'the envelope scenarios live in codegraph-config-restore.test.ts' },
    {
      dim: 'behavior',
      reason: 'the refusal-shape scenarios live in codegraph-config-restore.test.ts'
    },
    {
      dim: 'integration',
      reason: 'the round-trip scenarios live in codegraph-config-restore.test.ts'
    }
  ]
);

const __m = vi.hoisted(() => ({
  executeCodegraphInvocation: vi.fn()
}));

vi.mock('../../../src/services/codegraph/codegraph-service.js', async () => {
  const actual = await vi.importActual('../../../src/services/codegraph/codegraph-service.js');
  return { ...actual, executeCodegraphInvocation: __m.executeCodegraphInvocation };
});

let ws: TmpWorkspace;
let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-cg-restore-');
  savedExitCode = process.exitCode;
  process.exitCode = 0;
  __m.executeCodegraphInvocation.mockReset();
  __m.executeCodegraphInvocation.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
});

afterEach(() => {
  process.exitCode = savedExitCode;
  cleanupTmpWorkspace();
});

// ── a11y: exit codes and the loud text ──────────────────────────────

describe('a11y — exit codes and the refusal text', () => {
  it(
    'should exit 0 on a restore',
    async () => {
      const project = seedProject(ws);
      await repairOnce(project);

      await runCodegraph(['config-restore', '--project', project, '--peaks-json']);

      expect(process.exitCode).toBe(0);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'should exit with its OWN code, distinct from a broken invocation — measured at runtime',
    async () => {
      const project = seedProject(ws);
      mkdirSync(backupPathOf(project));

      // Both numbers come from REAL runs of this verb, not from comparing two
      // literals: `expect(77).not.toBe(1)` is decided by the compiler and can
      // never fail, so it proved nothing about what the command does. These two
      // runs are the two failure CLASSES the verb has to keep apart.
      process.exitCode = 0;
      await runCodegraph([
        'config-restore',
        '--project',
        join(ws.path, 'does-not-exist'),
        '--peaks-json'
      ]);
      const preconditionExit = process.exitCode;

      process.exitCode = 0;
      await runCodegraph(['config-restore', '--project', project, '--peaks-json']);
      const refusalExit = process.exitCode;

      expect(refusalExit).toBe(CONFIG_RESTORE_EXIT_CODE);
      expect(preconditionExit).toBe(1);
      // The claim the tautology was trying to make: a refused restore is NOT
      // reported with the code a mis-aimed invocation gets, so a CI job can tell
      // "your rollback point is unusable" from "your command was wrong".
      //
      // This is the SECOND assertion for that claim, not the first. Merging the
      // two codes trips the pin above — `expect(preconditionExit).toBe(1)` sees
      // 77 — and vitest stops there, so this line never runs. It adds no power of
      // its own; it is here to STATE the requirement, which the two pinned values
      // imply but never say out loud.
      expect(refusalExit).not.toBe(preconditionExit);
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'on the human path, should name the reason on STDERR (a refusal is not stdout news)',
    async () => {
      const project = seedProject(ws);

      const captured = await runCodegraph(['config-restore', '--project', project]);

      const stderr = captured.stderr.join('\n');
      expect(stderr).toContain('CODEGRAPH_CONFIG_RESTORE_FAILED');
      expect(stderr).toContain('cannot read');
      expect(captured.text()).not.toContain('"restored": true');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it('should carry a reason on the unusable-project path, not an empty data object', async () => {
    const captured = await runCodegraph([
      'config-restore',
      '--project',
      join(ws.path, 'does-not-exist'),
      '--peaks-json'
    ]);

    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('CODEGRAPH_CONFIG_RESTORE_FAILED');
    // The requirement this case owns: EVERY failure path carries all four
    // `data` keys. A consumer reads `restored` and `reason` unconditionally, so
    // a `data: {}` envelope leaves it unable to tell a refused restore from a
    // mis-aimed command without string-matching the message.
    expect(envelope.data.restored).toBe(false);
    expect(envelope.data.from).toBeNull();
    expect(envelope.data.to).toBeNull();
    expect(envelope.data.reason).toBeTruthy();
    expect(envelope.data.reason).toContain('Project path must exist and be a directory');
    // The PRECONDITION class: nothing ever examined a rollback point, so the run
    // must not be reported with the code that means "your backup is unusable".
    // Same ordering as the case above: the pin is FIRST and the exclusion below
    // it is the second assertion for the same requirement — a merged code trips
    // the pin, so the exclusion cannot fail independently. It is kept as the
    // explicit statement of the requirement.
    expect(process.exitCode).toBe(1);
    expect(process.exitCode).not.toBe(CONFIG_RESTORE_EXIT_CODE);
  });

  it('should carry the containment guard`s own reason when `.codegraph` resolves outside the project', async () => {
    // A project root that is a SUBDIRECTORY of the workspace, so `.codegraph`
    // has a real directory outside it to point at. Junction on Windows (no
    // privilege needed), directory symlink on POSIX — the same shapes the repair
    // seam's own containment test uses.
    const project = join(ws.path, 'project');
    const outside = join(ws.path, 'outside', '.codegraph');
    mkdirSync(outside, { recursive: true });
    mkdirSync(project, { recursive: true });
    symlinkSync(
      outside,
      join(project, '.codegraph'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    const captured = await runCodegraph(['config-restore', '--project', project, '--peaks-json']);

    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(false);
    expect(envelope.data.restored).toBe(false);
    expect(envelope.data.reason).toBeTruthy();
    // The GUARD's own words, not a generic "something failed": that is what
    // makes the reason actionable, and it is why the envelope is built from the
    // thrown error rather than from a fixed string.
    expect(envelope.data.reason).toContain('refusing to write through it');
    expect(envelope.data.reason).toContain('which is not inside the project root');
    expect(process.exitCode).toBe(1);
  });
});
