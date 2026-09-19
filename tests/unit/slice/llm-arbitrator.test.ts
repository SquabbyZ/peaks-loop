// tests/unit/slice/llm-arbitrator.test.ts
//
// AC-4 of slice 2026-09-17-4-0-51-cleanup: the cadence of LLM
// arbitrator calls — capped at `opts.maxCallsPerInvocation` and reset
// per orchestrator invocation via `resetArbitratorBudget()` — is the
// load-bearing guard against runaway LLM calls during multi-pass
// decomposition. The CHANGELOG flagged this as "未补测试"; this file
// is the behavior-framed coverage.
//
// Each case pins a real contract from the source's top-of-file
// comment, not line numbers:

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  arbitrate,
  resetArbitratorBudget,
  type ArbitratorOptions,
  type ArbitrateResult
} from '../../../src/services/slice/llm-arbitrator.js';
import type { LlmRunner } from '../../../src/services/audit/audit-goal-service.js';

function makeRunner(
  responses: ReadonlyArray<{ output: string; tokens: { input: number; output: number } }>
): {
  runner: LlmRunner;
  counter: { count: number };
} {
  let i = 0;
  const counter = { count: 0 };
  const runner: LlmRunner = {
    call: vi.fn(async (_system, _prompt, _opts) => {
      counter.count++;
      const next = responses[i] ?? responses[responses.length - 1]!;
      i++;
      return next;
    })
  };
  return { runner, counter };
}

function makeOpts(
  overrides: Partial<ArbitratorOptions> = {}
): ArbitratorOptions & { cacheDir: string } {
  const cacheDir = overrides.cacheDir ?? mkdtempSync(join(tmpdir(), 'peaks-arb-'));
  return {
    cacheDir,
    maxCallsPerInvocation: overrides.maxCallsPerInvocation ?? 3,
    perCallTimeoutMs: overrides.perCallTimeoutMs ?? 1000,
    llmRunner:
      overrides.llmRunner ?? makeRunner([{ output: 'OK', tokens: { input: 1, output: 1 } }]).runner
  };
}

let tempRoots: string[] = [];

beforeEach(() => {
  resetArbitratorBudget();
});

afterEach(() => {
  while (tempRoots.length > 0) {
    const r = tempRoots.pop();
    if (r) rmSync(r, { recursive: true, force: true });
  }
});

describe('LLMArbitrator — AC-4 cadence coverage', () => {
  it('short-circuits when the cache file already exists', async () => {
    // First call populates the cache.
    const { runner, counter: calls } = makeRunner([
      { output: 'cached-output', tokens: { input: 1, output: 1 } }
    ]);
    const opts = makeOpts({
      llmRunner: runner,
      cacheDir: mkdtempSync(join(tmpdir(), 'peaks-arb-'))
    });
    tempRoots.push(opts.cacheDir);

    const first = await arbitrate('prompt-A', opts);
    expect(first.callId).not.toBe('cache:');

    // Second call with the same prompt MUST short-circuit, even on a
    // brand-new runner that has never seen the prompt.
    const freshRunner = makeRunner([]).runner;
    const second = await arbitrate('prompt-A', { ...opts, llmRunner: freshRunner });
    expect(second.output).toBe('cached-output');
    expect(second.callId.startsWith('cache:')).toBe(true);
    // The fresh runner is NOT invoked on a cache hit.
    expect(calls.count).toBe(1);
  });

  it('stops at maxCallsPerInvocation and returns budget-exhausted', async () => {
    const { runner, counter: calls } = makeRunner([
      { output: 'r1', tokens: { input: 1, output: 1 } },
      { output: 'r2', tokens: { input: 1, output: 1 } },
      { output: 'r3', tokens: { input: 1, output: 1 } }
    ]);
    const opts = makeOpts({ llmRunner: runner, maxCallsPerInvocation: 3 });
    tempRoots.push(opts.cacheDir);

    const r1 = await arbitrate('p1', opts);
    const r2 = await arbitrate('p2', opts);
    const r3 = await arbitrate('p3', opts);
    const r4 = await arbitrate('p4', opts);

    expect(r1.output).toBe('r1');
    expect(r2.output).toBe('r2');
    expect(r3.output).toBe('r3');
    expect(r4.output).toBeNull();
    expect(r4.callId).toBe('budget-exhausted');
    // The runner is called exactly N times, not N+1; the budget gate
    // is hit BEFORE invoking the runner.
    expect(calls.count).toBe(3);
  });

  it('resetArbitratorBudget re-arms the module counter for the next invocation', async () => {
    const { runner, counter: calls } = makeRunner([
      { output: 'a', tokens: { input: 1, output: 1 } },
      { output: 'b', tokens: { input: 1, output: 1 } }
    ]);
    const opts = makeOpts({ llmRunner: runner, maxCallsPerInvocation: 1 });
    tempRoots.push(opts.cacheDir);

    const r1 = await arbitrate('q1', opts);
    const r2 = await arbitrate('q2', opts);
    expect(r1.output).toBe('a');
    expect(r2.callId).toBe('budget-exhausted');
    expect(calls.count).toBe(1);

    resetArbitratorBudget();

    const r3 = await arbitrate('q3', opts);
    expect(r3.output).toBe('b');
    expect(calls.count).toBe(2);
  });

  it('returns timeout when the runner exceeds perCallTimeoutMs', async () => {
    const slowRunner: LlmRunner = {
      call: vi.fn(async (_system, _prompt, _opts) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        return { output: 'too-late', tokens: { input: 1, output: 1 } };
      })
    };
    const opts = makeOpts({ llmRunner: slowRunner, perCallTimeoutMs: 10 });
    tempRoots.push(opts.cacheDir);

    const result = await arbitrate('slow-prompt', opts);
    expect(result.output).toBeNull();
    expect(result.callId).toBe('timeout');
  });
});
