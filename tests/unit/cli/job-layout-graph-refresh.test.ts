import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';

declareDimensions(
  'tests/unit/cli/job-layout-graph-refresh.test.ts',
  ['integration', 'a11y'],
  [
    {
      dim: 'behavior',
      reason:
        'the boundary step itself is covered by its own unit file; this file asserts the command wiring and the reader-visible outcome'
    },
    {
      dim: 'render',
      reason: 'the envelope shape is asserted together with the printable warning under a11y'
    }
  ]
);

const JOB_ID = 'layout-hook-job';
const SESSION_ID = '2026-11-27-session-layout-hook';
const RID_LABEL = 'rid-layout-hook';
const COMMIT_SHA = 'deadbeef1234567';

type Captured = ReturnType<typeof makeCapturedIo>['captured'];

function bindSession(wsPath: string): void {
  const runtimeDir = join(wsPath, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    `${JSON.stringify({ sessionId: SESSION_ID, projectRoot: wsPath }, null, 2)}\n`,
    'utf8'
  );
}

async function runJob(args: string[], wsPath: string): Promise<Captured> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerJobCommands(program, io);
  await program.parseAsync(['job', ...args, '--project', wsPath, '--json'], { from: 'user' });
  return captured;
}

async function seedJob(wsPath: string): Promise<void> {
  bindSession(wsPath);
  await runJob(['init', '--job-id', JOB_ID, '--slice-list', RID_LABEL], wsPath);
}

function doneCheckpoint(wsPath: string): Promise<Captured> {
  return runJob(
    [
      'checkpoint',
      '--job-id',
      JOB_ID,
      '--slice-id',
      'slice-001',
      '--state',
      'done',
      '--commit-sha',
      COMMIT_SHA
    ],
    wsPath
  );
}

function envelopeOf(captured: Captured): {
  ok: boolean;
  warnings: string[];
  data: { layoutGraph?: unknown; status?: string };
} {
  return JSON.parse(captured.stdout.join('\n')) as {
    ok: boolean;
    warnings: string[];
    data: { layoutGraph?: unknown; status?: string };
  };
}

describe('Scenario: integration — a slice-boundary checkpoint carries the layout graph step', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-job-layout-hook-');
  });

  afterEach(() => {
    cleanupTmpWorkspace();
  });

  it('when the project has no layout graph, should report no graph and add no warning', async () => {
    // given: a seeded job in a workspace with no layout graph directory
    // when: the slice-complete checkpoint runs
    // then: the step is reported as no graph and the checkpoint succeeds without noise
    await seedJob(ws.path);
    const captured = await doneCheckpoint(ws.path);
    const envelope = envelopeOf(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.status).toBe('done');
    expect(envelope.data.layoutGraph).toMatchObject({
      reason: 'no-graph',
      markedStale: 0,
      pendingCapture: 0
    });
    expect(envelope.warnings).toEqual([]);
  });

  it('when the graph path is unreadable, should warn and still keep the checkpoint green', async () => {
    // given: a seeded job whose graph path is a file and whose token contract exists
    // when: the slice-complete checkpoint runs
    // then: the failure is printed as a warning and the checkpoint itself lands
    await seedJob(ws.path);
    mkdirSync(join(ws.path, '.peaks'), { recursive: true });
    mkdirSync(join(ws.path, 'design'), { recursive: true });
    writeFileSync(join(ws.path, '.peaks', 'layout-graph'), 'not a directory', 'utf8');
    writeFileSync(
      join(ws.path, 'design', 'tokens.json'),
      JSON.stringify({ space: { section: { $value: '16px' } } }),
      'utf8'
    );
    const captured = await doneCheckpoint(ws.path);
    const envelope = envelopeOf(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.status).toBe('done');
    expect(envelope.data.layoutGraph).toMatchObject({
      reason: 'no-index',
      markedStale: null,
      pendingCapture: null
    });
    expect(envelope.warnings).toHaveLength(1);
    expect(envelope.warnings[0]).toContain('layout graph');
  });
});
