/**
 * anthropic provider — Anthropic Messages API. Reads API key from the
 * env var named in `provider.apiKeyEnv` (default `ANTHROPIC_API_KEY`).
 * Per A4 prohibition, NO SDK; we use fetch directly.
 */
import type { ReviewerProviderConfig } from '../reviewer-config.js';
import type { ProviderCallInput, ProviderCallResult } from './ollama.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-08';
const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_API_KEY_ENV = 'ANTHROPIC_API_KEY';
const MAX_TOKENS = 1024;

export async function callAnthropic(input: ProviderCallInput): Promise<ProviderCallResult> {
  const start = Date.now();
  const envVar = input.provider.apiKeyEnv ?? DEFAULT_API_KEY_ENV;
  const apiKey = process.env[envVar];
  if (!apiKey) {
    return { ok: false, error: `missing env ${envVar}`, latencyMs: Date.now() - start };
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = input.signal ?? controller.signal;
  try {
    const res = await fetchImpl(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: input.provider.model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: input.prompt }]
      }),
      signal
    });
    if (!res.ok) {
      const detail = await safeReadError(res);
      return { ok: false, error: `anthropic http ${res.status}: ${detail}`, latencyMs: Date.now() - start };
    }
    const json = (await res.json()) as { content?: Array<{ type?: string; text?: unknown }> };
    const textBlock = (json.content ?? []).find((b) => b.type === 'text' && typeof b.text === 'string');
    const text = typeof textBlock?.text === 'string' ? textBlock.text : '';
    return { ok: true, modelId: input.provider.model, text, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: `anthropic ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function safeReadError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    const msg = body.error?.message;
    return typeof msg === 'string' ? msg.slice(0, 200) : 'unknown';
  } catch {
    return 'unknown';
  }
}
