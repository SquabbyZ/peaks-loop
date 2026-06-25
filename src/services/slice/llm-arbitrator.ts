/**
 * LLMArbitrator — the focused LLM 兜底 (fallback) path used by
 * `CrossPassEdgeMerger` (W2 T7) when structural heuristics cannot
 * decide whether a cross-pass edge is real.
 *
 * Contract:
 *   - `arbitrate(prompt, opts)` is the only public entry point.
 *   - Cache key is `sha256(prompt)`; cache file is `<cacheDir>/<hash>.json`.
 *   - Cache hit short-circuits: llmRunner.call is NOT invoked.
 *   - A module-level counter (`callsThisInvocation`) caps live LLM calls
 *     per orchestrator invocation. When exhausted, the result is
 *     `{ output: null, callId: 'budget-exhausted', tokens: null }`.
 *   - Live calls are raced against `perCallTimeoutMs`; on timeout, return
 *     `{ output: null, callId: 'timeout', tokens: null }`.
 *   - On any other error, return `{ output: null, callId: 'error', tokens: null }`.
 *   - `resetArbitratorBudget()` zeros the module counter so the orchestrator
 *     can re-arm it for the next invocation.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LlmRunner } from '../audit/audit-goal-service.js';

export interface ArbitratorOptions {
  readonly cacheDir: string;
  readonly maxCallsPerInvocation: number;
  readonly perCallTimeoutMs: number;
  readonly llmRunner: LlmRunner;
}

export interface ArbitrateResult {
  readonly output: string | null;
  readonly callId: string;
  readonly tokens: { input: number; output: number } | null;
}

const SYSTEM_PROMPT = 'You are a focused technical arbitrator.';

let callsThisInvocation = 0;

export function resetArbitratorBudget(): void {
  callsThisInvocation = 0;
}

export async function arbitrate(
  prompt: string,
  opts: ArbitratorOptions
): Promise<ArbitrateResult> {
  const promptHash = createHash('sha256').update(prompt).digest('hex');
  const cacheFile = join(opts.cacheDir, `${promptHash}.json`);

  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { output: string };
    return {
      output: cached.output,
      callId: `cache:${promptHash.slice(0, 12)}`,
      tokens: null
    };
  }

  if (callsThisInvocation >= opts.maxCallsPerInvocation) {
    return { output: null, callId: 'budget-exhausted', tokens: null };
  }

  try {
    const result = await Promise.race([
      opts.llmRunner.call(SYSTEM_PROMPT, prompt, { maxTokens: 1000 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), opts.perCallTimeoutMs)
      )
    ]);
    callsThisInvocation++;
    mkdirSync(opts.cacheDir, { recursive: true });
    writeFileSync(
      cacheFile,
      JSON.stringify({ output: result.output, cachedAt: new Date().toISOString() })
    );
    return {
      output: result.output,
      callId: `live:${promptHash.slice(0, 12)}`,
      tokens: result.tokens
    };
  } catch (err) {
    const message = (err as Error).message;
    return {
      output: null,
      callId: message === 'timeout' ? 'timeout' : 'error',
      tokens: null
    };
  }
}
