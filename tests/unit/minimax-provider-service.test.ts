import { describe, expect, test, vi } from 'vitest';
import { runMiniMaxPrompt, testMiniMaxProvider } from '../../src/services/providers/minimax-provider-service.js';

function createFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

describe('testMiniMaxProvider', () => {
  test('returns unconfigured status without calling fetch when base URL or API key is missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await testMiniMaxProvider({ baseUrl: 'https://api.minimaxi.com/anthropic' }, {}, fetchImpl);
    const emptyResult = await testMiniMaxProvider({}, {}, fetchImpl);

    expect(result).toMatchObject({
      provider: 'minimax',
      configured: false,
      baseUrlConfigured: true,
      apiKeyConfigured: false,
      endpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
      model: 'MiniMax-M2.7',
      ok: false,
      status: 0,
      responseText: null
    });
    expect(emptyResult).toMatchObject({
      configured: false,
      baseUrlConfigured: false,
      apiKeyConfigured: false,
      endpoint: '',
      ok: false,
      status: 0,
      responseText: null
    });
    const malformedResult = await testMiniMaxProvider({ baseUrl: 'not a url' }, {}, fetchImpl);
    expect(malformedResult).toMatchObject({
      configured: false,
      baseUrlConfigured: false,
      apiKeyConfigured: false,
      endpoint: '',
      ok: false,
      status: 0,
      responseText: null
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('does not call fetch for non-HTTPS, non-MiniMax, or malformed base URLs even when manually configured', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const httpResult = await testMiniMaxProvider({ baseUrl: 'http://api.minimaxi.com/anthropic', apiKey: 'secret-key' }, {}, fetchImpl);
    const credentialUrlResult = await testMiniMaxProvider({ baseUrl: 'https://user:pass@api.minimaxi.com/anthropic', apiKey: 'secret-key' }, {}, fetchImpl);
    const wrongHostResult = await testMiniMaxProvider({ baseUrl: 'https://example.com/anthropic', apiKey: 'secret-key' }, {}, fetchImpl);
    const queryUrlResult = await testMiniMaxProvider({ baseUrl: 'https://api.minimaxi.com/anthropic?apiKey=secret-key', apiKey: 'secret-key' }, {}, fetchImpl);
    const fragmentUrlResult = await testMiniMaxProvider({ baseUrl: 'https://api.minimaxi.com/anthropic#token=secret-key', apiKey: 'secret-key' }, {}, fetchImpl);
    const malformedResult = await testMiniMaxProvider({ baseUrl: 'not a url', apiKey: 'secret-key' }, {}, fetchImpl);

    expect(httpResult).toMatchObject({
      configured: false,
      baseUrlConfigured: false,
      apiKeyConfigured: true,
      endpoint: '',
      ok: false,
      status: 0,
      responseText: null
    });
    expect(credentialUrlResult).toMatchObject({
      configured: false,
      baseUrlConfigured: false,
      apiKeyConfigured: true,
      endpoint: '',
      ok: false,
      status: 0,
      responseText: null
    });
    expect(wrongHostResult).toMatchObject({
      configured: false,
      baseUrlConfigured: false,
      apiKeyConfigured: true,
      endpoint: '',
      ok: false,
      status: 0,
      responseText: null
    });
    expect(queryUrlResult).toMatchObject({
      configured: false,
      baseUrlConfigured: false,
      apiKeyConfigured: true,
      endpoint: '',
      ok: false,
      status: 0,
      responseText: null
    });
    expect(fragmentUrlResult).toMatchObject({
      configured: false,
      baseUrlConfigured: false,
      apiKeyConfigured: true,
      endpoint: '',
      ok: false,
      status: 0,
      responseText: null
    });
    expect(malformedResult).toMatchObject({
      configured: false,
      baseUrlConfigured: false,
      apiKeyConfigured: true,
      endpoint: '',
      ok: false,
      status: 0,
      responseText: null
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('sends a minimal Anthropic-compatible smoke request and extracts text responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(createFetchResponse(200, { content: [{ type: 'text', text: 'The answer is peaks-ok.' }] }));

    const result = await testMiniMaxProvider({ baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'secret-key' }, { model: ' MiniMax-M2 ' }, fetchImpl);

    expect(result).toMatchObject({
      configured: true,
      endpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
      model: 'MiniMax-M2',
      ok: true,
      status: 200,
      responseText: 'The answer is peaks-ok.'
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.minimaxi.com/anthropic/v1/messages', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'content-type': 'application/json',
        'x-api-key': 'secret-key',
        'anthropic-version': '2023-06-01'
      }),
      signal: expect.any(AbortSignal),
      redirect: 'error'
    }));
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string) as { model: string; max_tokens: number; messages: { role: string; content: string }[] };
    expect(body).toEqual({ model: 'MiniMax-M2', max_tokens: 64, messages: [{ role: 'user', content: 'Output exactly: peaks-ok' }] });
  });

  test('accepts text responses when no success marker is required', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(createFetchResponse(200, { content: [{ type: 'text', text: 'free-form response' }] }));

    await expect(runMiniMaxPrompt({ baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'secret' }, { prompt: 'Say anything' }, fetchImpl)).resolves.toMatchObject({ ok: true, responseText: 'free-form response' });
  });

  test('trims API keys before sending MiniMax prompt headers', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(createFetchResponse(200, { content: [{ type: 'text', text: 'free-form response' }] }));

    await runMiniMaxPrompt({ baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: '  secret-key  ' }, { prompt: 'Say anything' }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith('https://api.minimaxi.com/anthropic/v1/messages', expect.objectContaining({
      headers: expect.objectContaining({
        'x-api-key': 'secret-key'
      })
    }));
  });

  test('rejects sensitive model values before calling MiniMax', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(runMiniMaxPrompt(
      { baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'secret' },
      { model: 'ghp_1234567890abcdefghijklmnopqrst', prompt: 'Say anything' },
      fetchImpl
    )).rejects.toThrow('possible sensitive material');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects oversized model values before calling MiniMax', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(runMiniMaxPrompt(
      { baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'secret' },
      { model: 'a'.repeat(129), prompt: 'Say anything' },
      fetchImpl
    )).rejects.toThrow('model must be 128 characters or less');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('accepts prefix matches when success matching uses startsWith', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(createFetchResponse(200, { content: [{ type: 'text', text: 'peaks-ok and more' }] }));

    await expect(runMiniMaxPrompt(
      { baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'secret' },
      { prompt: 'Say anything', successText: 'peaks-ok', successMatch: 'startsWith' },
      fetchImpl
    )).resolves.toMatchObject({ ok: true, responseText: 'peaks-ok and more' });
  });

  test('truncates long summaries without changing the response text', async () => {
    const longText = `${'a'.repeat(121)}b`;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(createFetchResponse(200, { content: [{ type: 'text', text: longText }] }));

    await expect(runMiniMaxPrompt({ baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'secret' }, { prompt: 'Say anything' }, fetchImpl)).resolves.toMatchObject({
      ok: true,
      responseText: longText,
      summary: `${'a'.repeat(117)}...`
    });
  });

  test('marks non-matching or malformed provider responses as failed without throwing', async () => {
    const wrongTextFetch = vi.fn<typeof fetch>().mockResolvedValue(createFetchResponse(200, { content: [{ type: 'text', text: 'nope' }, { type: 'image', text: 'ignored' }] }));
    const emptyContentFetch = vi.fn<typeof fetch>().mockResolvedValue(createFetchResponse(200, { content: [{ type: 'image', text: 'ignored' }] }));
    const malformedFetch = vi.fn<typeof fetch>().mockResolvedValue(createFetchResponse(500, { error: 'bad' }));
    const invalidJsonFetch = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('invalid json'); } } as unknown as Response);
    const fetchError = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down with secret-token'));

    await expect(testMiniMaxProvider({ baseUrl: 'https://api.minimaxi.com/anthropic/', apiKey: 'secret' }, {}, wrongTextFetch)).resolves.toMatchObject({ ok: false, responseText: 'nope' });
    await expect(testMiniMaxProvider({ baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'secret' }, {}, emptyContentFetch)).resolves.toMatchObject({ ok: false, responseText: null });
    await expect(testMiniMaxProvider({ baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'secret' }, {}, malformedFetch)).resolves.toMatchObject({ ok: false, status: 500, responseText: null });
    await expect(testMiniMaxProvider({ baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'secret' }, {}, invalidJsonFetch)).resolves.toMatchObject({ ok: false, status: 200, responseText: null });
    await expect(testMiniMaxProvider({ baseUrl: 'https://api.minimaxi.com/anthropic', apiKey: 'secret' }, {}, fetchError)).resolves.toMatchObject({ ok: false, status: 0, summary: 'network down with [redacted]-[redacted]' });
  });
});
