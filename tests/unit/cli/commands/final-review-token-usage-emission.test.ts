// tests/unit/cli/commands/final-review-token-usage-emission.test.ts
//
// `rid-dashboard-emit-contract` §3/§6 AC-4, AC-5 and AC-6, as OBSERVED
// BEHAVIOUR.
//
// A real `peaks prepare-final-review --llm-provider anthropic` run through the
// real command, the real service, the real emitter and the real aggregator: the
// only thing replaced is the HTTP TRANSPORT, so the token counts and their
// `source` tag are produced by `createAnthropicRunner` itself rather than by a
// fixture that asserts what the fixture was told.
//
// What is NOT asserted anywhere here: that `emitTokenUsageEvent` exists, that
// the service exports a helper, or that a file contains a string. The subject of
// every case is the count an operator reads and the bytes that reached disk.
//
// Dimensions:
//   - behavior:    the emitted counts and their provenance, provider-reported vs estimated
//   - integration: real runner + service + JSONL store, over a real (faked-transport) reply
//   - render:      the emitted JSONL lines, read back byte for byte
//   - a11y:        the CLI envelope the operator receives for the same run

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import { readMetricLines } from '~/src/services/observability/jsonl-store';
import { aggregateDashboardMetrics } from '~/src/services/observability/aggregation';
import type { ProgramIO } from '~/src/cli/cli-helpers';
import { declareDimensions } from '../../_setup/4dim-template.js';

const RID = 'emit-contract-token';
const DIMENSIONS = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
] as const;

/** The reply text, and the transport handle + requests the mock factory reads. */
const mocks = vi.hoisted(() => ({
  handle: null as null | ((init: { body: string }) => unknown),
  sent: [] as string[],
  answered: [] as string[]
}));

vi.mock('~/src/services/llm/anthropic-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/src/services/llm/anthropic-runner')>();
  return {
    ...actual,
    resolveAnthropicConfig: () => ({
      baseUrl: 'https://llm.invalid',
      authToken: 'test-token',
      authScheme: 'bearer',
      model: 'test-model'
    }),
    // The REAL runner with only its transport replaced: the numbers under test
    // come from production code, not from this file.
    createAnthropicRunner: (config: Parameters<typeof actual.createAnthropicRunner>[0]) =>
      actual.createAnthropicRunner(config, {
        fetchImpl: async (_url, init) => {
          mocks.sent.push(init.body);
          const handle = mocks.handle;
          if (handle === null) throw new Error('no transport handle installed for this case');
          return handle(init) as never;
        }
      })
  };
});

const { registerFinalReviewCommands } = await import('~/src/cli/commands/final-review-commands');

declareDimensions('tests/unit/cli/commands/final-review-token-usage-emission.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  process.exitCode = undefined;
});

beforeEach(() => {
  mocks.handle = null;
  mocks.sent.length = 0;
});

/** A temp project whose audit goal the prepare step can read. */
function fixture(): { projectRoot: string; sid: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-token-emit-'));
  roots.push(projectRoot);
  const sid = 'ac4-session';
  const goalDir = join(projectRoot, '.peaks', '_runtime', sid, 'audit-goal');
  mkdirSync(goalDir, { recursive: true });
  writeFileSync(
    join(goalDir, `${RID}.json`),
    JSON.stringify({ successCriteria: ['The token usage of the review is observable.'] })
  );
  return { projectRoot, sid };
}

/** A well-formed 4-dim reply the service accepts as-is. */
function reviewReply(): string {
  return JSON.stringify({
    rid: RID,
    generatedAt: '2026-10-11T00:00:00.000Z',
    dimensions: DIMENSIONS.map((dimension) => ({
      dimension,
      verdict: 'inconclusive',
      summary: `No evidence source for ${dimension}.`,
      evidence: [],
      confidence: 'low'
    })),
    overallSummary: 'Nothing could be concluded from the available evidence.',
    allPass: false,
    needsAttention: [...DIMENSIONS]
  });
}

type Usage = { input_tokens?: number; output_tokens?: number };

/** Answers the reply, with the provider's own `usage` block when given one. */
function replyWith(text: string, usage?: Usage): () => unknown {
  const payload = {
    content: [{ type: 'text', text }],
    ...(usage === undefined ? {} : { usage })
  };
  return () => {
    mocks.answered.push(JSON.stringify(payload));
    return { ok: true, status: 200, json: async () => payload, text: async () => '' };
  };
}

async function runPrepare(projectRoot: string, sid: string): Promise<Record<string, unknown>> {
  const out: string[] = [];
  const io: ProgramIO = { stdout: (s) => out.push(s), stderr: (s) => out.push(s) };
  const program = new Command();
  registerFinalReviewCommands(program, io);
  await program.parseAsync(
    [
      'prepare-final-review',
      RID,
      '--project',
      projectRoot,
      '--session-id',
      sid,
      '--llm-provider',
      'anthropic',
      '--json'
    ],
    { from: 'user' }
  );
  return JSON.parse(out.join('')) as Record<string, unknown>;
}

type EmittedEvent = { category?: string; detail?: Record<string, unknown> };

function parseLines(projectRoot: string, sid: string): EmittedEvent[] {
  return readMetricLines(projectRoot, sid).map((line) => JSON.parse(line) as EmittedEvent);
}

function tokenEvents(projectRoot: string, sid: string): EmittedEvent[] {
  return parseLines(projectRoot, sid).filter((e) => e.category === 'token-usage');
}

function lastHour(): Date {
  return new Date(Date.now() - 60 * 60 * 1000);
}

describe('token-usage emission — behavior', () => {
  it('when the provider reports usage, should emit counts tagged provider that the dashboard reproduces', async () => {
    // given: a review whose reply carries the provider's own usage numbers
    const { projectRoot, sid } = fixture();
    mocks.handle = replyWith(reviewReply(), { input_tokens: 10, output_tokens: 20 });

    // when: the real command runs to completion
    const envelope = await runPrepare(projectRoot, sid);
    expect(envelope['ok']).toBe(true);

    // then: exactly one event, carrying the provider's numbers and their origin
    const events = tokenEvents(projectRoot, sid);
    expect(events).toHaveLength(1);
    expect(events[0]?.detail).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      source: 'provider'
    });

    // then: the dashboard's tokenCount IS that sum — not merely non-zero
    const metrics = aggregateDashboardMetrics(projectRoot, sid, lastHour());
    expect(metrics.tokenCount).toBeGreaterThan(0);
    expect(metrics.tokenCount).toBe(10 + 20);
  });

  it('when the provider omits usage, should tag the counts estimated and still count them', async () => {
    // given: a reply with no `usage` block at all
    const { projectRoot, sid } = fixture();
    mocks.handle = replyWith(reviewReply());

    // when: the command runs
    await runPrepare(projectRoot, sid);

    // then: the fallback is stated, not silently written as a zero
    const events = tokenEvents(projectRoot, sid);
    expect(events).toHaveLength(1);
    expect(events[0]?.detail?.['source']).toBe('estimated');
    expect(events[0]?.detail?.['totalTokens']).toBeGreaterThan(0);

    // then: an estimated count is still a count
    expect(aggregateDashboardMetrics(projectRoot, sid, lastHour()).tokenCount).toBeGreaterThan(0);
  });
});

describe('token-usage emission — integration', () => {
  it('when the counts are compared outside aggregateDashboardMetrics, should agree with the dashboard', async () => {
    // given: a completed run whose event lines are on disk
    const { projectRoot, sid } = fixture();
    mocks.handle = replyWith(reviewReply(), { input_tokens: 41, output_tokens: 27 });
    await runPrepare(projectRoot, sid);

    // when: the total is computed HERE, from the raw lines, and from the OTHER
    // field pair the aggregator prefers — `inputTokens + outputTokens` rather
    // than `detail.totalTokens`, which is what `aggregation.ts:213-224` reads
    const outside = tokenEvents(projectRoot, sid).reduce((sum, event) => {
      const detail = event.detail ?? {};
      return sum + Number(detail['inputTokens'] ?? 0) + Number(detail['outputTokens'] ?? 0);
    }, 0);
    const dashboard = aggregateDashboardMetrics(projectRoot, sid, lastHour()).tokenCount;

    // then: the two independent computations agree, so the dashboard is not
    // merely agreeing with itself
    expect(outside).toBe(41 + 27);
    expect(dashboard).toBe(outside);
  });
});

describe('token-usage emission — render', () => {
  it('when the event lines are written, should carry no substring of the prompt or the reply', async () => {
    // given: a run whose request body and reply text are both known verbatim
    const { projectRoot, sid } = fixture();
    const reply = reviewReply();
    mocks.handle = replyWith(reply, { input_tokens: 10, output_tokens: 20 });
    await runPrepare(projectRoot, sid);

    const sentBody = mocks.sent[0] ?? '';
    const sentPrompt = (JSON.parse(sentBody) as { messages: { content: string }[] }).messages[0]
      ?.content;
    expect(typeof sentPrompt).toBe('string');

    // The probe's first 40 characters, and the same 40 encoded the way the wire
    // encodes them — a quote inside the prompt arrives as `\"`, so the escaped
    // form is what a substring search has to use.
    const promptText = (sentPrompt ?? '').slice(0, 40);
    expect(promptText.length).toBe(40);
    expect(reply.length).toBeGreaterThan(40);
    const promptProbe = JSON.stringify(promptText).slice(1, -1);
    const replyProbe = JSON.stringify(reply.slice(0, 40)).slice(1, -1);

    // when: the emitted lines are read back byte for byte
    const emitted = readMetricLines(projectRoot, sid).join('\n');

    // then: the haystack really is the events under test — otherwise "not found"
    // would only mean "searched nothing"
    expect(emitted).toContain('"category":"token-usage"');
    // then: the CONTROL — both probes WERE on the wire, so the two assertions
    // below are measurements rather than probes that cannot match anything
    expect(sentBody).toContain(promptProbe);
    expect(mocks.answered[0] ?? '').toContain(replyProbe);
    // then: neither probe reached disk
    expect(emitted).not.toContain(promptProbe);
    expect(emitted).not.toContain(replyProbe);
  });

  it('when a review completes, should write numbers only into the event detail', async () => {
    // given: a completed run
    const { projectRoot, sid } = fixture();
    mocks.handle = replyWith(reviewReply(), { input_tokens: 8, output_tokens: 9 });
    await runPrepare(projectRoot, sid);

    // when: the one token-usage detail is inspected field by field
    const detail = tokenEvents(projectRoot, sid)[0]?.detail ?? {};

    // then: it holds the four declared keys and nothing payload-shaped
    expect(Object.keys(detail).sort()).toEqual([
      'inputTokens',
      'outputTokens',
      'source',
      'totalTokens'
    ]);
    expect(Object.values(detail).every((v) => typeof v === 'number' || v === 'provider')).toBe(
      true
    );
  });
});

describe('token-usage emission — a11y', () => {
  it('when the review completes, should still answer the operator with a completed review envelope', async () => {
    // given: a run with the transport answering a valid review
    const { projectRoot, sid } = fixture();
    mocks.handle = replyWith(reviewReply(), { input_tokens: 10, output_tokens: 20 });

    // when: the command runs
    const envelope = await runPrepare(projectRoot, sid);

    // then: the emission did not disturb the surface the operator reads
    expect(envelope['ok']).toBe(true);
    expect((envelope['data'] as { status?: string })?.status).toBe('review-complete');
    expect(process.exitCode).toBeUndefined();
  });
});
