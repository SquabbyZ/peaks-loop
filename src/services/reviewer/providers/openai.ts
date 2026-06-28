/**
 * openai provider — OpenAI Chat Completions. Reads API key from the
 * env var named in `provider.apiKeyEnv` (default `OPENAI_API_KEY`).
 * Per A4 prohibition, NO SDK; we use fetch directly.
 */
import type { ReviewerProviderConfig } from '../reviewer-config.js';
import type { ProviderCallInput, ProviderCallResult } from './ollama.js';

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_API_KEY_ENV = 'OPENAI_API_KEY';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOKENS = 1024;
const TEMPERATURE = 0;

export async function callOpenAI(input: ProviderCallInput): Promise<ProviderCallResult> {
  const start = Date.now();
  const envVar = input.provider.apiKeyEnv ?? DEFAULT_API_KEY_ENV;
  const apiKey = process.env[envVar];
  if (!apiKey) {
    return { ok: false, error: `missing env ${envVar}`, latencyMs: Date.now() - start };
  }
  const endpoint = input.provider.endpoint ?? DEFAULT_ENDPOINT;
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = input.signal ?? controller.signal;
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: input.provider.model,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        messages: [{ role: 'user', content: input.prompt }]
      }),
      signal
    });
    if (!res.ok) {
      const detail = await safeReadError(res);
      return { ok: false, error: `openai http ${res.status}: ${detail}`, latencyMs: Date.now() - start };
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const text = typeof json.choices?.[0]?.message?.content === 'string'
      ? (json.choices[0].message.content as string)
      : '';
    return { ok: true, modelId: input.provider.model, text, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: `openai ${err instanceof Error ? err.message : String(err)}`,
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
