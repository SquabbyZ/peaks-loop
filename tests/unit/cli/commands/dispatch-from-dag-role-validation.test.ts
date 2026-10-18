// tests/unit/cli/commands/dispatch-from-dag-role-validation.test.ts
//
// Backlog §2.1: the `--from-dag` branch returned before `preflightDispatch`,
// so the only check on the DAG path was `supportsRole` (`role.length > 0`).
// Measured before the fix, with a valid DAG on disk: `'a b'`, `'a\tb'`, a
// 257-char role and `'a\u0000b'` all produced an ok envelope and exit 0,
// while the warm path refused each with INVALID_ROLE. The empty role was
// refused by accident, as IDE_NOT_SUPPORTED, not for the reason the warm
// path gives.
//
// The DAG path now calls the SAME `validateRole` the warm path uses, before
// the DAG file is opened. RED-direction arms: each invalid value must yield
// INVALID_ROLE and emit no tool call. Controls: a valid role still runs the
// DAG, and the role check does not mask a genuinely broken DAG for one.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeCapturedIo } from '../../_setup/io.js';
import { parseCliEnvelope } from '~/src/cli/cli-envelope';
import { runDispatchFromDag } from '~/src/cli/commands/dispatch-from-dag';
import type { DispatchOptions } from '~/src/cli/commands/sub-agent-shared';

const SESSION_ID = '2026-10-18-session-dedff6';
const RID = 'rid-from-dag-role-validation';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'from-dag-role-'));
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

function writeDag(name = 'dag.json'): string {
  const file = join(project, name);
  writeFileSync(file, JSON.stringify({ nodes: [{ id: 'A', role: 'rd' }], edges: [] }), 'utf8');
  return file;
}

async function runFromDag(role: string, fromDag: string) {
  const { io, captured } = makeCapturedIo();
  const options: DispatchOptions = {
    fromDag,
    project,
    sessionId: SESSION_ID,
    requestId: RID
  };
  await runDispatchFromDag(role, options, true, io);
  const stdout = captured.text();
  return { envelope: parseCliEnvelope(stdout), stdout };
}

describe('sub-agent dispatch --from-dag role validation', () => {
  it('when the role is empty, should refuse with INVALID_ROLE and dispatch nothing', async () => {
    // given: a valid DAG — the refusal must come from the role, not the DAG
    const dag = writeDag();

    // when: the DAG path runs with an empty role
    const { envelope, stdout } = await runFromDag('', dag);

    // then: the warm path's code, and no tool call was emitted
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INVALID_ROLE');
    expect(process.exitCode).toBe(1);
    expect(envelope.data.toolCalls).toBeUndefined();
    expect(stdout).not.toContain('orchestratorVisibleHint');
  });

  it('when the role contains a space, should refuse with INVALID_ROLE and dispatch nothing', async () => {
    // given: a valid DAG on disk
    const dag = writeDag();

    // when: the role carries whitespace, which the warm path already refuses
    const { envelope } = await runFromDag('a b', dag);

    // then: refused, and the refusal names the role rule
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INVALID_ROLE');
    expect(String(envelope.message)).toContain('whitespace');
    expect(envelope.data.toolCalls).toBeUndefined();
  });

  it('when the role contains a tab, should refuse with INVALID_ROLE and dispatch nothing', async () => {
    // given: a valid DAG on disk
    const dag = writeDag();

    // when: the role carries a control character the warm path refuses
    const { envelope } = await runFromDag('a\tb', dag);

    // then: refused before any level is planned
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INVALID_ROLE');
    expect(process.exitCode).toBe(1);
    expect(envelope.data.toolCalls).toBeUndefined();
  });

  it('when the role exceeds 256 chars, should refuse with INVALID_ROLE and dispatch nothing', async () => {
    // given: a valid DAG on disk
    const dag = writeDag();

    // when: the role is one character past the warm path's ceiling
    const { envelope } = await runFromDag('a'.repeat(257), dag);

    // then: refused, with the length rule in the message
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INVALID_ROLE');
    expect(String(envelope.message)).toContain('256');
    expect(envelope.data.toolCalls).toBeUndefined();
  });

  it('when the role contains a NUL byte, should refuse with INVALID_ROLE and dispatch nothing', async () => {
    // given: a valid DAG on disk
    const dag = writeDag();

    // when: the role carries a NUL, which no shell would show
    const { envelope } = await runFromDag('a\u0000b', dag);

    // then: refused before the DAG file is even read
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INVALID_ROLE');
    expect(envelope.data.toolCalls).toBeUndefined();
  });

  it('when the role is invalid AND the DAG path is missing, should refuse the role first', async () => {
    // given: no DAG file exists at the named path
    const missing = join(project, 'no-such-dag.json');

    // when: the DAG path runs with an invalid role
    const { envelope } = await runFromDag('a b', missing);

    // then: INVALID_ROLE, not INVALID_DAG — no DAG work started
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INVALID_ROLE');
  });

  it('when the role is valid, should still run the DAG and emit its tool calls', async () => {
    // given: a valid role and a one-node DAG
    const dag = writeDag();

    // when: the DAG path runs
    const { envelope } = await runFromDag('rd', dag);

    // then: the existing DAG success envelope is unchanged
    expect(envelope.ok).toBe(true);
    expect(envelope.data.dispatchCount).toBe(1);
    expect(envelope.data.toolCalls).toHaveLength(1);
  });

  it('when the role is valid but the DAG path is missing, should still report INVALID_DAG', async () => {
    // given: a valid role and a DAG path that does not resolve
    const missing = join(project, 'no-such-dag.json');

    // when: the DAG path runs
    const { envelope } = await runFromDag('rd', missing);

    // then: the role check does not mask a broken DAG for a valid role
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INVALID_DAG');
  });
});
