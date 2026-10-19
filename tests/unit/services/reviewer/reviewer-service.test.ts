// Reviewer service: a skip is not a pass (backlog §7.10 ②). These arms pin
// the shape that any consumer reading `passed` / `gateAction` sees.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildSkippedEnvelope,
  distinctFromKarpathy,
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

describe('schemaPath — the configured schema is load-bearing', () => {
  it('when the configured schemaPath does not resolve, should refuse before the provider call', async () => {
    // given: a configured reviewer whose schemaPath names a file that does not exist
    // when:  the reviewer runs
    // then:  it refuses with schema-missing and no provider is contacted
    writeConfig({ schemaPath: 'schemas/absent-reviewer-envelope.schema.json' });
    const projectRoot = mkdtempSync(join(tmpdir(), 'reviewer-project-'));
    let providerCalls = 0;
    const fetchImpl = (async () => {
      providerCalls += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;
    const result = await runReviewer({
      rid: 'r1',
      context: 'x',
      configPath,
      projectRoot,
      fetchImpl
    });
    expect(providerCalls).toBe(0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('schema-missing');
    expect(result.schemaCandidates).toHaveLength(2);
    for (const candidate of result.schemaCandidates ?? []) {
      expect(candidate).toContain('absent-reviewer-envelope.schema.json');
    }
    expect(result.envelope.passed).toBe(false);
    expect(result.envelope.reason).toContain('absent-reviewer-envelope.schema.json');
  });

  it('when a consumer project ships no schema, should fall through to the packaged copy', async () => {
    // given: a project root with no schemas/ directory (the consumer shape)
    // when:  the reviewer runs with the default schemaPath
    // then:  the schema bundled with the package resolves and the run proceeds
    writeConfig();
    const projectRoot = mkdtempSync(join(tmpdir(), 'reviewer-consumer-'));
    const result = await runReviewer({
      rid: 'r1',
      context: 'x',
      configPath,
      projectRoot,
      fetchImpl: ollamaFetch(JSON.stringify(VALID_ENVELOPE))
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.skipped).toBe(false);
    expect(result.envelope.passed).toBe(true);
    expect(result.envelope.modelFamily).toBe('llama');
  });
});

describe('distinctFromKarpathy — a skip is not a distinct family', () => {
  it('when the third-party review was skipped, should not report it as distinct', () => {
    // given: a skip (or an empty family), which has no comparable family
    // when:  the distinctness verdict is computed
    // then:  "not comparable" is not reported as "distinct"
    expect(distinctFromKarpathy('skipped', 'llama')).toBe(false);
    expect(distinctFromKarpathy('', 'llama')).toBe(false);
  });

  it('when the RD family is missing, should not report the pair as distinct', () => {
    // given: a real third-party family against a skip or an empty RD family
    // when:  the distinctness verdict is computed
    // then:  the guard is symmetric — a missing side is still not "distinct"
    expect(distinctFromKarpathy('gpt-4o', 'skipped')).toBe(false);
    expect(distinctFromKarpathy('gpt-4o', '')).toBe(false);
  });

  it('when the two families differ, should report distinct', () => {
    // given: a third-party family different from the RD family
    // when:  the distinctness verdict is computed
    // then:  it is distinct
    expect(distinctFromKarpathy('gpt-4o', 'llama')).toBe(true);
  });

  it('when the families are the same, should not report distinct', () => {
    // given: the same family on both sides
    // when:  the distinctness verdict is computed
    // then:  it is not distinct
    expect(distinctFromKarpathy('llama', 'llama')).toBe(false);
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
