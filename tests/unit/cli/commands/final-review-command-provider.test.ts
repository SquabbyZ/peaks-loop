// tests/unit/cli/commands/final-review-command-provider.test.ts
//
// S3 defect-remediation: `peaks prepare-final-review --llm-provider anthropic`
// must bind the REAL Messages-API runner and hand it to `prepareFinalReview()`.
//
// Both the provider factory and the service call are observable here (module
// mocks with pass-through spies), so the real CLI action runs end-to-end with
// zero network access. No test in this file performs a network call.
//
// Each case below failed before the S3 change:
//   - 'anthropic' was outside the whitelist, so a real run answered
//     LLM_PROVIDER_NOT_IMPLEMENTED and no runner was ever constructed;
//   - the scaffold envelope reported `providerBinding: 'pending-follow-up-slice'`,
//     a follow-up pointer that this slice closes;
//   - a missing credential could not surface as LLM_CREDENTIAL_MISSING because
//     no credential was ever resolved on this route.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import type { ProgramIO } from '../../../../src/cli/cli-helpers.js';

const RID = '2026-09-12-s3-provider';
const SESSION_ID = '2026-09-12-session-s3';

const DIMENSIONS = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact',
] as const;

/** Every seam this suite needs, hoisted so the `vi.mock` factories can close over it. */
const mocks = vi.hoisted(() => ({
  resolveConfig: vi.fn(),
  createAnthropicRunner: vi.fn(),
  anthropicCall: vi.fn(),
  prepareFinalReview: vi.fn(),
}));

vi.mock('../../../../src/services/llm/anthropic-runner.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/services/llm/anthropic-runner.js')>();
  return {
    ...actual,
    // The real class (`LlmBindingError`) is kept from `actual` so the CLI's
    // `instanceof` check sees one identity; only the two assembly functions
    // are replaced.
    resolveAnthropicConfig: (...args: unknown[]) => mocks.resolveConfig(...args),
    createAnthropicRunner: (config: unknown) => {
      mocks.createAnthropicRunner(config);
      return { call: mocks.anthropicCall };
    },
  };
});

vi.mock('../../../../src/services/final-review/final-review-service.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../../src/services/final-review/final-review-service.js')
    >();
  return {
    ...actual,
    // Pass-through spy: the REAL service still runs, so the assertion is about
    // what the CLI handed it, not about a behaviour this suite invented.
    prepareFinalReview: (rid: string, opts: Parameters<typeof actual.prepareFinalReview>[1]) => {
      mocks.prepareFinalReview(rid, opts);
      return actual.prepareFinalReview(rid, opts);
    },
  };
});

const { registerFinalReviewCommands } = await import(
  '../../../../src/cli/commands/final-review-commands.js'
);
const { LlmBindingError } = await import('../../../../src/services/llm/anthropic-runner.js');

type Capture = { stdout: string; stderr: string };

function makeIo(): { io: ProgramIO; capture: Capture } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: { stdout: (s: string) => stdout.push(s), stderr: (s: string) => stderr.push(s) },
    capture: {
      get stdout() {
        return stdout.join('');
      },
      get stderr() {
        return stderr.join('');
      },
    },
  };
}

/** A well-formed 4-dim reply that `prepareFinalReview()` accepts as-is. */
function reviewReply(): string {
  return JSON.stringify({
    rid: RID,
    generatedAt: '2026-09-12T00:00:00.000Z',
    dimensions: DIMENSIONS.map((dimension) => ({
      dimension,
      verdict: 'inconclusive',
      summary: `No evidence source for ${dimension}.`,
      evidence: [],
      confidence: 'low',
    })),
    overallSummary: 'Nothing could be concluded from the available evidence.',
    allPass: false,
    needsAttention: [...DIMENSIONS],
  });
}

const BOUND_CONFIG = {
  baseUrl: 'https://llm.invalid',
  authToken: 'test-token',
  authScheme: 'bearer',
  model: 'test-model',
};

let projectRoot: string;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-final-review-provider-'));
  const auditGoalDir = join(projectRoot, '.peaks', '_runtime', SESSION_ID, 'audit-goal');
  mkdirSync(auditGoalDir, { recursive: true });
  writeFileSync(
    join(auditGoalDir, `${RID}.json`),
    JSON.stringify({ successCriteria: ['The 4-dim gate produces a real review.'] })
  );
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

beforeEach(() => {
  mocks.resolveConfig.mockReset();
  mocks.createAnthropicRunner.mockReset();
  mocks.anthropicCall.mockReset();
  mocks.prepareFinalReview.mockReset();
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
});

async function runPrepare(io: ProgramIO, extraArgs: readonly string[] = []): Promise<void> {
  const program = new Command();
  registerFinalReviewCommands(program, io);
  await program.parseAsync(
    ['prepare-final-review', RID, '--project', projectRoot, '--session-id', SESSION_ID, '--json', ...extraArgs],
    { from: 'user' }
  );
}

describe('peaks prepare-final-review — provider binding', () => {
  it('when the default provider runs, should return a scaffold labelled stub and never claim a review', async () => {
    // given: no provider flag and no bound LLM (the default must stay offline)
    const { io, capture } = makeIo();

    // when: the gate is invoked
    await runPrepare(io);

    // then: the envelope is a labelled scaffold — not a review, and not routed
    // through the service
    const envelope = JSON.parse(capture.stdout) as {
      ok: boolean;
      data: { status: string; providerBinding: string };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.status).toBe('scaffold-only');
    expect(envelope.data.providerBinding).toBe('stub');
    expect(mocks.prepareFinalReview).not.toHaveBeenCalled();
    expect(mocks.createAnthropicRunner).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('when --llm-provider stub is named explicitly, should return the same scaffold', async () => {
    // given: the stub named explicitly
    const { io, capture } = makeIo();

    // when: the gate is invoked
    await runPrepare(io, ['--llm-provider', 'stub']);

    // then: the offline route is unchanged by the real-provider slice
    const envelope = JSON.parse(capture.stdout) as {
      ok: boolean;
      data: { status: string; providerBinding: string };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.status).toBe('scaffold-only');
    expect(envelope.data.providerBinding).toBe('stub');
    expect(mocks.anthropicCall).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('when --llm-provider anthropic is named, should pass the real runner to the service and report the real review', async () => {
    // given: a resolvable credential and a bound LLM answering four dimensions
    mocks.resolveConfig.mockReturnValue(BOUND_CONFIG);
    mocks.anthropicCall.mockResolvedValue({
      output: reviewReply(),
      tokens: { input: 10, output: 20 },
    });
    const { io, capture } = makeIo();

    // when: the gate runs against the real provider
    await runPrepare(io, ['--llm-provider', 'anthropic']);

    // then: the service received the REAL runner — the same object
    // `createAnthropicRunner()` returned — not a stub and not a scaffold
    expect(mocks.prepareFinalReview).toHaveBeenCalledTimes(1);
    const [serviceRid, serviceOpts] = mocks.prepareFinalReview.mock.calls[0] as [
      string,
      { llmRunner: { call: unknown }; projectRoot: string; sessionId: string },
    ];
    expect(serviceRid).toBe(RID);
    expect(serviceOpts.projectRoot).toBe(projectRoot);
    expect(serviceOpts.sessionId).toBe(SESSION_ID);
    expect(serviceOpts.llmRunner.call).toBe(mocks.anthropicCall);
    // A stub runner would not have produced a parseable 4-dim review at all:
    // the service would have thrown instead of returning dimensions.
    expect(mocks.anthropicCall).toHaveBeenCalledTimes(1);

    // then: the envelope carries the real verdicts and names the real binding
    const envelope = JSON.parse(capture.stdout) as {
      ok: boolean;
      data: {
        status: string;
        providerBinding: string;
        model: string;
        review: { dimensions: unknown[]; allPass: boolean };
      };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.status).toBe('review-complete');
    expect(envelope.data.providerBinding).toBe('anthropic-messages-api');
    expect(envelope.data.model).toBe('test-model');
    expect(envelope.data.review.dimensions).toHaveLength(4);
    expect(envelope.data.review.allPass).toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it('when an unknown provider is named, should fail without falling back to the stub', async () => {
    // given: a provider name outside the whitelist
    const { io, capture } = makeIo();

    // when: the gate is invoked with it
    await runPrepare(io, ['--llm-provider', 'gpt']);

    // then: it refuses loudly and names the providers that DO work, so the
    // caller is never handed a stub result as if their provider had run
    const envelope = JSON.parse(capture.stdout) as { ok: boolean; code: string; message: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('LLM_PROVIDER_NOT_IMPLEMENTED');
    expect(envelope.message).toContain('anthropic');
    expect(envelope.message).toContain('stub');
    expect(mocks.prepareFinalReview).not.toHaveBeenCalled();
    expect(mocks.createAnthropicRunner).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('when the credential is absent, should fail with LLM_CREDENTIAL_MISSING instead of returning an empty review', async () => {
    // given: an environment with no LLM credential
    mocks.resolveConfig.mockImplementation(() => {
      throw new LlmBindingError(
        'LLM_CREDENTIAL_MISSING',
        'No LLM credential in the environment: set ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY).',
        ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']
      );
    });
    const { io, capture } = makeIo();

    // when: the real provider is requested
    await runPrepare(io, ['--llm-provider', 'anthropic']);

    // then: the missing credential is named on a channel `fail()` does not
    // redact, and no review envelope is emitted
    const envelope = JSON.parse(capture.stdout) as {
      ok: boolean;
      code: string;
      data: { status: string; missingEnv?: string[] };
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('LLM_CREDENTIAL_MISSING');
    expect(envelope.data.missingEnv).toEqual(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']);
    expect(envelope.data.status).not.toBe('review-complete');
    expect(capture.stdout).not.toContain('"review-complete"');
    expect(mocks.prepareFinalReview).not.toHaveBeenCalled();
    expect(mocks.anthropicCall).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
