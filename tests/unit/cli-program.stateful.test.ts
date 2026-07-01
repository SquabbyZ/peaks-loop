import { beforeEach, describe, expect, test } from 'vitest';
import { getMinimaxSmokeTest, getMinimaxWorkerRun, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

describe('createProgram', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  test('worker minimax rejects blank inputs before calling the worker', async () => {
    const result = await runCommand(['worker', 'minimax', '--confirm', '--session-id', ' ', '--goal', 'Refactor checkout flow', '--coding-task', 'Update checkout state handling', '--unit-test-task', 'Add focused unit tests', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_WORKER_INPUT');
    expect(getMinimaxWorkerRun()).not.toHaveBeenCalled();
  });

  test('prints config set value', async () => {
    // 2.0.1-bug1: 'language' is a legacy config key (per the slim
    // 2.0 schema) and is no longer accepted by `peaks config set`.
    // Legacy keys (language, model, economyMode, swarmMode, tokens,
    // providers, proxy) live in <project>/.peaks/preferences.json.
    // We exercise a non-legacy key (ocr.llm.url) here so the JSON
    // envelope contract is asserted against a key that the slim
    // 2.0 form still accepts.
    const result = await runCommand(['config', 'set', '--key', 'ocr.llm.url', '--value', '"https://api.example.com/v1"', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('config.set');

    const layeredResult = await runCommand(['config', 'set', '--key', 'ocr.llm.url', '--value', '"https://api.example.com/v1"', '--layer', 'user', '--json']);
    const layeredOutput = parseJsonOutput(layeredResult.stdout);
    expect(layeredOutput.ok).toBe(true);
  });

  test('config set rejects invalid JSON value without echoing the value', async () => {
    const result = await runCommand(['config', 'set', '--key', 'providers.minimax.apiKey', '--value', 'not-json-secret', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_JSON');
    expect(result.stdout.join('\n')).not.toContain('not-json-secret');
  });

  test('config set redacts sensitive values and blocks project-layer secrets', async () => {
    const secret = 'peaks-loop-test-redacted-secret';
    const setResult = await runCommand(['config', 'set', '--key', 'providers.minimax.apiKey', '--value', JSON.stringify(secret), '--json']);
    const setOutput = parseJsonOutput<{ value: string }>(setResult.stdout);

    expect(setOutput.ok).toBe(true);
    expect(setOutput.data.value).toBe('***');
    expect(setResult.stdout.join('\n')).not.toContain(secret);

    const exactGetResult = await runCommand(['config', 'get', '--key', 'providers.minimax.apiKey', '--json']);
    const exactGetOutput = parseJsonOutput<string>(exactGetResult.stdout);
    expect(exactGetOutput.data).toBe('***');
    expect(exactGetResult.stdout.join('\n')).not.toContain(secret);

    const broadGetResult = await runCommand(['config', 'get', '--key', 'providers.minimax', '--json']);
    expect(broadGetResult.stdout.join('\n')).not.toContain(secret);
    expect(broadGetResult.stdout.join('\n')).toContain('***');

    const objectSetResult = await runCommand(['config', 'set', '--key', 'providers.minimax', '--value', JSON.stringify({ apiKey: { value: secret } }), '--json']);
    const objectSetOutput = parseJsonOutput(objectSetResult.stdout);
    expect(objectSetOutput.ok).toBe(true);
    expect(objectSetResult.stdout.join('\n')).not.toContain(secret);
    expect(objectSetResult.stdout.join('\n')).toContain('***');

    const projectResult = await runCommand(['config', 'set', '--key', 'providers.minimax.apiKey', '--value', JSON.stringify(secret), '--layer', 'project', '--json']);
    const projectOutput = parseJsonOutput(projectResult.stdout);
    expect(projectOutput.ok).toBe(false);
    expect(projectOutput.code).toBe('SECRET_CONFIG_REQUIRES_USER_LAYER');
    expect(projectResult.stdout.join('\n')).not.toContain(secret);

    const projectObjectResult = await runCommand(['config', 'set', '--key', 'providers.minimax', '--value', JSON.stringify({ apiKey: secret }), '--layer', 'project', '--json']);
    const projectObjectOutput = parseJsonOutput(projectObjectResult.stdout);
    expect(projectObjectOutput.ok).toBe(false);
    expect(projectObjectOutput.code).toBe('SECRET_CONFIG_REQUIRES_USER_LAYER');
    expect(projectObjectResult.stdout.join('\n')).not.toContain(secret);

    const invalidLayerResult = await runCommand(['config', 'set', '--key', 'language', '--value', '"en"', '--layer', 'invalid', '--json']);
    const invalidLayerOutput = parseJsonOutput(invalidLayerResult.stdout);
    expect(invalidLayerOutput.ok).toBe(false);
    expect(invalidLayerOutput.code).toBe('INVALID_CONFIG_LAYER');

    const invalidGetLayerResult = await runCommand(['config', 'get', '--key', 'language', '--layer', 'invalid', '--json']);
    const invalidGetLayerOutput = parseJsonOutput(invalidGetLayerResult.stdout);
    expect(invalidGetLayerOutput.ok).toBe(false);
    expect(invalidGetLayerOutput.code).toBe('INVALID_CONFIG_LAYER');
  });

  test('config set and get redact common sensitive key variants', async () => {
    const secret = 'peaks-loop-sensitive-variant-secret';
    const keys = ['providers.minimax.api_key', 'providers.minimax.accessKey', 'providers.minimax.privateKey', 'providers.minimax.credentials'];

    for (const key of keys) {
      const setResult = await runCommand(['config', 'set', '--key', key, '--value', JSON.stringify(secret), '--json']);
      const setOutput = parseJsonOutput<{ value: string }>(setResult.stdout);
      expect(setOutput.ok).toBe(true);
      expect(setOutput.data.value).toBe('***');
      expect(setResult.stdout.join('\n')).not.toContain(secret);

      const getResult = await runCommand(['config', 'get', '--key', key, '--json']);
      const getOutput = parseJsonOutput<string>(getResult.stdout);
      expect(getOutput.ok).toBe(true);
      expect(getOutput.data).toBe('***');
      expect(getResult.stdout.join('\n')).not.toContain(secret);
    }
  });

  test('config provider minimax set get and status redact api keys', async () => {
    const secret = 'peaks-loop-provider-test-secret';
    const baseUrl = 'https://api.minimaxi.com/anthropic';
    const keyOnlyResult = await runCommand(['config', 'provider', 'minimax', 'set', '--json'], { MINIMAX_API_KEY: secret });
    const keyOnlyOutput = parseJsonOutput<{ apiKeyConfigured: boolean }>(keyOnlyResult.stdout);
    expect(keyOnlyOutput.ok).toBe(true);
    expect(keyOnlyOutput.data.apiKeyConfigured).toBe(true);

    const setResult = await runCommand(['config', 'provider', 'minimax', 'set', '--base-url', baseUrl, '--json'], { MINIMAX_API_KEY: secret });
    const setOutput = parseJsonOutput<{ baseUrlConfigured: boolean; apiKeyConfigured: boolean }>(setResult.stdout);

    expect(setOutput.ok).toBe(true);
    expect(setOutput.command).toBe('config.provider.minimax.set');
    expect(setOutput.data.baseUrlConfigured).toBe(true);
    expect(setOutput.data.apiKeyConfigured).toBe(true);
    expect(setResult.stdout.join('\n')).not.toContain(secret);

    const getResult = await runCommand(['config', 'provider', 'minimax', 'get', '--json']);
    const getOutput = parseJsonOutput<{ baseUrl: string; apiKey: string }>(getResult.stdout);
    expect(getOutput.ok).toBe(true);
    expect(getOutput.data.baseUrl).toBe(baseUrl);
    expect(getOutput.data.apiKey).toBe('***');
    expect(getResult.stdout.join('\n')).not.toContain(secret);

    const statusResult = await runCommand(['config', 'provider', 'minimax', 'status', '--json']);
    const statusOutput = parseJsonOutput<{ configured: boolean }>(statusResult.stdout);
    expect(statusOutput.ok).toBe(true);
    expect(statusOutput.data.configured).toBe(true);
    expect(statusResult.stdout.join('\n')).not.toContain(secret);
  });

  test('config provider minimax status and config get redact invalid persisted base URLs', async () => {
    const secret = 'peaks-loop-invalid-provider-secret';
    writeUserConfig({ providers: { minimax: { baseUrl: 'https://user:pass@api.minimaxi.com/anthropic', apiKey: secret } } });

    const statusResult = await runCommand(['config', 'provider', 'minimax', 'status', '--json']);
    const statusOutput = parseJsonOutput<{ configured: boolean; baseUrlConfigured: boolean; apiKeyConfigured: boolean }>(statusResult.stdout);

    expect(statusOutput.ok).toBe(true);
    expect(statusOutput.data.configured).toBe(false);
    expect(statusOutput.data.baseUrlConfigured).toBe(false);
    expect(statusOutput.data.apiKeyConfigured).toBe(true);
    expect(statusResult.stdout.join('\n')).not.toContain(secret);
    expect(statusResult.stdout.join('\n')).not.toContain('user:pass');

    const providerGetResult = await runCommand(['config', 'provider', 'minimax', 'get', '--json']);
    expect(providerGetResult.stdout.join('\n')).not.toContain(secret);
    expect(providerGetResult.stdout.join('\n')).not.toContain('user:pass');
    expect(providerGetResult.stdout.join('\n')).toContain('https://api.minimaxi.com/anthropic');
    expect(providerGetResult.stdout.join('\n')).toContain('***');

    const configGetResult = await runCommand(['config', 'get', '--key', 'providers.minimax.baseUrl', '--json']);
    const configGetOutput = parseJsonOutput<string>(configGetResult.stdout);
    expect(configGetOutput.ok).toBe(true);
    expect(configGetOutput.data).toBe('https://api.minimaxi.com/anthropic');
    expect(configGetResult.stdout.join('\n')).not.toContain(secret);
    expect(configGetResult.stdout.join('\n')).not.toContain('user:pass');

    const configAllResult = await runCommand(['config', 'get', '--json']);
    expect(configAllResult.stdout.join('\n')).not.toContain(secret);
    expect(configAllResult.stdout.join('\n')).not.toContain('user:pass');

    writeUserConfig({ providers: { minimax: { baseUrl: 'https://api.minimaxi.com/anthropic?apiKey=query-secret#token=fragment-secret', apiKey: secret } } });
    const queryConfigGetResult = await runCommand(['config', 'get', '--key', 'providers.minimax.baseUrl', '--json']);
    expect(queryConfigGetResult.stdout.join('\n')).not.toContain('query-secret');
    expect(queryConfigGetResult.stdout.join('\n')).not.toContain('fragment-secret');
    expect(queryConfigGetResult.stdout.join('\n')).toContain('https://api.minimaxi.com/anthropic');

    writeUserConfig({ providers: { minimax: { baseUrl: 'not a url with embedded-secret', apiKey: secret } } });
    const malformedGetResult = await runCommand(['config', 'get', '--key', 'providers.minimax.baseUrl', '--json']);
    const malformedGetOutput = parseJsonOutput<string>(malformedGetResult.stdout);
    expect(malformedGetOutput.data).toBe('[invalid-url-redacted]');
    expect(malformedGetResult.stdout.join('\n')).not.toContain('embedded-secret');
  });

  test('config provider minimax test returns redacted smoke results', async () => {
    const secret = 'peaks-loop-provider-smoke-secret';
    const baseUrl = 'https://api.minimaxi.com/anthropic';
    await runCommand(['config', 'provider', 'minimax', 'set', '--base-url', baseUrl, '--json'], { MINIMAX_API_KEY: secret });
    getMinimaxSmokeTest().mockResolvedValue({
      provider: 'minimax',
      configured: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      endpoint: `${baseUrl}/v1/messages`,
      model: 'MiniMax-M2.7',
      ok: true,
      status: 200,
      responseText: null,
      summary: 'peaks-ok'
    });

    const result = await runCommand(['config', 'provider', 'minimax', 'test', '--json']);
    const output = parseJsonOutput<{ ok: boolean; model: string; summary: string | null }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('config.provider.minimax.test');
    expect(output.data.model).toBe('MiniMax-M2.7');
    expect(output.data.summary).toBeNull();
    expect(result.stdout.join('\n')).not.toContain(secret);
    expect(getMinimaxSmokeTest()).toHaveBeenCalledWith({ baseUrl, apiKey: secret, model: 'minimax-2.7' }, { model: 'MiniMax-M2.7' });
  });

  test('config provider minimax test reports unconfigured and failed smoke tests', async () => {
    getMinimaxSmokeTest().mockResolvedValueOnce({
      provider: 'minimax',
      configured: false,
      baseUrlConfigured: false,
      apiKeyConfigured: false,
      endpoint: '',
      model: 'MiniMax-M2.7',
      ok: false,
      status: 0,
      responseText: null
    });
    const unconfiguredResult = await runCommand(['config', 'provider', 'minimax', 'test', '--json']);
    const unconfiguredOutput = parseJsonOutput(unconfiguredResult.stdout);
    expect(unconfiguredOutput.ok).toBe(false);
    expect(unconfiguredOutput.code).toBe('MINIMAX_PROVIDER_NOT_CONFIGURED');
    expect(unconfiguredResult.exitCode).toBe(1);

    getMinimaxSmokeTest().mockResolvedValueOnce({
      provider: 'minimax',
      configured: true,
      baseUrlConfigured: true,
      apiKeyConfigured: true,
      endpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
      model: 'MiniMax-M2',
      ok: false,
      status: 401,
      responseText: null
    });
    const failedResult = await runCommand(['config', 'provider', 'minimax', 'test', '--model', 'MiniMax-M2', '--json']);
    const failedOutput = parseJsonOutput(failedResult.stdout);
    expect(failedOutput.ok).toBe(false);
    expect(failedOutput.code).toBe('MINIMAX_PROVIDER_TEST_FAILED');
    expect(failedResult.exitCode).toBe(1);
    expect(getMinimaxSmokeTest()).toHaveBeenLastCalledWith(expect.any(Object), { model: 'MiniMax-M2' });

    getMinimaxSmokeTest().mockRejectedValueOnce(new Error('network down with peaks-loop-provider-smoke-secret'));
    const thrownResult = await runCommand(['config', 'provider', 'minimax', 'test', '--json']);
    const thrownOutput = (parseJsonOutput(thrownResult.stdout) as ReturnType<typeof parseJsonOutput> & { message: string });
    expect(thrownOutput.ok).toBe(false);
    expect(thrownOutput.code).toBe('MINIMAX_PROVIDER_TEST_FAILED');
    expect(thrownOutput.message).toContain('network down with peaks-loop-provider-smoke-[redacted]');
    expect(thrownResult.exitCode).toBe(1);
    expect(thrownResult.stdout.join('\n')).not.toContain('peaks-loop-provider-smoke-secret');
  });

  test('worker minimax requires explicit confirmation', async () => {
    const result = await runCommand(['worker', 'minimax', '--session-id', 'checkout-refactor', '--goal', 'Refactor checkout flow', '--coding-task', 'Update checkout state handling', '--unit-test-task', 'Add focused unit tests', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('CONFIRMATION_REQUIRED');
    expect(result.exitCode).toBe(1);
    expect(getMinimaxWorkerRun()).not.toHaveBeenCalled();
  });

  test('minimax-worker top-level command requires explicit confirmation', async () => {
    const result = await runCommand(['minimax-worker', '--session-id', 'checkout-refactor', '--goal', 'Refactor checkout flow', '--coding-task', 'Update checkout state handling', '--unit-test-task', 'Add focused unit tests', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.command).toBe('worker.minimax');
    expect(output.code).toBe('CONFIRMATION_REQUIRED');
    expect(result.exitCode).toBe(1);
    expect(getMinimaxWorkerRun()).not.toHaveBeenCalled();
  });

  test('worker minimax redacts review handoff when provider is unconfigured', async () => {
    const sensitivePrompt = 'SECRET REVIEW PROMPT SHOULD NOT LEAK';
    const sensitiveSummary = 'SECRET WORKER SUMMARY SHOULD NOT LEAK';
    getMinimaxWorkerRun().mockResolvedValue({
      provider: {
        provider: 'minimax',
        configured: false,
        baseUrlConfigured: false,
        apiKeyConfigured: false,
        endpoint: '',
        model: 'MiniMax-M2.7',
        ok: false,
        status: 0,
        responseText: null,
        summary: sensitiveSummary
      },
      reviewHandoff: {
        model: 'claude-opus-4-7',
        prompt: sensitivePrompt
      },
      constraints: {
        allowShell: false,
        allowFileWrites: false
      }
    });

    const result = await runCommand(['worker', 'minimax', '--confirm', '--session-id', 'checkout-refactor', '--goal', 'Refactor checkout flow', '--coding-task', 'Update checkout state handling', '--unit-test-task', 'Add focused unit tests', '--json']);
    const output = parseJsonOutput<{ reviewHandoff: { prompt: string } }>(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('MINIMAX_PROVIDER_NOT_CONFIGURED');
    expect(output.data.reviewHandoff.prompt).toBe('[redacted]');
    expect(result.exitCode).toBe(1);
    expect(result.stdout.join('\n')).not.toContain(sensitivePrompt);
    expect(result.stdout.join('\n')).not.toContain(sensitiveSummary);
  });

  test('worker minimax runs the execution worker and returns a review handoff', async () => {
    getMinimaxWorkerRun().mockResolvedValue({
      provider: {
        provider: 'minimax',
        configured: true,
        baseUrlConfigured: true,
        apiKeyConfigured: true,
        endpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
        model: 'MiniMax-M2.7',
        ok: true,
        status: 200,
        responseText: null,
        summary: 'peaks-ok'
      },
      reviewHandoff: {
        model: 'claude-opus-4-7',
        prompt: 'Review handoff'
      },
      constraints: {
        allowShell: false,
        allowFileWrites: false
      }
    });

    const result = await runCommand(['worker', 'minimax', '--confirm', '--session-id', 'checkout-refactor', '--goal', 'Refactor checkout flow', '--coding-task', 'Update checkout state handling', '--unit-test-task', 'Add focused unit tests', '--json']);
    const output = parseJsonOutput<{ reviewHandoff: { model: string; prompt: string } }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('worker.minimax');
    expect(output.data.reviewHandoff.model).toBe('claude-opus-4-7');
    expect(output.data.reviewHandoff.prompt).toBe('[redacted]');
    expect(getMinimaxWorkerRun()).toHaveBeenCalledWith(expect.any(Object), {
      sessionId: 'checkout-refactor',
      goal: 'Refactor checkout flow',
      codingTask: 'Update checkout state handling',
      unitTestTask: 'Add focused unit tests',
      model: 'MiniMax-M2.7'
    });
  });

  test('worker minimax reports provider failure and thrown failures', async () => {
    getMinimaxWorkerRun().mockResolvedValueOnce({
      provider: {
        provider: 'minimax',
        configured: true,
        baseUrlConfigured: true,
        apiKeyConfigured: true,
        endpoint: 'https://api.minimaxi.com/anthropic/v1/messages',
        model: 'MiniMax-M2.7',
        ok: false,
        status: 500,
        responseText: null,
        summary: 'provider failed'
      },
      reviewHandoff: { model: 'claude-opus-4-7', prompt: 'Review handoff' },
      constraints: { allowShell: false, allowFileWrites: false }
    });
    const failedResult = await runCommand(['worker', 'minimax', '--confirm', '--session-id', 'checkout-refactor', '--goal', 'Refactor checkout flow', '--coding-task', 'Update checkout state handling', '--unit-test-task', 'Add focused unit tests', '--json']);
    expect(parseJsonOutput(failedResult.stdout).code).toBe('MINIMAX_WORKER_FAILED');
    expect(failedResult.exitCode).toBe(1);

    getMinimaxWorkerRun().mockRejectedValueOnce(new Error('network down with secret'));
    const thrownResult = await runCommand(['worker', 'minimax', '--confirm', '--session-id', 'checkout-refactor', '--goal', 'Refactor checkout flow', '--coding-task', 'Update checkout state handling', '--unit-test-task', 'Add focused unit tests', '--json']);
    const thrownOutput = (parseJsonOutput(thrownResult.stdout) as ReturnType<typeof parseJsonOutput> & { message: string });
    expect(thrownOutput.code).toBe('MINIMAX_WORKER_FAILED');
    expect(thrownOutput.message).toContain('network down with [redacted]');
    expect(thrownResult.stdout.join('\n')).not.toContain('secret');
  });

  test('config provider minimax validates inputs', async () => {
    const missingResult = await runCommand(['config', 'provider', 'minimax', 'set', '--json']);
    const missingOutput = parseJsonOutput(missingResult.stdout);
    expect(missingOutput.ok).toBe(false);
    expect(missingOutput.code).toBe('MINIMAX_PROVIDER_NO_VALUES');

    const invalidUrlResult = await runCommand(['config', 'provider', 'minimax', 'set', '--base-url', 'ftp://example.com', '--json']);
    const invalidUrlOutput = parseJsonOutput(invalidUrlResult.stdout);
    expect(invalidUrlOutput.ok).toBe(false);
    expect(invalidUrlOutput.code).toBe('INVALID_MINIMAX_BASE_URL');

    const httpUrlResult = await runCommand(['config', 'provider', 'minimax', 'set', '--base-url', 'http://api.minimaxi.com/anthropic', '--json']);
    const httpUrlOutput = parseJsonOutput(httpUrlResult.stdout);
    expect(httpUrlOutput.ok).toBe(false);
    expect(httpUrlOutput.code).toBe('INVALID_MINIMAX_BASE_URL');

    const credentialUrlResult = await runCommand(['config', 'provider', 'minimax', 'set', '--base-url', 'https://user:pass@api.minimaxi.com/anthropic', '--json']);
    const credentialUrlOutput = parseJsonOutput(credentialUrlResult.stdout);
    expect(credentialUrlOutput.ok).toBe(false);
    expect(credentialUrlOutput.code).toBe('INVALID_MINIMAX_BASE_URL');
    expect(credentialUrlResult.stdout.join('\n')).not.toContain('user:pass');

    const wrongHostResult = await runCommand(['config', 'provider', 'minimax', 'set', '--base-url', 'https://example.com/anthropic', '--json']);
    const wrongHostOutput = parseJsonOutput(wrongHostResult.stdout);
    expect(wrongHostOutput.ok).toBe(false);
    expect(wrongHostOutput.code).toBe('INVALID_MINIMAX_BASE_URL');

  });

  test('config set enforces MiniMax HTTPS base URL validation', async () => {
    const directResult = await runCommand(['config', 'set', '--key', 'providers.minimax.baseUrl', '--value', '"http://api.minimaxi.com/anthropic"', '--json']);
    const directOutput = parseJsonOutput(directResult.stdout);
    expect(directOutput.ok).toBe(false);
    expect(directOutput.code).toBe('INVALID_MINIMAX_BASE_URL');

    const objectResult = await runCommand(['config', 'set', '--key', 'providers.minimax', '--value', JSON.stringify({ baseUrl: 'http://api.minimaxi.com/anthropic' }), '--json']);
    const objectOutput = parseJsonOutput(objectResult.stdout);
    expect(objectOutput.ok).toBe(false);
    expect(objectOutput.code).toBe('INVALID_MINIMAX_BASE_URL');

    const wrongHostResult = await runCommand(['config', 'set', '--key', 'providers.minimax.baseUrl', '--value', '"https://example.com/anthropic"', '--json']);
    const wrongHostOutput = parseJsonOutput(wrongHostResult.stdout);
    expect(wrongHostOutput.ok).toBe(false);
    expect(wrongHostOutput.code).toBe('INVALID_MINIMAX_BASE_URL');
  });
});
