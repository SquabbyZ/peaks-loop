// tests/unit/cli/commands/dispatch-scratch-path-block-paths.test.ts
//
// The scratch path on the two dispatch paths that do NOT pass through the
// prompt composer: `--from-dag` and `--mode detached`.
//
// WHY A FILE OF ITS OWN. The in-process path composes every brief through
// `composeDispatchPrompt`, which pins the absolute scratch directory into the
// prompt. The two paths below return before that composer runs, so a brief
// handed over on either path reached the leaf with no scratch destination at
// all — and a leaf with no destination picks one, and a cwd-relative pick lands
// at the repository root. That is the shape the root sweep now catches; this
// file closes the other end, so the leaf is told the destination before it can
// choose one.
//
// The arms drive the real CLI code paths: the DAG runner that emits the
// per-slice tool call, and the detached branch that hands the brief to the
// vendor CLI.
//
// Dimensions covered:
//   - behavior:    the block is in the brief, and it names an absolute path
//   - integration: the real `--from-dag` and `--mode detached` paths carry it
//   - a11y:        the brief states the rule a reader can act on
//
// Dimensions omitted:
//   - render:      the brief is text, and its shape is judged in a11y.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('peaks-loop-internal-runtime', () => ({
  dispatchDetached: vi.fn(async () => ({
    pid: 1234,
    dispatchRecordPath: '/x/dispatch-r1.json',
    child: { on: vi.fn(), kill: vi.fn() },
    spawnError: null
  })),
  ResourceBudgetGuard: class {
    constructor(_cfg: { maxRssMb: number; maxCpuPct: number }) {}
    sample() {
      return { rssMb: 100, cpuPct: 1 };
    }
    enforce(input: { active: number }, opts: { maxConcurrent: number }) {
      return { throttle: input.active > opts.maxConcurrent };
    }
  }
}));

import { dispatchDetached } from 'peaks-loop-internal-runtime';
import { parseCliEnvelope } from '../../../../src/cli/cli-envelope.js';
import { runDetachedDispatch } from '../../../../src/cli/commands/dispatch-detached-branch.js';
import { runDispatchFromDag } from '../../../../src/cli/commands/dispatch-from-dag.js';
import {
  SCRATCH_PATH_BLOCK_HEADING,
  toShellPath
} from '../../../../src/cli/commands/dispatch-scratch-path-block.js';
import { makeCapturedIo } from '../../_setup/io.js';
import type { DispatchOptions } from '../../../../src/cli/commands/sub-agent-shared.js';

const SESSION_ID = '2026-10-23-session-scratchpaths';

let project: string;
let sessionIdBefore: string | undefined;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'peaks-scratch-paths-'));
  sessionIdBefore = process.env.PEAKS_SESSION_ID;
  process.env.PEAKS_SESSION_ID = SESSION_ID;
});

afterEach(() => {
  if (sessionIdBefore === undefined) delete process.env.PEAKS_SESSION_ID;
  else process.env.PEAKS_SESSION_ID = sessionIdBefore;
  try {
    rmSync(project, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on the temp dir; it is reapable either way.
  }
});

/** The path line the block carries — the absolute directory, verbatim. */
function scratchPathFromBlock(block: string): string {
  const marker = 'Write every temporary file for this task under this ABSOLUTE path:\n';
  const start = block.indexOf(marker);
  expect(start, 'the block must carry the path marker').toBeGreaterThanOrEqual(0);
  const rest = block.slice(start + marker.length);
  const end = rest.indexOf('\n');
  return rest.slice(0, end === -1 ? rest.length : end);
}

describe('Scenario: behavior — the brief names an absolute scratch path', () => {
  it('when a brief carries the block, should name the path under the session runtime dir', () => {
    // given: the path the runtime dir holds for one role
    // when: the block is read out of a brief that carries it
    // then: the path it names is the absolute one
    const expected = toShellPath(join(project, '.peaks', '_runtime', SESSION_ID, 'rd', 'scratch'));
    const brief = [
      'do the work',
      '',
      SCRATCH_PATH_BLOCK_HEADING,
      '',
      'Write every temporary file for this task under this ABSOLUTE path:',
      expected,
      ''
    ].join('\n');
    expect(scratchPathFromBlock(brief)).toBe(expected);
  });
});

describe('Scenario: integration — the two composer-free paths carry the block', () => {
  it('when a DAG dispatch runs, should put the block in the leaf brief', async () => {
    // given: a one-node DAG on disk
    // when: the DAG path runs
    // then: the tool call the leaf receives carries the block, naming the
    //       absolute scratch directory for that role
    const dag = join(project, 'dag.json');
    writeFileSync(dag, JSON.stringify({ nodes: [{ id: 'A', role: 'rd' }], edges: [] }), 'utf8');
    const { io, captured } = makeCapturedIo();
    const options: DispatchOptions = {
      fromDag: dag,
      project,
      sessionId: SESSION_ID,
      requestId: 'rid-scratch-paths-dag'
    };

    await runDispatchFromDag('rd', options, true, io);

    const envelope = parseCliEnvelope(captured.text());
    const toolCalls = envelope.data.toolCalls as { args: { prompt: string } }[];
    expect(toolCalls).toHaveLength(1);
    const prompt = toolCalls[0]?.args.prompt ?? '';
    expect(prompt).toContain(SCRATCH_PATH_BLOCK_HEADING);
    expect(scratchPathFromBlock(prompt)).toBe(
      toShellPath(join(project, '.peaks', '_runtime', SESSION_ID, 'rd', 'scratch'))
    );
  });

  it('when a detached dispatch runs, should put the block in the brief the vendor CLI gets', async () => {
    // given: a detached dispatch against a project
    // when: the detached branch runs
    // then: the brief handed over carries the block, naming the absolute path
    const { io } = makeCapturedIo();
    const options: DispatchOptions = {
      prompt: 'do the work',
      project,
      requestId: 'rid-scratch-paths-detached'
    };

    await runDetachedDispatch(io, 'rd', options, true);

    const call = vi.mocked(dispatchDetached).mock.calls[0];
    const brief = (call?.[0] as { userTask?: string }).userTask ?? '';
    expect(brief).toContain(SCRATCH_PATH_BLOCK_HEADING);
    expect(scratchPathFromBlock(brief)).toBe(
      toShellPath(join(project, '.peaks', '_runtime', SESSION_ID, 'rd', 'scratch'))
    );
  });
});

describe('Scenario: a11y — the brief states the rule a reader can act on', () => {
  it('when the brief carries the block, should forbid the cwd-relative redirect', async () => {
    // given: a one-node DAG on disk
    // when: the DAG path runs
    // then: the brief says what not to do, not only where to write
    const dag = join(project, 'dag.json');
    writeFileSync(dag, JSON.stringify({ nodes: [{ id: 'A', role: 'rd' }], edges: [] }), 'utf8');
    const { io, captured } = makeCapturedIo();
    const options: DispatchOptions = {
      fromDag: dag,
      project,
      sessionId: SESSION_ID,
      requestId: 'rid-scratch-paths-legible'
    };

    await runDispatchFromDag('rd', options, true, io);

    const envelope = parseCliEnvelope(captured.text());
    const toolCalls = envelope.data.toolCalls as { args: { prompt: string } }[];
    const prompt = toolCalls[0]?.args.prompt ?? '';
    expect(prompt).toContain('Never redirect to a path that depends on the working directory');
  });
});
