// tests/unit/cli/commands/audit-goal-binding.test.ts
//
// Unit test for how `peaks audit goal` reports a bound LLM's answer.
//
// The transport is REPLACED here (module mock), so this file exercises the
// real CLI action (runner → auditGoal → envelope) with zero network access:
// a partial audit and a transport failure must both reach the caller as a
// failure, never as a success envelope.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import type { ProgramIO } from '../../../../src/cli/cli-helpers.js';

const callMock = vi.fn();

vi.mock('../../../../src/services/llm/anthropic-runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/services/llm/anthropic-runner.js')>();
  return {
    ...actual,
    resolveAnthropicConfig: () => ({
      baseUrl: 'https://llm.invalid',
      authToken: 'test-token',
      authScheme: 'bearer',
      model: 'test-model',
    }),
    createAnthropicRunner: () => ({ call: callMock }),
  };
});

const { registerAuditCommands } = await import('../../../../src/cli/commands/audit-commands.js');
const { LlmRequestError } = await import('../../../../src/services/llm/anthropic-runner.js');

const DIMENSIONS = ['correctness', 'completeness', 'scope', 'risks', 'alternatives', 'constraints'] as const;

function auditReply(dimensions: readonly string[]): string {
  return JSON.stringify({
    summary: 'A need.',
    audit: dimensions.map((dimension) => ({ dimension, finding: `finding for ${dimension}`, severity: 'concern' })),
    proposedGoal: 'A goal.',
    successCriteria: ['criterion'],
    roughEffort: 'small',
    confidence: 'high',
    rationale: 'Because.',
  });
}

type Capture = { stdout: string; stderr: string };

function makeIo(): { io: ProgramIO; capture: Capture } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: { stdout: (s: string) => stdout.push(s), stderr: (s: string) => stderr.push(s) },
    capture: {
      get stdout() { return stdout.join(''); },
      get stderr() { return stderr.join(''); },
    },
  };
}

let projectRoot: string;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-audit-binding-'));
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

beforeEach(() => {
  callMock.mockReset();
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
});

async function runGoal(io: ProgramIO): Promise<void> {
  const program = new Command();
  registerAuditCommands(program, io);
  await program.parseAsync(
    ['audit', 'goal', '--project', projectRoot, '--need', 'ship the gate', '--json'],
    { from: 'user' }
  );
}

describe('peaks audit goal with a bound LLM', () => {
  it('when the LLM reply omits a dimension, should exit non-zero with INCOMPLETE_AUDIT', async () => {
    // given: a bound LLM whose answer covers only five of the six dimensions
    callMock.mockResolvedValue({ output: auditReply(DIMENSIONS.slice(0, 5)), tokens: { input: 1, output: 1 } });
    const { io, capture } = makeIo();

    // when: the gate runs
    await runGoal(io);

    // then: the partial audit propagates as a gate failure, never a success envelope
    const envelope = JSON.parse(capture.stdout) as { ok: boolean; code: string; message: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('INCOMPLETE_AUDIT');
    expect(envelope.message).toContain('constraints');
    expect(process.exitCode).toBe(1);
  });

  it('when the transport fails, should exit non-zero with LLM_REQUEST_FAILED', async () => {
    // given: a bound LLM that cannot be reached
    callMock.mockRejectedValue(new LlmRequestError('LLM request to https://llm.invalid/v1/messages failed: HTTP 503'));
    const { io, capture } = makeIo();

    // when: the gate runs
    await runGoal(io);

    // then: the transport failure is reported instead of an empty audit
    const envelope = JSON.parse(capture.stdout) as { ok: boolean; code: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('LLM_REQUEST_FAILED');
    expect(process.exitCode).toBe(1);
  });

  it('when the reply is a complete audit, should report audit-complete with the real provider binding', async () => {
    // given: a bound LLM answering all six dimensions
    callMock.mockResolvedValue({ output: auditReply(DIMENSIONS), tokens: { input: 1, output: 1 } });
    const { io, capture } = makeIo();

    // when: the gate runs
    await runGoal(io);

    // then: the envelope claims an audit and names the binding that produced it
    const envelope = JSON.parse(capture.stdout) as {
      ok: boolean;
      data: { status: string; providerBinding: string; model: string; result: { audit: unknown[] } };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.status).toBe('audit-complete');
    expect(envelope.data.providerBinding).toBe('anthropic-messages-api');
    expect(envelope.data.model).toBe('test-model');
    expect(envelope.data.result.audit).toHaveLength(6);
    expect(process.exitCode).toBeUndefined();
  });
});
