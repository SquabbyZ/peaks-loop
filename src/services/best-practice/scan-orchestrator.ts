/**
 * Slice 2026-08-12 best-practice-scan — scan orchestrator.
 *
 * Resolves a doc-fragment set for a (intent, language) query via the
 * following priority chain:
 *   1. Context7 MCP  (priority 1; 30 s timeout)
 *   2. WebSearch    (priority 2 fallback; 200 ms simulated delay)
 *   3. Empty        (both sources exhausted)
 *
 * The Context7 + WebSearch calls are STUB implementations for v1:
 * they sleep for a fixed delay and return synthetic doc fragments so
 * the orchestrator's source-priority logic is testable end-to-end.
 * Real MCP wiring is a future slice — the stubs are clearly marked.
 *
 * Because a stub result is indistinguishable from a real one by shape,
 * every result carries `synthetic`: true when the fragments came from a
 * built-in stub rather than a caller-injected lookup (`context7Lookup` /
 * `webSearchLookup`). Callers MUST NOT present a synthetic result as a
 * scan result — `source` alone says which transport answered, not whether
 * anything real was consulted. The stub seam stays injectable so the real
 * wiring (and its tests) can replace it without touching this contract.
 *
 * The orchestrator emits structured log lines via the injected `io`
 * (stdout for progress, stderr for warnings) so a CLI caller can see
 * which fallback path was taken.
 */
import type { ProgramIO } from '../../cli/cli-helpers.js';

export type DocFragment = {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
};

export type ScanSource = 'context7' | 'websearch' | 'fallback';

export type ScanResult = {
  readonly results: readonly DocFragment[];
  readonly fragments: readonly DocFragment[];
  readonly source: ScanSource;
  readonly elapsedMs: number;
  /**
   * `true` when the fragments came from the built-in stub lookups instead
   * of a real documentation lookup. A synthetic result is not a scan
   * result: it must never be rendered as one or gated on.
   */
  readonly synthetic: boolean;
};

export type ScanOptions = {
  readonly intent: string;
  readonly language: string;
  readonly projectRoot: string;
  readonly io: ProgramIO;
  readonly context7TimeoutMs?: number;
  /** Test / real-wiring seam: replaces the priority-1 Context7 stub. */
  readonly context7Lookup?: LookupFn;
  /** Test / real-wiring seam: replaces the priority-2 WebSearch stub. */
  readonly webSearchLookup?: LookupFn;
};

const DEFAULT_CONTEXT7_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT7_DELAY_MS = 100;
const DEFAULT_WEBSEARCH_DELAY_MS = 200;

export type LookupFn = (intent: string, language: string) => Promise<{
  readonly ok: boolean;
  readonly results: readonly DocFragment[];
}>;

const defaultContext7Lookup: LookupFn = async (intent, language) => {
  // TODO: real MCP integration — call `@upstash/context7-mcp`'s
  // resolve-library-id + query-docs and translate errors into the
  // shared `{ ok, results }` envelope.
  await new Promise<void>((resolveFn) => setTimeout(resolveFn, DEFAULT_CONTEXT7_DELAY_MS));
  return {
    ok: true,
    results: [
      {
        title: `Context7 ${language} doc for "${intent}"`,
        url: `https://context7.com/${language}/${encodeURIComponent(intent)}`,
        snippet: `best practice for ${intent} in ${language} (context7 stub)`
      }
    ]
  };
};

const defaultWebSearchLookup: LookupFn = async (intent, language) => {
  // TODO: real web search wiring — use Context7 WebSearch tool or
  // WebFetch + ranking; current stub returns a synthetic fragment.
  await new Promise<void>((resolveFn) => setTimeout(resolveFn, DEFAULT_WEBSEARCH_DELAY_MS));
  return {
    ok: true,
    results: [
      {
        title: `WebSearch ${language} case for "${intent}"`,
        url: `https://example.com/search?q=${encodeURIComponent(intent)}&lang=${language}`,
        snippet: `implementation example for ${intent} in ${language} (websearch stub)`
      }
    ]
  };
};

export async function scanBestPractice(opts: ScanOptions): Promise<ScanResult> {
  const timeoutMs = opts.context7TimeoutMs ?? DEFAULT_CONTEXT7_TIMEOUT_MS;
  const startedAt = Date.now();
  const context7Lookup = opts.context7Lookup ?? defaultContext7Lookup;
  const webSearchLookup = opts.webSearchLookup ?? defaultWebSearchLookup;
  // A branch is synthetic when the lookup that answered it is a stub. The
  // fallback branch counts as synthetic if ANY stub took part in the chain.
  const context7Stub = opts.context7Lookup === undefined;
  const webSearchStub = opts.webSearchLookup === undefined;

  opts.io.stdout(`[scan-orchestrator] querying context7 for "${opts.intent}" (${opts.language})`);
  let context7Outcome: { ok: boolean; results: readonly DocFragment[] } | null = null;
  let context7Error: string | null = null;
  try {
    const ctxPromise = context7Lookup(opts.intent, opts.language);
    const ctxTimer = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`context7 timeout after ${timeoutMs}ms`)), timeoutMs).unref();
    });
    context7Outcome = await Promise.race([ctxPromise, ctxTimer]);
  } catch (err) {
    context7Error = err instanceof Error ? err.message : String(err);
    opts.io.stderr(`[scan-orchestrator] context7 failed: ${context7Error}`);
  }

  if (context7Outcome !== null && context7Outcome.ok && context7Outcome.results.length > 0) {
    return {
      results: context7Outcome.results,
      fragments: context7Outcome.results,
      source: 'context7',
      elapsedMs: Date.now() - startedAt,
      synthetic: context7Stub
    };
  }

  opts.io.stdout(`[scan-orchestrator] falling back to websearch for "${opts.intent}" (${opts.language})`);
  let webOutcome: { ok: boolean; results: readonly DocFragment[] } | null = null;
  let webError: string | null = null;
  try {
    webOutcome = await webSearchLookup(opts.intent, opts.language);
  } catch (err) {
    webError = err instanceof Error ? err.message : String(err);
    opts.io.stderr(`[scan-orchestrator] websearch failed: ${webError}`);
  }

  if (webOutcome !== null && webOutcome.ok && webOutcome.results.length > 0) {
    return {
      results: webOutcome.results,
      fragments: webOutcome.results,
      source: 'websearch',
      elapsedMs: Date.now() - startedAt,
      synthetic: webSearchStub
    };
  }

  opts.io.stderr('[scan-orchestrator] both sources empty; returning empty fallback');
  return {
    results: [],
    fragments: [],
    source: 'fallback',
    elapsedMs: Date.now() - startedAt,
    synthetic: context7Stub || webSearchStub
  };
}