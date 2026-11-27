// tests/unit/cli/commands/dispatch-from-dag-lane-fast.test.ts
//
// The fast lane's static write safety. `--lane fast` on the existing
// `--from-dag` must refuse a DAG before dispatch when a node declares no
// `files[]` (FAST_LANE_FILES_REQUIRED) or when two nodes share a file
// (FAST_LANE_FILES_OVERLAP, naming the file and both node ids). A clean DAG
// dispatches and stamps `lane: 'fast'` while dropping the artifact-contract
// hint. Without the flag the envelope must be byte-identical to before, which
// is why the default-mode arm uses a node with no files[] at all.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeCapturedIo } from '../../_setup/io.js';
import { parseCliEnvelope } from '~/src/cli/cli-envelope';
import { runDispatchFromDag } from '~/src/cli/commands/dispatch-from-dag';
import type { DispatchOptions } from '~/src/cli/commands/sub-agent-shared';

const SESSION_ID = '2026-10-18-session-dedff6';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'from-dag-fast-'));
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  try {
    rmSync(project, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on the tmp dir; reapable either way.
  }
});

function writeDag(nodes: readonly unknown[], name = 'dag.json'): string {
  const file = join(project, name);
  writeFileSync(file, JSON.stringify({ nodes, edges: [] }), 'utf8');
  return file;
}

async function runFromDag(fromDag: string, extra: Partial<DispatchOptions> = {}) {
  const { io, captured } = makeCapturedIo();
  const options: DispatchOptions = { fromDag, project, sessionId: SESSION_ID, ...extra };
  await runDispatchFromDag('rd', options, true, io);
  return { envelope: parseCliEnvelope(captured.text()) };
}

describe('sub-agent dispatch --from-dag --lane fast — static write safety', () => {
  it('when a node declares no files[], should refuse with FAST_LANE_FILES_REQUIRED', async () => {
    // given: a fast-lane DAG whose second node has no files[]
    // when: the fast lane plans it
    // then: the refusal names node B and nothing is dispatched
    const dag = writeDag([
      { id: 'A', role: 'rd', files: ['src/a.ts'] },
      { id: 'B', role: 'rd' }
    ]);
    const { envelope } = await runFromDag(dag, { lane: 'fast' });
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('FAST_LANE_FILES_REQUIRED');
    expect(String(envelope.message)).toContain('B');
    expect(process.exitCode).toBe(1);
    expect(envelope.data.toolCalls).toBeUndefined();
  });

  it('when two nodes share a file, should refuse with FAST_LANE_FILES_OVERLAP naming the file and both nodes', async () => {
    // given: two nodes that both claim src/shared.ts
    // when: the fast lane plans it
    // then: the refusal names the file and both node ids
    const dag = writeDag([
      { id: 'A', role: 'rd', files: ['src/shared.ts'] },
      { id: 'B', role: 'rd', files: ['src/shared.ts', 'src/b.ts'] }
    ]);
    const { envelope } = await runFromDag(dag, { lane: 'fast' });
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('FAST_LANE_FILES_OVERLAP');
    expect(String(envelope.message)).toContain('src/shared.ts');
    expect(String(envelope.message)).toContain('A');
    expect(String(envelope.message)).toContain('B');
    expect(process.exitCode).toBe(1);
  });

  it('when every node declares disjoint files, should dispatch and stamp lane fast without a request id', async () => {
    // given: two independent nodes with disjoint declared files and no --request-id
    // when: the fast lane runs
    // then: both nodes dispatch, the lane is stamped, and verify-files is the next action
    const dag = writeDag([
      { id: 'A', role: 'rd', files: ['src/a.ts'] },
      { id: 'B', role: 'rd', files: ['src/b.ts'] }
    ]);
    const { envelope } = await runFromDag(dag, { lane: 'fast' });
    expect(envelope.ok).toBe(true);
    expect(envelope.data.lane).toBe('fast');
    expect(envelope.data.dispatchCount).toBe(2);
    expect(envelope.data.toolCalls).toHaveLength(2);
    expect(process.exitCode ?? 0).toBe(0);
    const nextActions = envelope.data.nextActions as readonly string[];
    expect(nextActions.join(' ')).toContain('verify-files');
    expect(nextActions.join(' ')).not.toContain('write the slice contract');
  });

  it('when --lane fast is absent, should keep the pre-existing envelope and contract hint', async () => {
    // given: the kind of file-less DAG the default path has always accepted
    // when: it runs without the lane flag
    // then: no lane field, one dispatch, and the unchanged contract-writing hint
    const dag = writeDag([{ id: 'A', role: 'rd' }]);
    const { envelope } = await runFromDag(dag, { requestId: 'rid-fast-lane-default' });
    expect(envelope.ok).toBe(true);
    expect(envelope.data.lane).toBeUndefined();
    expect(envelope.data.dispatchCount).toBe(1);
    const nextActions = envelope.data.nextActions as readonly string[];
    expect(nextActions[0]).toContain('write the slice contract');
  });

  it('when --lane names an unknown lane, should refuse with INVALID_LANE instead of silently running', async () => {
    // given: a DAG that would otherwise pass the fast-lane check
    // when: the lane is misspelled
    // then: the typo is refused rather than treated as "no fast lane"
    const dag = writeDag([{ id: 'A', role: 'rd', files: ['src/a.ts'] }]);
    const { envelope } = await runFromDag(dag, { lane: 'Fast' });
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INVALID_LANE');
    expect(process.exitCode).toBe(1);
  });
});
