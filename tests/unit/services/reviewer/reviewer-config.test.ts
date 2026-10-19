// Reviewer config: three load states, and the flag-driven writer the LLM
// uses instead of hand-authoring JSON (backlog §7.10 ①③).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  loadReviewerConfig,
  MIN_REVIEWER_PROVIDERS,
  resolveReviewerSchema,
  type ReviewerConfig
} from '../../../../src/services/reviewer/reviewer-config.js';
import {
  parseProviderSpec,
  validateReviewerSection,
  writeReviewerConfig
} from '../../../../src/services/reviewer/reviewer-config-write.js';

let configPath: string;

beforeEach(() => {
  configPath = join(mkdtempSync(join(tmpdir(), 'reviewer-config-')), 'config.json');
});

function section(providerCount: number): ReviewerConfig {
  const providers = Array.from({ length: providerCount }, (_, i) => ({
    name: 'ollama',
    model: `model-${String(i)}`
  }));
  return {
    providers,
    selection: 'round-robin',
    rdProviderName: null,
    requireDistinctModelFamily: true,
    fallbackOnError: 'skip',
    schemaPath: 'schemas/reviewer-envelope.schema.json'
  };
}

describe('loadReviewerConfig — three states', () => {
  it('when the config file is missing, should report no-reviewer-config with a zero count', () => {
    // given: no config file on disk
    // when:  the loader runs
    // then:  the state is "no section", not "not enough providers"
    const status = loadReviewerConfig({ path: configPath });
    expect(status).toEqual({
      ok: false,
      reason: 'no-reviewer-config',
      providerCount: 0,
      requiredProviders: MIN_REVIEWER_PROVIDERS
    });
  });

  it('when the section has only one valid provider, should name the count and the requirement', () => {
    // given: a config whose reviewer section has one provider
    // when:  the loader runs
    // then:  the state separates "insufficient" from "no section"
    writeFileSync(
      configPath,
      JSON.stringify({ reviewer: { providers: [{ name: 'ollama', model: 'llama3.2:8b' }] } }),
      'utf8'
    );
    const status = loadReviewerConfig({ path: configPath });
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.reason).toBe('insufficient-providers');
    expect(status.providerCount).toBe(1);
    expect(status.requiredProviders).toBe(2);
  });

  it('when two valid providers are present, should return the parsed config', () => {
    // given: the writer produced a usable section
    // when:  the loader reads it back
    // then:  the section is active and its fields survive the round trip
    const written = writeReviewerConfig(section(2), { path: configPath });
    expect(written.ok).toBe(true);
    const status = loadReviewerConfig({ path: configPath });
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.config.providers).toHaveLength(2);
    expect(status.config.selection).toBe('round-robin');
    expect(status.config.requireDistinctModelFamily).toBe(true);
  });

  it('when a provider entry is malformed, should count only the valid entries', () => {
    // given: three entries, only one of which has a model
    // when:  the loader parses the section
    // then:  the count is the valid subset and the state is insufficient
    writeFileSync(
      configPath,
      JSON.stringify({
        reviewer: {
          providers: [
            { name: 'ollama', model: 'llama3.2:8b' },
            { name: 'anthropic' },
            { model: 'gpt-4o-mini' }
          ]
        }
      }),
      'utf8'
    );
    const status = loadReviewerConfig({ path: configPath });
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.reason).toBe('insufficient-providers');
    expect(status.providerCount).toBe(1);
  });
});

describe('resolveReviewerSchema — project, package, absolute', () => {
  const DEFAULT_SCHEMA = 'schemas/reviewer-envelope.schema.json';

  it('when a consumer project has no schema, should resolve the packaged copy', () => {
    // given: a project root with no schemas/ directory (the consumer shape)
    // when:  the default schemaPath is resolved
    // then:  the packaged copy is found, which also verifies the package-root depth
    const consumerRoot = mkdtempSync(join(tmpdir(), 'reviewer-consumer-'));
    const resolution = resolveReviewerSchema(consumerRoot, DEFAULT_SCHEMA);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.source).toBe('package');
    expect(existsSync(resolution.path)).toBe(true);
    expect(resolution.path.startsWith(consumerRoot)).toBe(false);
  });

  it('when the project carries its own schema, should prefer the project copy', () => {
    // given: a project root that overrides the packaged schema
    // when:  the default schemaPath is resolved
    // then:  the project copy wins the resolution order
    const projectRoot = mkdtempSync(join(tmpdir(), 'reviewer-override-'));
    mkdirSync(join(projectRoot, 'schemas'), { recursive: true });
    writeFileSync(join(projectRoot, 'schemas', 'reviewer-envelope.schema.json'), '{}', 'utf8');
    const resolution = resolveReviewerSchema(projectRoot, DEFAULT_SCHEMA);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.source).toBe('project');
    expect(resolution.path).toBe(join(projectRoot, 'schemas', 'reviewer-envelope.schema.json'));
  });

  it('when the configured path is absolute, should use it as-is', () => {
    // given: an absolute schema path inside the project
    // when:  it is resolved
    // then:  no candidate order is applied
    const projectRoot = mkdtempSync(join(tmpdir(), 'reviewer-absolute-'));
    const absolute = join(projectRoot, 'custom.schema.json');
    writeFileSync(absolute, '{}', 'utf8');
    const resolution = resolveReviewerSchema(projectRoot, absolute);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.source).toBe('absolute');
    expect(resolution.path).toBe(absolute);
  });

  it('when nothing resolves, should return both searched candidates', () => {
    // given: a schema name present in neither the project nor the package
    // when:  it is resolved
    // then:  the refusal names every candidate the caller may create
    const projectRoot = mkdtempSync(join(tmpdir(), 'reviewer-missing-'));
    const resolution = resolveReviewerSchema(
      projectRoot,
      'schemas/absent-reviewer-envelope.schema.json'
    );
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.searched).toHaveLength(2);
    expect(resolution.searched[0]).toBe(
      join(projectRoot, 'schemas', 'absent-reviewer-envelope.schema.json')
    );
    expect(resolution.searched[1]).not.toBe(resolution.searched[0]);
    expect(resolution.searched[1]).toContain('absent-reviewer-envelope.schema.json');
  });
});

describe('writeReviewerConfig', () => {
  it('when writing the reviewer section, should preserve unrelated keys', () => {
    // given: an existing config with unrelated keys
    // when:  the reviewer section is written
    // then:  those keys are still there and the new section is readable
    writeFileSync(
      configPath,
      JSON.stringify({ version: '1', language: 'en', reviewer: { providers: [] } }),
      'utf8'
    );
    const written = writeReviewerConfig(section(2), { path: configPath });
    expect(written.ok).toBe(true);
    const raw = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    expect(raw['version']).toBe('1');
    expect(raw['language']).toBe('en');
    expect(JSON.stringify(raw['reviewer'])).toContain('model-0');
  });

  it('when the existing file is not valid JSON, should refuse to overwrite it', () => {
    // given: a corrupt config file
    // when:  the writer runs
    // then:  it reports unreadable-config and leaves the bytes alone
    writeFileSync(configPath, '{ not json', 'utf8');
    const written = writeReviewerConfig(section(2), { path: configPath });
    expect(written.ok).toBe(false);
    if (written.ok) return;
    expect(written.reason).toBe('unreadable-config');
    expect(readFileSync(configPath, 'utf8')).toBe('{ not json');
  });
});

describe('validateReviewerSection and parseProviderSpec', () => {
  it('when fewer than two providers are supplied, should reject the section', () => {
    // given: a section with one provider
    // when:  validation runs
    // then:  the message names the requirement
    const message = validateReviewerSection(section(1));
    expect(message).toContain('at least 2 providers are required');
  });

  it('when a provider is not dispatchable, should name the unsupported provider', () => {
    // given: a section naming a provider the dispatcher cannot call
    // when:  validation runs
    // then:  the message names it and the accepted set
    const message = validateReviewerSection({
      ...section(2),
      providers: [
        { name: 'bedrock', model: 'x' },
        { name: 'ollama', model: 'y' }
      ]
    });
    expect(message).toContain('unsupported provider "bedrock"');
    expect(message).toContain('ollama, anthropic, openai');
  });

  it('when a spec is name:model with a colon in the model, should split on the first colon', () => {
    // given: a spec whose model id contains a colon
    // when:  the spec is parsed
    // then:  the full model id is preserved
    expect(parseProviderSpec('ollama:llama3.2:8b')).toEqual({
      name: 'ollama',
      model: 'llama3.2:8b'
    });
    expect(parseProviderSpec('ollama')).toBeNull();
    expect(parseProviderSpec(':llama')).toBeNull();
  });
});

describe('writeReviewerConfig — the file is created', () => {
  it('when the config directory does not exist, should create it', () => {
    // given: a nested path whose parent directory is absent
    // when:  the writer runs
    // then:  both the directory and the file exist
    const nested = join(configPath, '..', 'nested', 'config.json');
    const written = writeReviewerConfig(section(2), { path: nested });
    expect(written.ok).toBe(true);
    expect(existsSync(nested)).toBe(true);
  });
});
