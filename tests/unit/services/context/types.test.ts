/**
 * Per spec §4.1 context.json schema (v1.0), the ContextJson interface
 * is the single source of truth for downstream services. This test
 * pins the public shape so any breaking change must update the schema
 * version (H1 / H2 / H8 hard constraints).
 */
import { describe, it, expect } from 'vitest';
import { ContextJsonSchema } from '../../../../src/services/context/context-schema.js';

describe('ContextJsonSchema', () => {
  it('accepts a valid minimal context.json', () => {
    const result = ContextJsonSchema.safeParse({
      version: '1.0',
      goal: 'add OAuth callback',
      generatedAt: '2026-06-21T12:00:00Z',
      sha256: 'a'.repeat(64),
      collector: {
        files: [],
        gitStatus: { branch: 'main', lastCommit: 'abc', dirty: false },
        memoryEntries: [],
        deps: {},
      },
      docRetriever: { fetchedDocs: [], skipped: [] },
      tokenizer: { metadata: [] },
      renderer: {
        audience: 'all',
        renderedAt: '2026-06-21T12:00:00Z',
        sizeBytes: 0,
        truncated: false,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a context.json with wrong version', () => {
    const result = ContextJsonSchema.safeParse({
      version: '0.9',
      goal: 'x',
      generatedAt: '2026-06-21T12:00:00Z',
      sha256: 'a'.repeat(64),
      collector: { files: [], gitStatus: { branch: 'm', lastCommit: 'c', dirty: false }, memoryEntries: [], deps: {} },
      docRetriever: { fetchedDocs: [], skipped: [] },
      tokenizer: { metadata: [] },
      renderer: { audience: 'all', renderedAt: '2026-06-21T12:00:00Z', sizeBytes: 0, truncated: false },
    });
    expect(result.success).toBe(false);
  });

  it('rejects sha256 with wrong length', () => {
    const result = ContextJsonSchema.safeParse({
      version: '1.0',
      goal: 'x',
      generatedAt: '2026-06-21T12:00:00Z',
      sha256: 'tooshort',
      collector: { files: [], gitStatus: { branch: 'm', lastCommit: 'c', dirty: false }, memoryEntries: [], deps: {} },
      docRetriever: { fetchedDocs: [], skipped: [] },
      tokenizer: { metadata: [] },
      renderer: { audience: 'all', renderedAt: '2026-06-21T12:00:00Z', sizeBytes: 0, truncated: false },
    });
    expect(result.success).toBe(false);
  });
});