/**
 * G7.7 — headroom-ai integration (RL-22a..RL-22d, AC-44..AC-46).
 *
 * In-process compression wrapper for the `headroom-ai` SDK. Used by
 * `peaks sub-agent dispatch --use-headroom`. Per the user's explicit
 * ask (chat 2026-06-07 1:42), this is the **opt-in** upgrade path
 * for prompts that are too large even after G7 metadata-only.
 *
 * Failure mode (RL-22d / RL-32):
 *   - headroom daemon dead / proxy unreachable / process hangs / times out
 *   - → `HEADROOM_UNAVAILABLE` warning + G7 metadata-only fallback
 *   - → NOT blocking (warn, then continue dispatch)
 *
 * The SDK's `fallback: true` option makes it return the original
 * messages + `result.compressed: false` instead of throwing when the
 * proxy is unavailable. This is the key behavior that makes the
 * failure mode non-blocking. We also catch all SDK errors and treat
 * them as fallback (RL-32).
 *
 * Mode → tokenBudget mapping:
 *   - `balanced`      (default) — tokenBudget ≈ originalSize * 0.40 (target 60% reduction)
 *   - `aggressive`    — tokenBudget = originalSize * 0.20 (target 80% reduction)
 *   - `conservative`  — tokenBudget = originalSize * 0.70 (target 30% reduction)
 *
 * `tokenBudget` is in tokens; we approximate 1 token ≈ 4 bytes for
 * English text. The SDK's `compressed: false` flag indicates fallback
 * kicked in; we surface that as `HEADROOM_UNAVAILABLE` warning.
 *
 * Slice #010 does NOT consume the long-running `headroom proxy` daemon
 * (N-7 deferred). The proxy daemon is platform-specific (Unix socket
 * on Linux/macOS, named pipe on Windows); we run headroom in-process
 * only. R-19 cross-platform behavior is mitigated by this choice.
 *
 * See: `.peaks/memory/sub-agent-headroom-forced-compression-gate.md`
 * for the full G7.7 + G9 contract.
 */
import type { CompressResult, OpenAIMessage } from 'headroom-ai';

export type HeadroomMode = 'balanced' | 'aggressive' | 'conservative';

export interface HeadroomResult {
  readonly compressed: boolean;
  readonly originalSize: number;
  readonly compressedSize: number;
  readonly compressionRatio: number;
  readonly mode: HeadroomMode;
  /** `'HEADROOM_UNAVAILABLE'` on fallback; `null` on success. */
  readonly warning: string | null;
  /** Compressed prompt body. `null` if no compression happened. */
  readonly compressedPrompt: string | null;
  /** Tokens saved (from the SDK). 0 on fallback. */
  readonly tokensSaved: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

// Approximate 1 token = 4 bytes for English text. This is a rough
// heuristic; the SDK does its own tokenization internally.
const BYTES_PER_TOKEN = 4;

/**
 * Compress a prompt via headroom-ai. The `fallback: true` option is
 * non-negotiable: if the proxy daemon is unavailable, the SDK returns
 * `result.compressed = false` and the original messages; we surface
 * that as `HEADROOM_UNAVAILABLE` warning + G7 metadata-only fallback.
 */
export async function compressPrompt(
  prompt: string,
  mode: HeadroomMode = 'balanced'
): Promise<HeadroomResult> {
  const originalSize = Buffer.byteLength(prompt, 'utf8');

  // Dynamic import: the dep is declared in package.json, but if it's
  // not resolvable (e.g. minimal install), we return fallback gracefully.
  type CompressFn = (msgs: OpenAIMessage[], opts?: Record<string, unknown>) => Promise<CompressResult>;
  let compressFn: CompressFn | null = null;
  try {
    const mod: { compress?: CompressFn } = await import('headroom-ai');
    if (typeof mod.compress === 'function') {
      compressFn = mod.compress;
    }
  } catch {
    return fallback(originalSize, mode);
  }
  if (compressFn === null) {
    return fallback(originalSize, mode);
  }

  const messages: OpenAIMessage[] = [
    { role: 'user', content: prompt }
  ];
  const opts: Record<string, unknown> = {
    model: DEFAULT_MODEL,
    timeout: DEFAULT_TIMEOUT_MS,
    fallback: true, // CRITICAL: return original messages if proxy is down
    retries: 1
  };
  if (mode === 'aggressive') {
    opts.tokenBudget = Math.max(1, Math.floor(originalSize * 0.20 / BYTES_PER_TOKEN));
  } else if (mode === 'conservative') {
    opts.tokenBudget = Math.max(1, Math.floor(originalSize * 0.70 / BYTES_PER_TOKEN));
  } else {
    // balanced: target ~60% reduction
    opts.tokenBudget = Math.max(1, Math.floor(originalSize * 0.40 / BYTES_PER_TOKEN));
  }

  let result: CompressResult;
  try {
    result = await compressFn(messages, opts);
  } catch {
    return fallback(originalSize, mode);
  }

  if (result.compressed === false) {
    return {
      compressed: false,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1.0,
      mode,
      warning: 'HEADROOM_UNAVAILABLE',
      compressedPrompt: null,
      tokensSaved: 0
    };
  }

  const compressedContent = extractContent(result.messages);
  if (compressedContent === null) {
    return fallback(originalSize, mode);
  }
  const compressedSize = Buffer.byteLength(compressedContent, 'utf8');
  return {
    compressed: true,
    originalSize,
    compressedSize,
    compressionRatio: compressedSize / originalSize,
    mode,
    warning: null,
    compressedPrompt: compressedContent,
    tokensSaved: result.tokensSaved ?? 0
  };
}

function fallback(originalSize: number, mode: HeadroomMode): HeadroomResult {
  return {
    compressed: false,
    originalSize,
    compressedSize: originalSize,
    compressionRatio: 1.0,
    mode,
    warning: 'HEADROOM_UNAVAILABLE',
    compressedPrompt: null,
    tokensSaved: 0
  };
}

function extractContent(messages: ReadonlyArray<{ role: string; content: unknown }>): string | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  const last = messages[messages.length - 1];
  if (typeof last.content === 'string') {
    return last.content;
  }
  return null;
}

/**
 * Bridge interface: when `--use-headroom` is set, share entries written
 * via `peaks sub-agent share` MAY also flow through headroom's
 * `SharedContext`. Slice #010 implements a peak-internal shared channel
 * (see `shared-channel.ts`); the headroom-side `SharedContext` is a
 * separate concept that future slices can layer on. For now this
 * function is a stub that returns the peak-internal channel ID, which
 * is enough to demonstrate the bridge contract.
 */
export function buildSharedContextBridge(batchId: string): { peakChannelId: string; headroomContextId: string } {
  return {
    peakChannelId: batchId,
    headroomContextId: `headroom-ctx-${batchId}`
  };
}
