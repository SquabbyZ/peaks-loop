import { describe, expect, it } from 'vitest';
import { deriveModelFamily, modelFamily } from '../../../src/services/reviewer/model-family.js';

describe('model-family.ts', () => {
  it('anthropic direct ids bucket to "claude"', () => {
    expect(modelFamily('claude-opus-4-8')).toBe('claude');
    expect(modelFamily('claude-haiku-4-5')).toBe('claude');
    expect(modelFamily('claude-sonnet-4-5-20250929')).toBe('claude');
    expect(modelFamily('anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('claude');
  });

  it('openai ids bucket by major family (gpt-4o / gpt-4 / gpt-3.5 / gpt-5)', () => {
    expect(modelFamily('gpt-4o-mini')).toBe('gpt-4o');
    expect(modelFamily('gpt-4o-2024-08-06')).toBe('gpt-4o');
    expect(modelFamily('gpt-4-turbo')).toBe('gpt-4');
    expect(modelFamily('gpt-4-0613')).toBe('gpt-4');
    expect(modelFamily('gpt-3.5-turbo')).toBe('gpt-3.5');
    expect(modelFamily('gpt-5-preview')).toBe('gpt-5');
    expect(modelFamily('o1-preview')).toBe('o1');
    expect(modelFamily('o3-mini')).toBe('o3');
  });

  it('ollama ids bucket to llama / mistral / qwen / deepseek / gemini', () => {
    expect(modelFamily('llama3.2:8b')).toBe('llama');
    expect(modelFamily('llama3.1:70b-instruct-q4_K_M')).toBe('llama');
    expect(modelFamily('mistral:7b')).toBe('mistral');
    expect(modelFamily('mixtral:8x7b')).toBe('mistral');
    expect(modelFamily('qwen2.5:14b')).toBe('qwen');
    expect(modelFamily('deepseek-r1:7b')).toBe('deepseek');
    expect(modelFamily('gemma2:27b').startsWith('unknown-')).toBe(true);
    // gemini (google) lands under the gemini rule
    expect(modelFamily('gemini-1.5-pro')).toBe('gemini');
  });

  it('bedrock-hosted anthropic ids bucket to "claude" via anthropic.claude- rule', () => {
    expect(modelFamily('us.anthropic.claude-3-5-sonnet-20241022-v2:0')).toBe('claude');
    expect(modelFamily('bedrock/anthropic/claude-3-haiku-20240307-v1:0')).toBe('claude');
    expect(modelFamily('bedrock/meta/llama3-70b-instruct')).toBe('bedrock-llama');
    expect(modelFamily('bedrock/mistral/mistral-7b-instruct')).toBe('bedrock-mistral');
  });

  it('azure-hosted openai ids bucket to "azure-openai"', () => {
    expect(modelFamily('azure-openai-gpt-4o')).toBe('azure-openai');
    expect(modelFamily('azure-gpt-4-turbo')).toBe('azure-openai');
  });

  it('unrecognised ids fall back to a deterministic "unknown-<hash>" bucket', () => {
    const a = deriveModelFamily('future-model-xyz-9');
    const b = deriveModelFamily('future-model-xyz-9');
    const c = deriveModelFamily('different-unknown-9');
    expect(a.modelFamily).toMatch(/^unknown-[0-9a-f]{8}$/);
    expect(a.source).toBe('fallback-hash');
    expect(a.modelFamily).toBe(b.modelFamily);
    expect(a.modelFamily).not.toBe(c.modelFamily);
  });

  it('empty / whitespace-only ids return unknown-empty without throwing', () => {
    expect(modelFamily('')).toBe('unknown-empty');
    expect(modelFamily('   ').length).toBeGreaterThan(0);
  });

  it('deriveModelFamily returns source="rule" for matched ids', () => {
    expect(deriveModelFamily('claude-opus-4-8').source).toBe('rule');
    expect(deriveModelFamily('gpt-4o-mini').source).toBe('rule');
    expect(deriveModelFamily('llama3.2:8b').source).toBe('rule');
  });

  it('cross-family distinctness: claude != gpt-4o != llama', () => {
    expect(modelFamily('claude-opus-4-8')).not.toBe(modelFamily('gpt-4o-mini'));
    expect(modelFamily('claude-haiku-4-5')).not.toBe(modelFamily('llama3.2:8b'));
    expect(modelFamily('gpt-4o-mini')).not.toBe(modelFamily('llama3.2:8b'));
  });

  it('modelFamily() is pure and side-effect free', () => {
    const before = modelFamily('claude-opus-4-8');
    for (let i = 0; i < 50; i += 1) modelFamily('claude-opus-4-8');
    expect(modelFamily('claude-opus-4-8')).toBe(before);
  });
});
