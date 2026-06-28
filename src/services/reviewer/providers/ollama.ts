/**
 * ollama provider — local ollama daemon at `endpoint` (default
 * http://localhost:11434). Uses ollama's `/api/chat` endpoint which is
 * OpenAI-compatible at the message-shape level. Pure fetch + JSON —
 * no SDK, per A4 prohibition on heavy deps.
 */
import type { ReviewerProviderConfig } from '../reviewer-config.js';

export type ProviderCallInput = {
  provider: ReviewerProviderConfig;
  prompt: string;
  /** Caller injects fetch for testability. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch | undefined;
  /** AbortSignal for timeout control (callers should set one). */
  signal?: AbortSignal | undefined;
};

export type ProviderCallResult =
  | { ok: true; modelId: string; text: string; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';
const REQUEST_TIMEOUT_MS = 30_000;

export async function callOllama(input: ProviderCallInput): Promise<ProviderCallResult> {
  const start = Date.now();
  const endpoint = (input.provider.endpoint ?? DEFAULT_OLLAMA_ENDPOINT).replace(/\/$/, '');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = input.signal ?? controller.signal;
  try {
    const res = await fetchImpl(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: input.provider.model,
        stream: false,
        messages: [{ role: 'user', content: input.prompt }]
      }),
      signal
    });
    if (!res.ok) {
      return { ok: false, error: `ollama http ${res.status}`, latencyMs: Date.now() - start };
    }
    const json = (await res.json()) as { message?: { content?: unknown } };
    const text = typeof json.message?.content === 'string' ? json.message.content : '';
    return { ok: true, modelId: input.provider.model, text, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: `ollama ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: Date.now() - start
    };
  } finally {
    clearTimeout(timeout);
  }
}
