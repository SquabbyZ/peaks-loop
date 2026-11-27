// tests/unit/cli/dispatch-review-plan.test.ts
//
// Slice S2.1 — the RD review fan-out plan is published as the dispatch
// envelope's `data.reviewPlan`, derived from the `--request-id` request's
// declared type by the one policy module
// (`src/services/rd/reviewer-dispatch-policy.ts`). These cases drive the real
// `peaks sub-agent dispatch` action and round-trip every request type against
// `reviewerListFor` / `shouldDispatchKarpathy` / `karpathySlotIndex`, so the
// runtime cannot drift from what the prose promises.
//
// The refusal half is pinned too: a missing `--request-id`, an absent request
// artifact, and a record that declares no `- type:` line must all yield
// `reviewPlan: null` plus a warning that names the reason — never a guess.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  VALID_REQUEST_TYPES,
  type RequestType
} from '../../../src/services/artifacts/artifact-prerequisites.js';
import { createRequestArtifact } from '../../../src/services/artifacts/request-artifact-service.js';
import {
  RD_FANOUT_REVIEWERS,
  RD_REVIEW_REQUEST_TYPES,
  karpathySlotIndex,
  reviewerListFor,
  shouldDispatchKarpathy,
  type ReviewPlan
} from '../../../src/services/rd/reviewer-dispatch-policy.js';
import { registerSubAgentCommands } from '../../../src/cli/commands/sub-agent-commands.js';

declareDimensions('tests/unit/cli/dispatch-review-plan.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

interface DispatchEnvelope {
  readonly ok: boolean;
  readonly warnings: readonly string[];
  readonly data: {
    readonly role: string;
    readonly reviewPlan?: ReviewPlan | null;
    readonly toolCall: { readonly args: { readonly prompt: string } };
  };
}

const SESSION_ID = 's2-1-review-plan';

let project: string;
let ridSeq: number;
let exitBefore: typeof process.exitCode;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 's2-1-review-plan-'));
  ridSeq = 0;
  exitBefore = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = exitBefore;
  try {
    rmSync(project, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on the tmp dir; it is reapable either way.
  }
});

async function seedRequest(requestType: RequestType | null): Promise<string> {
  ridSeq += 1;
  const rid = `rid-plan-${ridSeq}`;
  await createRequestArtifact({
    projectRoot: project,
    role: 'rd',
    requestId: rid,
    sessionId: SESSION_ID,
    apply: true,
    ...(requestType === null ? {} : { requestType })
  });
  return rid;
}

async function runDispatch(role: string, requestId: string | null): Promise<DispatchEnvelope> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerSubAgentCommands(program, io);
  const args = [
    'sub-agent',
    'dispatch',
    role,
    '--prompt',
    's2.1 probe — review plan',
    '--session-id',
    SESSION_ID,
    '--project',
    project,
    '--graph-node',
    'n1',
    '--json'
  ];
  if (requestId !== null) {
    args.push('--request-id', requestId);
  }
  await program.parseAsync(args, { from: 'user' });
  return JSON.parse(captured.text()) as DispatchEnvelope;
}

describe('(render) the reviewPlan envelope field', () => {
  it('when the request declares feature, should publish the canonical three-reviewer plan', async () => {
    // given: an rd request whose body declares `- type: feature`
    const rid = await seedRequest('feature');
    // when:  `peaks sub-agent dispatch rd` runs
    const env = await runDispatch('rd', rid);
    // then:  the envelope carries the 3-way fan-out with karpathy in slot 2
    expect(env.data.reviewPlan).toEqual({
      reviewers: [...RD_FANOUT_REVIEWERS],
      karpathy: true,
      karpathySlotIndex: 2
    });
  });

  it('when a non-rd role is dispatched, should omit the key entirely', async () => {
    // given: a feature request and a reviewer role the plan does not govern
    const rid = await seedRequest('feature');
    // when:  a non-rd sub-agent is dispatched
    const env = await runDispatch('code-reviewer', rid);
    // then:  the envelope shape is unchanged, key and warnings alike
    expect('reviewPlan' in env.data).toBe(false);
    expect(env.warnings).toEqual([]);
  });

  it('when the plan is derived, should not leak into the generated prompt', async () => {
    // given: a feature request whose plan is non-null
    const rid = await seedRequest('feature');
    // when:  the dispatch prompt is composed
    const env = await runDispatch('rd', rid);
    // then:  the prompt is untouched — the plan is envelope metadata only
    expect(env.data.reviewPlan).not.toBeNull();
    expect(env.data.toolCall.args.prompt).not.toContain('reviewPlan');
    expect(env.data.toolCall.args.prompt).not.toContain('karpathySlotIndex');
  });
});

describe('(behavior) parity with the one policy module', () => {
  const fanoutTypes = ['feature', 'bugfix', 'refactor'] as const;

  for (const type of fanoutTypes) {
    it(`when the request declares ${type}, should equal reviewerListFor(${type})`, async () => {
      // given: an rd request whose body declares this fanout request type
      const rid = await seedRequest(type);
      // when:  `peaks sub-agent dispatch rd` derives the plan
      const env = await runDispatch('rd', rid);
      // then:  every field round-trips through the policy function
      expect(env.data.reviewPlan).toEqual({
        reviewers: [...reviewerListFor(type)],
        karpathy: shouldDispatchKarpathy(type),
        karpathySlotIndex: karpathySlotIndex(type)
      });
    });
  }

  it('when the request declares a non-fanout type, should return no reviewers and no karpathy slot', async () => {
    // given: config / docs / chore requests, which have no review surface
    // when:  each is dispatched through the rd role
    // then:  the policy's empty list and -1 sentinel become [] and null
    for (const type of ['config', 'docs', 'chore'] as const) {
      const rid = await seedRequest(type);
      const env = await runDispatch('rd', rid);
      expect(env.data.reviewPlan).toEqual({
        reviewers: [...reviewerListFor(type)],
        karpathy: shouldDispatchKarpathy(type),
        karpathySlotIndex: null
      });
      expect(karpathySlotIndex(type)).toBe(-1);
    }
  });

  it('when the policy domain is compared with the project request types, should use one spelling', () => {
    // given: the policy's request-type tuple and the canonical RequestType union
    // when:  both are read as sets
    // then:  they are identical — `feature`, never `feat`, so a real request
    //        cannot be read as "not a fanout type" by a spelling mismatch
    expect([...RD_REVIEW_REQUEST_TYPES].sort()).toEqual([...VALID_REQUEST_TYPES].sort());
  });
});

describe('(integration) the request artifact is the only source', () => {
  it('when --request-id is absent, should refuse to guess and name the reason', async () => {
    // given: a dispatch with no --request-id
    // when:  the review plan is derived
    const env = await runDispatch('rd', null);
    // then:  the plan is null and the warning names the missing input
    expect(env.data.reviewPlan).toBeNull();
    expect(env.warnings.some((w) => w.includes('no request id'))).toBe(true);
  });

  it('when no request artifact exists, should refuse to guess and name the reason', async () => {
    // given: a request id with no artifact on disk
    // when:  the review plan is derived
    const env = await runDispatch('rd', 'rid-plan-absent');
    // then:  the plan is null and the warning names the unknown type
    expect(env.data.reviewPlan).toBeNull();
    expect(env.warnings.some((w) => w.includes('request type unknown'))).toBe(true);
  });

  it('when the artifact records no type line, should treat the type as unknown', async () => {
    // given: a request artifact created without a request type
    const rid = await seedRequest(null);
    // when:  the review plan is derived
    const env = await runDispatch('rd', rid);
    // then:  the reader's `feature` default is NOT used as a guess
    expect(env.data.reviewPlan).toBeNull();
    expect(env.warnings.some((w) => w.includes('request type unknown'))).toBe(true);
  });
});

describe('(a11y) the degraded path stays visible and successful', () => {
  it('when the plan cannot be derived, should still dispatch and name the remedy', async () => {
    // given: a dispatch with no --request-id
    // when:  the action completes
    const env = await runDispatch('rd', null);
    // then:  dispatch succeeds, the warning is actionable, and exit is clean
    expect(env.ok).toBe(true);
    expect(env.warnings).toHaveLength(1);
    expect(env.warnings[0]).toContain('review plan unavailable');
    expect(env.warnings[0]).toContain('--request-id');
    expect(process.exitCode).toBe(0);
  });
});
