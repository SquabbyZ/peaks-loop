/**
 * The first real `LlmRunner` in peaks-loop: it binds a caller to the
 * Anthropic Messages API shape at `<ANTHROPIC_BASE_URL>/v1/messages`,
 * which is the same endpoint the running session is already using.
 *
 * Why this exists: `peaks audit goal` is the entry gate for every
 * peaks-* workflow, and until this file landed the CLI could only answer
 * with a fixed `scaffold-only` envelope — a gate that gated nothing.
 *
 * No SDK and no new runtime dependency: Node 18+ global `fetch` covers it.
 * Every transport concern (auth scheme, timeout, text extraction) lives
 * here so the CLI layer never speaks HTTP itself, and so tests can inject
 * a fake transport instead of reaching the network.
 */

import { getErrorMessage } from 'peaks-loop-shared/result';
import type { LlmRunner } from '../audit/audit-goal-service.js';

/** Public Anthropic endpoint. `ANTHROPIC_BASE_URL` overrides it (gateways, local proxies). */
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/** One call is bounded: an unbounded gate is a hung gate. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Enough of an error body to name the cause without dumping a payload into a message. */
const MAX_BODY_SNIPPET = 200;

/**
 * The subset of `Response` this client touches. Declared narrowly so tests
 * can inject a plain object and stay off the network.
 */
export interface LlmHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface LlmFetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal;
}

export type FetchLike = (url: string, init: LlmFetchInit) => Promise<LlmHttpResponse>;

/**
 * Wrapped rather than aliased: `fetch` takes a wider `RequestInit`, which
 * does not satisfy `LlmFetchInit` under `strictFunctionTypes`.
 */
const defaultFetch: FetchLike = (url, init) => fetch(url, init);

/** Which header carries the credential. */
export type AnthropicAuthScheme = 'bearer' | 'x-api-key';

export interface AnthropicConfig {
  readonly baseUrl: string;
  readonly authToken: string;
  readonly authScheme: AnthropicAuthScheme;
  readonly model: string;
}

/**
 * Thrown when the environment cannot name a usable LLM. `code` distinguishes
 * an absent credential from an absent model so the CLI can name the env var
 * to set instead of degrading into a scaffold.
 */
export class LlmBindingError extends Error {
  readonly code: 'LLM_CREDENTIAL_MISSING' | 'LLM_MODEL_MISSING';

  /**
   * The environment variables that were absent, verbatim.
   *
   * `message` also names them, but `fail()` runs every envelope message
   * through `redactSensitiveErrorMessage`, whose catch-all pattern matches
   * the words `token` / `api_key` and would strip them out of this very
   * message. Callers must surface `missingEnv` on a channel the redactor
   * does not touch (envelope `data` / `nextActions`) so the operator is told
   * exactly what to set.
   */
  readonly missingEnv: readonly string[];

  constructor(code: 'LLM_CREDENTIAL_MISSING' | 'LLM_MODEL_MISSING', message: string, missingEnv: readonly string[]) {
    super(message);
    this.name = 'LlmBindingError';
    this.code = code;
    this.missingEnv = missingEnv;
  }
}

/** Thrown when a bound LLM could not be reached, answered non-2xx, or answered without text. */
export class LlmRequestError extends Error {
  readonly code = 'LLM_REQUEST_FAILED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'LlmRequestError';
  }
}

/** A blank value is as unusable as an absent one. */
function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Resolve the session's LLM from the environment.
 *
 * Precedence:
 *   - credential: `ANTHROPIC_AUTH_TOKEN` first (it is what a Claude-Code
 *     session exports for a gateway), else `ANTHROPIC_API_KEY`.
 *   - auth header: `Authorization: Bearer` for `ANTHROPIC_AUTH_TOKEN`,
 *     `x-api-key` for `ANTHROPIC_API_KEY` — each matches its own convention.
 *   - model: `ANTHROPIC_MODEL`, else `CLAUDE_CODE_SUBAGENT_MODEL`.
 *   - base URL: `ANTHROPIC_BASE_URL`, else the public Anthropic endpoint.
 *     Expected WITHOUT a trailing `/v1` — this function appends `/v1/messages`.
 *
 * Throws `LlmBindingError` rather than defaulting: a gate that quietly
 * falls back is the bug this file was written to remove.
 */
export function resolveAnthropicConfig(env: NodeJS.ProcessEnv = process.env): AnthropicConfig {
  const authToken = readEnv(env, 'ANTHROPIC_AUTH_TOKEN');
  const apiKey = readEnv(env, 'ANTHROPIC_API_KEY');
  const credential = authToken ?? apiKey;
  if (!credential) {
    throw new LlmBindingError(
      'LLM_CREDENTIAL_MISSING',
      'No LLM credential in the environment: set ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) so the audit gate can reach the LLM this session already uses.',
      ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']
    );
  }

  const model = readEnv(env, 'ANTHROPIC_MODEL') ?? readEnv(env, 'CLAUDE_CODE_SUBAGENT_MODEL');
  if (!model) {
    throw new LlmBindingError(
      'LLM_MODEL_MISSING',
      'No LLM model in the environment: set ANTHROPIC_MODEL (or CLAUDE_CODE_SUBAGENT_MODEL) so the audit gate knows which model to bind to.',
      ['ANTHROPIC_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']
    );
  }

  return {
    baseUrl: (readEnv(env, 'ANTHROPIC_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    authToken: credential,
    authScheme: authToken ? 'bearer' : 'x-api-key',
    model
  };
}

export interface AnthropicRunnerOptions {
  /** Injected transport. Tests pass a fake so no test performs a network call. */
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

type AnthropicContentBlock = { readonly type?: string; readonly text?: string };

interface AnthropicMessagePayload {
  readonly content?: readonly AnthropicContentBlock[];
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

function isTextBlock(block: AnthropicContentBlock): block is { type: 'text'; text: string } {
  return block.type === 'text' && typeof block.text === 'string';
}

/** `fetch` rejects on abort with a DOMException whose `name` says why. */
function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export function createAnthropicRunner(
  config: AnthropicConfig,
  options: AnthropicRunnerOptions = {}
): LlmRunner {
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${config.baseUrl}/v1/messages`;

  return {
    async call(systemPrompt: string, userPrompt: string, opts: { maxTokens: number }) {
      const body = JSON.stringify({
        model: config.model,
        max_tokens: opts.maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });

      let response: LlmHttpResponse;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
            ...(config.authScheme === 'bearer'
              ? { authorization: `Bearer ${config.authToken}` }
              : { 'x-api-key': config.authToken })
          },
          body,
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        if (isAbort(error)) {
          throw new LlmRequestError(`LLM request to ${url} timed out after ${timeoutMs}ms`);
        }
        throw new LlmRequestError(`LLM request to ${url} failed: ${getErrorMessage(error)}`);
      }

      if (!response.ok) {
        throw new LlmRequestError(
          `LLM request to ${url} failed: HTTP ${response.status}${await bodySnippet(response)}`
        );
      }

      let payload: AnthropicMessagePayload;
      try {
        payload = (await response.json()) as AnthropicMessagePayload;
      } catch (error) {
        throw new LlmRequestError(`LLM reply from ${url} was not valid JSON: ${getErrorMessage(error)}`);
      }

      const blocks = Array.isArray(payload.content) ? payload.content : [];
      const output = blocks.filter(isTextBlock).map((block) => block.text).join('');
      if (!output) {
        throw new LlmRequestError(`LLM reply from ${url} carried no text block`);
      }

      return {
        output,
        tokens: {
          input: payload.usage?.input_tokens ?? 0,
          output: payload.usage?.output_tokens ?? 0
        }
      };
    }
  };
}

async function bodySnippet(response: LlmHttpResponse): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text ? `: ${text.slice(0, MAX_BODY_SNIPPET)}` : '';
  } catch {
    return '';
  }
}
