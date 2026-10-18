// Reviewer service: a skip is not a pass (backlog §7.10 ②). These arms pin
// the shape that any consumer reading `passed` / `gateAction` sees.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildSkippedEnvelope,
  runReviewer,
  type ReviewerEnvelope
} from '../../../../src/services/reviewer/reviewer-service.js';
import type { ReviewerConfig } from '../../../../src/services/reviewer/reviewer-config.js';

let configPath: string;

beforeEach(() => {
  configPath = join(mkdtempSync(join(tmpdir(), 'reviewer-service-')), 'config.json');
});

function writeConfig(overrides: Partial<ReviewerConfig> = {}): void {
  const config: ReviewerConfig = {
    providers: [
      { name: 'ollama', model: 'llama3.2:8b' },
      { name: 'ollama', model: 'qwen2.5:7b' }
    ],
    selection: 'round-robin',
    rdProviderName: null,
    requireDistinctModelFamily: true,
    fallbackOnError: 'skip',
    schemaPath: 'schemas/reviewer-envelope.schema.json',
    ...overrides
  };
  writeFileSync(configPath, JSON.stringify({ reviewer: config }), 'utf8');
}

function ollamaFetch(text: string): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ message: { content: text } })
  })) as unknown as typeof fetch;
}

function failingFetch(): typeof fetch {
  return (async () => ({
    ok: false,
    status: 500,
    json: async () => ({ error: { message: 'boom' } })
  })) as unknown as typeof fetch;
}

const VALID_ENVELOPE: ReviewerEnvelope = {
  reviewerId: 'third-party-reviewer-v2.14.0',
  modelId: 'llama3.2:8b',
  modelFamily: 'llama',
  passed: true,
  violations: [],
  gateAction: 'allow',
  reason: 'no findings'
};

describe('runReviewer — skip paths are never a pass', () => {
  it('when no reviewer config exists, should report a skip with passed false and gateAction warn', () => {
    // given: a config path that does not exist
    // when:  the reviewer runs
    // then:  the skip envelope cannot be read as green from passed/gateAction alone
    return runReviewer({ rid: 'r1', context: 'x', configPath }).then((result) => {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('no-reviewer-config');
      expect(result.envelope.passed).toBe(false);
      expect(result.envelope.gateAction).toBe('warn');
      expect(result.envelope.reason).toContain('skipped: no-reviewer-config');
    });
  });

  it('when the section has fewer than two providers, should name the count in the skip reason', async () => {
    // given: a config whose section has one provider
    // when:  the reviewer runs
    // then:  the reason states the count and the requirement
    writeConfig({ providers: [{ name: 'ollama', model: 'llama3.2:8b' }] });
    const result = await runReviewer({ rid: 'r1', context: 'x', configPath });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('insufficient-providers');
    expect(result.envelope.passed).toBe(false);
    expect(result.envelope.gateAction).toBe('warn');
    expect(result.envelope.reason).toContain('1 valid, >=2 required');
  });

  it('when the provider call fails and fallbackOnError is skip, should return a skip envelope', async () => {
    // given: a configured reviewer whose provider returns HTTP 500
    // when:  the reviewer runs
    // then:  the envelope is a skip, not a pass
    writeConfig();
    const result = await runReviewer({
      rid: 'r1',
      context: 'x',
      configPath,
      fetchImpl: failingFetch()
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBe(true);
    expect(result.envelope.passed).toBe(false);
    expect(result.envelope.gateAction).toBe('warn');
    expect(result.envelope.reason).toContain('fallbackOnError=skip');
  });

  it('when the provider returns non-conforming JSON, should return a skip envelope', async () => {
    // given: a provider whose reply contains no JSON object
    // when:  the reviewer runs
    // then:  the envelope is a skip, not a pass
    writeConfig();
    const result = await runReviewer({
      rid: 'r1',
      context: 'x',
      configPath,
      fetchImpl: ollamaFetch('I cannot answer that.')
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBe(true);
    expect(result.envelope.passed).toBe(false);
    expect(result.envelope.gateAction).toBe('warn');
  });

  it('when the provider returns a valid envelope, should report skipped false and stamp the model family', async () => {
    // given: a provider reply that validates against the envelope schema
    // when:  the reviewer runs
    // then:  the verdict is real and modelFamily comes from the model we called
    writeConfig();
    const result = await runReviewer({
      rid: 'r1',
      context: 'x',
      configPath,
      fetchImpl: ollamaFetch(JSON.stringify(VALID_ENVELOPE))
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBe(false);
    expect(result.envelope.passed).toBe(true);
    expect(result.envelope.gateAction).toBe('allow');
    expect(result.envelope.modelId).toBe('llama3.2:8b');
    expect(result.envelope.modelFamily).toBe('llama');
  });

  it('when fallbackOnError is error, should throw instead of returning a skip', async () => {
    // given: a configured reviewer told to fail closed
    // when:  the provider errors
    // then:  the failure surfaces instead of a soft skip
    writeConfig({ fallbackOnError: 'error' });
    await expect(
      runReviewer({ rid: 'r1', context: 'x', configPath, fetchImpl: failingFetch() })
    ).rejects.toThrow(/peaks-reviewer/);
  });
});

describe('buildSkippedEnvelope', () => {
  it('should never return passed:true with gateAction:allow', () => {
    // given: any skip reason
    // when:  the skip envelope is built
    // then:  the green pair is impossible — this arm fails if the old shape returns
    const envelope = buildSkippedEnvelope('skipped: test');
    expect(envelope.passed).toBe(false);
    expect(envelope.gateAction).toBe('warn');
    expect(envelope.passed === true && envelope.gateAction === 'allow').toBe(false);
    expect(envelope.modelId).toBe('skipped');
    expect(envelope.modelFamily).toBe('skipped');
  });
});
