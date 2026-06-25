/**
 * Tests for LLMArbitrator (src/services/slice/llm-arbitrator.ts).
 *
 * Behavior under test:
 *   1. Cache hit  → returns cached output, callId starts with 'cache:', llmRunner.call NOT invoked.
 *   2. Cache miss + success → calls llmRunner.call once, writes cache file, callId starts with 'live:'.
 *   3. Timeout → llmRunner.call never resolves, perCallTimeoutMs short → callId 'timeout', output null.
 *   4. Budget exhausted → after maxCallsPerInvocation live calls, next call returns 'budget-exhausted'.
 *   5. Mutation probe C → cache-hit test must show vi.mocked(llmRunner.call).mock.calls.length === 0.
 *
 * Isolation: each test uses its own cache dir (mkdtempSync) and resetArbitratorBudget() in
 * beforeEach, so the module-level budget counter never leaks across tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  arbitrate,
  resetArbitratorBudget
} from '../../../src/services/slice/llm-arbitrator.js';
import type { LlmRunner } from '../../../src/services/audit/audit-goal-service.js';

function makeTempCacheDir(): string {
  return mkdtempSync(join(tmpdir(), 'llm-arbitrator-test-'));
}

function hashOf(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex');
}

const PROMPT = 'arbitrate this slice edge evidence';
const CACHED_OUTPUT = 'cached-arbitration-output';

describe('LLMArbitrator', () => {
  let cacheDir: string;

  beforeEach(() => {
    resetArbitratorBudget();
    cacheDir = makeTempCacheDir();
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it('returns cached output on cache hit and does not invoke llmRunner.call', async () => {
    // Arrange — pre-populate cache file at the content-hash path.
    const llmRunner: LlmRunner = { call: vi.fn() } as unknown as LlmRunner;
    const promptHash = hashOf(PROMPT);
    const cacheFile = join(cacheDir, `${promptHash}.json`);
    writeFileSync(cacheFile, JSON.stringify({ output: CACHED_OUTPUT, cachedAt: '2026-06-25T00:00:00.000Z' }));

    // Act
    const result = await arbitrate(PROMPT, {
      cacheDir,
      maxCallsPerInvocation: 5,
      perCallTimeoutMs: 1000,
      llmRunner
    });

    // Assert — cached output, cache: callId, no LLM invocation
    expect(result.output).toBe(CACHED_OUTPUT);
    expect(result.callId.startsWith('cache:')).toBe(true);
    expect(result.tokens).toBeNull();
    expect(vi.mocked(llmRunner.call)).not.toHaveBeenCalled();
  });

  it('cache hit does not invoke llmRunner.call (mutation probe C)', async () => {
    // Arrange — same setup as the cache-hit test but with an explicit call-count assertion.
    const llmRunner: LlmRunner = { call: vi.fn() } as unknown as LlmRunner;
    const promptHash = hashOf(PROMPT);
    const cacheFile = join(cacheDir, `${promptHash}.json`);
    writeFileSync(cacheFile, JSON.stringify({ output: CACHED_OUTPUT, cachedAt: '2026-06-25T00:00:00.000Z' }));

    // Act
    await arbitrate(PROMPT, {
      cacheDir,
      maxCallsPerInvocation: 5,
      perCallTimeoutMs: 1000,
      llmRunner
    });

    // Assert — explicit probe on call count (must be exactly zero).
    expect(vi.mocked(llmRunner.call).mock.calls.length).toBe(0);
  });

  it('on cache miss + success, calls llmRunner.call once, writes cache file, returns live: callId', async () => {
    // Arrange — no cache file; llmRunner.call resolves successfully.
    const llmRunnerCall = vi.fn().mockResolvedValue({
      output: 'fresh-arbitration-output',
      tokens: { input: 10, output: 20 }
    });
    const llmRunner: LlmRunner = { call: llmRunnerCall };
    const promptHash = hashOf(PROMPT);
    const cacheFile = join(cacheDir, `${promptHash}.json`);

    // Act
    const result = await arbitrate(PROMPT, {
      cacheDir,
      maxCallsPerInvocation: 5,
      perCallTimeoutMs: 1000,
      llmRunner
    });

    // Assert — live output, live: callId, real tokens, cache file written, LLM called once.
    expect(result.output).toBe('fresh-arbitration-output');
    expect(result.callId.startsWith('live:')).toBe(true);
    expect(result.tokens).toEqual({ input: 10, output: 20 });
    expect(llmRunnerCall).toHaveBeenCalledTimes(1);
    expect(llmRunnerCall).toHaveBeenCalledWith(
      'You are a focused technical arbitrator.',
      PROMPT,
      { maxTokens: 1000 }
    );
    const written = JSON.parse(readFileSync(cacheFile, 'utf8'));
    expect(written.output).toBe('fresh-arbitration-output');
    expect(typeof written.cachedAt).toBe('string');
  });

  it('on timeout, returns { output: null, callId: "timeout", tokens: null } and does not write cache', async () => {
    // Arrange — llmRunner.call never resolves; perCallTimeoutMs is small.
    const llmRunnerCall = vi.fn().mockImplementation(() => new Promise(() => {}));
    const llmRunner: LlmRunner = { call: llmRunnerCall };
    const promptHash = hashOf(PROMPT);
    const cacheFile = join(cacheDir, `${promptHash}.json`);

    // Act
    const result = await arbitrate(PROMPT, {
      cacheDir,
      maxCallsPerInvocation: 5,
      perCallTimeoutMs: 30,
      llmRunner
    });

    // Assert — timeout shape, no cache file written.
    expect(result.output).toBeNull();
    expect(result.callId).toBe('timeout');
    expect(result.tokens).toBeNull();
    expect(() => readFileSync(cacheFile)).toThrow();
  });

  it('after maxCallsPerInvocation live calls, the next call returns budget-exhausted', async () => {
    // Arrange — small budget; first two calls succeed, third must be rejected without LLM call.
    const llmRunnerCall = vi.fn().mockResolvedValue({
      output: 'ok',
      tokens: { input: 1, output: 1 }
    });
    const llmRunner: LlmRunner = { call: llmRunnerCall };
    const opts = {
      cacheDir,
      maxCallsPerInvocation: 2,
      perCallTimeoutMs: 1000,
      llmRunner
    };

    // Act — two successful calls (each uses a distinct prompt → distinct cache key).
    const r1 = await arbitrate('prompt-one', opts);
    const r2 = await arbitrate('prompt-two', opts);
    const callsBeforeExhaustion = vi.mocked(llmRunner.call).mock.calls.length;
    const r3 = await arbitrate('prompt-three', opts);

    // Assert — first two are live; third is budget-exhausted and did NOT call the LLM.
    expect(r1.callId.startsWith('live:')).toBe(true);
    expect(r2.callId.startsWith('live:')).toBe(true);
    expect(r3.output).toBeNull();
    expect(r3.callId).toBe('budget-exhausted');
    expect(r3.tokens).toBeNull();
    expect(vi.mocked(llmRunner.call).mock.calls.length).toBe(callsBeforeExhaustion);
  });
});
