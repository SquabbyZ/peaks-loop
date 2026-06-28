import { describe, it, expect } from 'vitest';
import { tokenize } from '../../../../src/services/context/tokenizer.js';
import type {
  CollectorOutput, DocRetrieverOutput,
} from '../../../../src/services/context/types.js';

function makeCollector(): CollectorOutput {
  return {
    files: [{ path: 'src/A.ts', kind: 'source', lines: 10, hash: 'h1' }],
    gitStatus: { branch: 'main', lastCommit: 'abc', dirty: false },
    memoryEntries: [{
      path: '.peaks/memory/x.md', title: 'x',
      relevanceScore: 0.8, excerptHash: 'h2',
    }],
    deps: { antd: { version: '5.21.0', source: 'package.json', resolved: '' } },
  };
}

function makeRetriever(): DocRetrieverOutput {
  return {
    fetchedDocs: [{
      dep: 'antd', version: '5.21.0', source: 'remote-fetch',
      fetchedAt: new Date().toISOString(), contentHash: 'h3',
      sections: [{ title: 'API', tokenEstimate: 100, excerpt: 'Form.Item' }],
      stale: false,
    }],
    skipped: [],
  };
}

describe('tokenize', () => {
  it('produces metadata items for each collector + retriever artifact', () => {
    const meta = tokenize(makeCollector(), makeRetriever());
    expect(meta.metadata.length).toBeGreaterThanOrEqual(2);
    expect(meta.metadata).toContainEqual(expect.objectContaining({ kind: 'doc', version: '5.21.0' }));
    expect(meta.metadata).toContainEqual(expect.objectContaining({ kind: 'memory' }));
  });

  it('assigns conflictScore=0 when sources agree', () => {
    const meta = tokenize(makeCollector(), makeRetriever());
    const doc = meta.metadata.find((m) => m.kind === 'doc');
    expect(doc?.conflictScore).toBe(0);
  });

  it('assigns timeDecayScore near 1 for fresh fetches', () => {
    const meta = tokenize(makeCollector(), makeRetriever());
    const doc = meta.metadata.find((m) => m.kind === 'doc');
    expect(doc?.timeDecayScore).toBeGreaterThan(0.9);
  });

  it('is immutable — returns frozen output (no caller mutation)', () => {
    const meta = tokenize(makeCollector(), makeRetriever());
    expect(() => {
      (meta.metadata as unknown as { push: (x: unknown) => void }).push({ id: 'evil' });
    }).toThrow();
  });
});