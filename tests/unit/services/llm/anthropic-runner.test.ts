// tests/unit/services/llm/anthropic-runner.test.ts
//
// Unit test for src/services/llm/anthropic-runner.ts — peaks-loop's first
// real LLM client and the binding behind `peaks audit goal`.
//
// Two concerns, asserted separately on purpose (AC5):
//   - env reading: `resolveAnthropicConfig()` against a passed-in env record
//   - request shape: `createAnthropicRunner()` against an INJECTED transport,
//     so no test in this file performs a network call.

import { describe, expect, it } from 'vitest';
import {
  createAnthropicRunner,
  LlmBindingError,
  LlmRequestError,
  resolveAnthropicConfig,
  type AnthropicConfig,
  type FetchLike,
  type LlmFetchInit,
  type LlmHttpResponse,
} from '../../../../src/services/llm/anthropic-runner.js';

const BEARER_CONFIG: AnthropicConfig = {
  baseUrl: 'https://llm.invalid',
  authToken: 'tok-123',
  authScheme: 'bearer',
  model: 'test-model',
};

function jsonResponse(body: unknown, status = 200): LlmHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function captureTransport(response: LlmHttpResponse): {
  fetchImpl: FetchLike;
  seen: () => { url: string; init: LlmFetchInit } | undefined;
} {
  let captured: { url: string; init: LlmFetchInit } | undefined;
  return {
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return response;
    },
    seen: () => captured,
  };
}

describe('resolveAnthropicConfig', () => {
  it('when both credential variables are set, should prefer ANTHROPIC_AUTH_TOKEN with a bearer header', () => {
    // given: an env carrying both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY
    const env = { ANTHROPIC_AUTH_TOKEN: 'session-token', ANTHROPIC_API_KEY: 'api-key', ANTHROPIC_MODEL: 'm' };

    // when: the config is resolved
    const config = resolveAnthropicConfig(env);

    // then: the session token wins and is sent as a bearer credential
    expect(config.authToken).toBe('session-token');
    expect(config.authScheme).toBe('bearer');
  });

  it('when only ANTHROPIC_API_KEY is set, should bind the credential to the x-api-key header', () => {
    // given: an env with a standalone Anthropic API key and no session token
    const env = { ANTHROPIC_API_KEY: 'api-key', ANTHROPIC_MODEL: 'm' };

    // when: the config is resolved
    const config = resolveAnthropicConfig(env);

    // then: the key uses its own header convention
    expect(config.authToken).toBe('api-key');
    expect(config.authScheme).toBe('x-api-key');
  });

  it('when no credential variable is set, should fail naming the absent environment variables', () => {
    // given: an env with a model but neither credential variable
    const env = { ANTHROPIC_MODEL: 'm' };

    // when: the config is resolved
    let thrown: unknown;
    try {
      resolveAnthropicConfig(env);
    } catch (error) {
      thrown = error;
    }

    // then: the gate refuses to bind instead of defaulting to a scaffold
    expect(thrown).toBeInstanceOf(LlmBindingError);
    expect((thrown as LlmBindingError).code).toBe('LLM_CREDENTIAL_MISSING');
    expect((thrown as Error).message).toContain('ANTHROPIC_AUTH_TOKEN');
    expect((thrown as Error).message).toContain('ANTHROPIC_API_KEY');
  });

  it('when the credential variable is blank, should treat it as absent', () => {
    // given: an env whose credential variables are whitespace-only
    const env = { ANTHROPIC_AUTH_TOKEN: '   ', ANTHROPIC_API_KEY: '', ANTHROPIC_MODEL: 'm' };

    // when: the config is resolved
    let thrown: unknown;
    try {
      resolveAnthropicConfig(env);
    } catch (error) {
      thrown = error;
    }

    // then: an unusable credential fails exactly like a missing one
    expect(thrown).toBeInstanceOf(LlmBindingError);
    expect((thrown as LlmBindingError).code).toBe('LLM_CREDENTIAL_MISSING');
  });

  it('when no model variable is set, should fail naming the model variables', () => {
    // given: an env with credentials but no model
    const env = { ANTHROPIC_API_KEY: 'api-key' };

    // when: the config is resolved
    let thrown: unknown;
    try {
      resolveAnthropicConfig(env);
    } catch (error) {
      thrown = error;
    }

    // then: the absence is reported rather than guessed at
    expect(thrown).toBeInstanceOf(LlmBindingError);
    expect((thrown as LlmBindingError).code).toBe('LLM_MODEL_MISSING');
    expect((thrown as Error).message).toContain('ANTHROPIC_MODEL');
  });

  it('when ANTHROPIC_MODEL is unset, should fall back to CLAUDE_CODE_SUBAGENT_MODEL', () => {
    // given: an env whose only model declaration is the subagent override
    const env = { ANTHROPIC_API_KEY: 'api-key', CLAUDE_CODE_SUBAGENT_MODEL: 'subagent-model' };

    // when: the config is resolved
    const config = resolveAnthropicConfig(env);

    // then: the subagent model is used
    expect(config.model).toBe('subagent-model');
  });

  it('when ANTHROPIC_BASE_URL is unset, should default to the public Anthropic endpoint', () => {
    // given: an env with a credential and a model but no base URL
    const env = { ANTHROPIC_API_KEY: 'api-key', ANTHROPIC_MODEL: 'm' };

    // when: the config is resolved
    const config = resolveAnthropicConfig(env);

    // then: the public endpoint is used
    expect(config.baseUrl).toBe('https://api.anthropic.com');
  });

  it('when ANTHROPIC_BASE_URL carries trailing slashes, should strip them', () => {
    // given: a base URL with trailing separators
    const env = { ANTHROPIC_API_KEY: 'api-key', ANTHROPIC_MODEL: 'm', ANTHROPIC_BASE_URL: 'https://gateway.invalid/anthropic//' };

    // when: the config is resolved
    const config = resolveAnthropicConfig(env);

    // then: the path cannot double up into `//v1/messages`
    expect(config.baseUrl).toBe('https://gateway.invalid/anthropic');
  });
});

describe('createAnthropicRunner', () => {
  it('when called, should POST the prompts to <base>/v1/messages with the bearer credential', async () => {
    // given: a runner bound to an injected transport
    const transport = captureTransport(jsonResponse({ content: [{ type: 'text', text: 'hello' }] }));
    const runner = createAnthropicRunner(BEARER_CONFIG, { fetchImpl: transport.fetchImpl });

    // when: one call is made
    await runner.call('system-prompt', 'user-prompt', { maxTokens: 77 });

    // then: the request matches the Anthropic Messages API shape
    const seen = transport.seen();
    expect(seen?.url).toBe('https://llm.invalid/v1/messages');
    expect(seen?.init.method).toBe('POST');
    expect(seen?.init.headers['content-type']).toBe('application/json');
    expect(seen?.init.headers['anthropic-version']).toBe('2023-06-01');
    expect(seen?.init.headers['authorization']).toBe('Bearer tok-123');
    expect(seen?.init.headers['x-api-key']).toBeUndefined();
    expect(JSON.parse(seen?.init.body ?? '{}')).toEqual({
      model: 'test-model',
      max_tokens: 77,
      system: 'system-prompt',
      messages: [{ role: 'user', content: 'user-prompt' }],
    });
  });

  it('when the binding uses an API key, should send the x-api-key header instead of a bearer token', async () => {
    // given: a runner bound with the x-api-key convention
    const transport = captureTransport(jsonResponse({ content: [{ type: 'text', text: 'hello' }] }));
    const runner = createAnthropicRunner({ ...BEARER_CONFIG, authToken: 'api-key', authScheme: 'x-api-key' }, { fetchImpl: transport.fetchImpl });

    // when: one call is made
    await runner.call('s', 'u', { maxTokens: 10 });

    // then: only the key header carries the credential
    const headers = transport.seen()?.init.headers ?? {};
    expect(headers['x-api-key']).toBe('api-key');
    expect(headers['authorization']).toBeUndefined();
  });

  it('when the call is made, should bound it with an abort signal', async () => {
    // given: a runner with an explicit timeout
    const transport = captureTransport(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }));
    const runner = createAnthropicRunner(BEARER_CONFIG, { fetchImpl: transport.fetchImpl, timeoutMs: 5_000 });

    // when: one call is made
    await runner.call('s', 'u', { maxTokens: 10 });

    // then: the transport receives a signal so a hung provider cannot hang the gate
    expect(transport.seen()?.init.signal).toBeInstanceOf(AbortSignal);
    expect(transport.seen()?.init.signal.aborted).toBe(false);
  });

  it('when the reply carries several text blocks, should join them and map the token usage', async () => {
    // given: a reply whose text is split across blocks, alongside a non-text block
    const transport = captureTransport(
      jsonResponse({
        content: [{ type: 'text', text: '{"a":' }, { type: 'thinking' }, { type: 'text', text: '1}' }],
        usage: { input_tokens: 11, output_tokens: 22 },
      })
    );
    const runner = createAnthropicRunner(BEARER_CONFIG, { fetchImpl: transport.fetchImpl });

    // when: one call is made
    const result = await runner.call('s', 'u', { maxTokens: 10 });

    // then: the caller sees the reassembled text and the reported usage
    expect(result.output).toBe('{"a":1}');
    expect(result.tokens).toEqual({ input: 11, output: 22 });
  });

  it('when the provider answers non-2xx, should throw LLM_REQUEST_FAILED naming the status', async () => {
    // given: a transport answering 401
    const transport = captureTransport(jsonResponse({ error: 'unauthorized' }, 401));
    const runner = createAnthropicRunner(BEARER_CONFIG, { fetchImpl: transport.fetchImpl });

    // when: one call is made
    let thrown: unknown;
    try {
      await runner.call('s', 'u', { maxTokens: 10 });
    } catch (error) {
      thrown = error;
    }

    // then: the failure is bounded and diagnosable, never a silent empty audit
    expect(thrown).toBeInstanceOf(LlmRequestError);
    expect((thrown as LlmRequestError).code).toBe('LLM_REQUEST_FAILED');
    expect((thrown as Error).message).toContain('401');
  });

  it('when the transport times out, should throw LLM_REQUEST_FAILED naming the timeout', async () => {
    // given: a transport that rejects the way an aborted fetch does
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    const runner = createAnthropicRunner(BEARER_CONFIG, {
      fetchImpl: async () => {
        throw timeoutError;
      },
      timeoutMs: 1_234,
    });

    // when: one call is made
    let thrown: unknown;
    try {
      await runner.call('s', 'u', { maxTokens: 10 });
    } catch (error) {
      thrown = error;
    }

    // then: the timeout is reported as such
    expect(thrown).toBeInstanceOf(LlmRequestError);
    expect((thrown as Error).message).toContain('1234ms');
  });

  it('when the reply is not JSON, should throw LLM_REQUEST_FAILED instead of an empty audit', async () => {
    // given: a transport whose body cannot be parsed
    const runner = createAnthropicRunner(BEARER_CONFIG, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
        text: async () => '<html>',
      }),
    });

    // when: one call is made
    let thrown: unknown;
    try {
      await runner.call('s', 'u', { maxTokens: 10 });
    } catch (error) {
      thrown = error;
    }

    // then: the caller is told the reply was unreadable
    expect(thrown).toBeInstanceOf(LlmRequestError);
    expect((thrown as Error).message).toContain('not valid JSON');
  });

  it('when the reply carries no text block, should throw LLM_REQUEST_FAILED', async () => {
    // given: a reply made only of non-text blocks
    const transport = captureTransport(jsonResponse({ content: [{ type: 'tool_use' }] }));
    const runner = createAnthropicRunner(BEARER_CONFIG, { fetchImpl: transport.fetchImpl });

    // when: one call is made
    let thrown: unknown;
    try {
      await runner.call('s', 'u', { maxTokens: 10 });
    } catch (error) {
      thrown = error;
    }

    // then: an empty reply is a failure, not an audit
    expect(thrown).toBeInstanceOf(LlmRequestError);
    expect((thrown as Error).message).toContain('no text block');
  });
});
