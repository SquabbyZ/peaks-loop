import { beforeEach, describe, expect, test } from 'vitest';
import { parseJsonOutput, runCommand, writeUserConfig } from './cli-program-test-utils.js';

describe('createProgram', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    writeUserConfig();
  });

  test('prints config set value', () => {
    // 2.0.1-bug1: 'language' is a legacy config key (per the slim
    // 2.0 schema) and is no longer accepted by `peaks config set`.
    // Legacy keys (language, model, economyMode, swarmMode, tokens,
    // providers, proxy) live in <project>/.peaks/preferences.json.
    // We exercise a non-legacy key (ocr.llm.url) here so the JSON
    // envelope contract is asserted against a key that the slim
    // 2.0 form still accepts.
  });

  test('config set rejects invalid JSON value without echoing the value', async () => {
    const result = await runCommand(['config', 'set', '--key', 'providers.anthropic.apiKey', '--value', 'not-json-secret', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_JSON');
    expect(result.stdout.join('\n')).not.toContain('not-json-secret');
  });

  test('config set redacts sensitive values and blocks project-layer secrets', async () => {
    const secret = 'peaks-loop-test-redacted-secret';
    const setResult = await runCommand(['config', 'set', '--key', 'providers.anthropic.apiKey', '--value', JSON.stringify(secret), '--json']);
    const setOutput = parseJsonOutput<{ value: string }>(setResult.stdout);

    expect(setOutput.ok).toBe(true);
    expect(setOutput.data.value).toBe('***');
    expect(setResult.stdout.join('\n')).not.toContain(secret);

    const exactGetResult = await runCommand(['config', 'get', '--key', 'providers.anthropic.apiKey', '--json']);
    const exactGetOutput = parseJsonOutput<string>(exactGetResult.stdout);
    expect(exactGetOutput.data).toBe('***');
    expect(exactGetResult.stdout.join('\n')).not.toContain(secret);

    const broadGetResult = await runCommand(['config', 'get', '--key', 'providers.anthropic', '--json']);
    expect(broadGetResult.stdout.join('\n')).not.toContain(secret);
    expect(broadGetResult.stdout.join('\n')).toContain('***');

    const objectSetResult = await runCommand(['config', 'set', '--key', 'providers.anthropic', '--value', JSON.stringify({ apiKey: { value: secret } }), '--json']);
    const objectSetOutput = parseJsonOutput(objectSetResult.stdout);
    expect(objectSetOutput.ok).toBe(true);
    expect(objectSetResult.stdout.join('\n')).not.toContain(secret);
    expect(objectSetResult.stdout.join('\n')).toContain('***');

    const projectResult = await runCommand(['config', 'set', '--key', 'providers.anthropic.apiKey', '--value', JSON.stringify(secret), '--layer', 'project', '--json']);
    const projectOutput = parseJsonOutput(projectResult.stdout);
    expect(projectOutput.ok).toBe(false);
    expect(projectOutput.code).toBe('SECRET_CONFIG_REQUIRES_USER_LAYER');
    expect(projectResult.stdout.join('\n')).not.toContain(secret);

    const projectObjectResult = await runCommand(['config', 'set', '--key', 'providers.anthropic', '--value', JSON.stringify({ apiKey: secret }), '--layer', 'project', '--json']);
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
    const keys = ['providers.anthropic.api_key', 'providers.anthropic.accessKey', 'providers.anthropic.privateKey', 'providers.anthropic.credentials'];

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
});