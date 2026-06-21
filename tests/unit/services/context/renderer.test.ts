import { describe, it, expect } from 'vitest';
import { render } from '../../../../src/services/context/renderer.js';
import type {
  CollectorOutput, DocRetrieverOutput, TokenizerOutput, Audience,
} from '../../../../src/services/context/types.js';

function fixture(audience: Audience): {
  collector: CollectorOutput;
  docRetriever: DocRetrieverOutput;
  tokenizer: TokenizerOutput;
} {
  const collector: CollectorOutput = {
    files: [],
    gitStatus: { branch: 'main', lastCommit: 'abc', dirty: false },
    memoryEntries: [],
    deps: {},
  };
  const docRetriever: DocRetrieverOutput = {
    fetchedDocs: [
      { dep: 'antd', version: '5.21.0', source: 'remote-fetch', fetchedAt: '2026-06-21T12:00:00Z', contentHash: 'h', sections: [{ title: 'API', tokenEstimate: 100, excerpt: 'Form.Item' }], stale: false },
      { dep: 'react', version: '18.3.1', source: 'remote-fetch', fetchedAt: '2026-06-21T12:00:00Z', contentHash: 'h2', sections: [{ title: 'API', tokenEstimate: 100, excerpt: 'useState' }], stale: false },
    ],
    skipped: [],
  };
  const tokenizer: TokenizerOutput = {
    metadata: [
      { id: 'doc:antd@5.21.0', kind: 'doc', version: '5.21.0', blastRadius: ['API'], conflictScore: 0, timeDecayScore: 1, tags: ['fresh'] },
      { id: 'doc:react@18.3.1', kind: 'doc', version: '18.3.1', blastRadius: ['API'], conflictScore: 0, timeDecayScore: 1, tags: ['fresh'] },
    ],
  };
  return { collector, docRetriever, tokenizer };
}

describe('render', () => {
  it('peaks-rd audience returns strategy view (goal + docs)', () => {
    const f = fixture('peaks-rd');
    const r = render({
      goal: 'add OAuth',
      audience: 'peaks-rd',
      docBudgetTokens: 8000,
      ...f,
    });
    expect(r.audience).toBe('peaks-rd');
    expect(r.sizeBytes).toBeGreaterThan(0);
    expect(r.truncated).toBe(false);
  });

  it('peaks-mut audience returns test-only view', () => {
    const f = fixture('peaks-mut');
    const r = render({
      goal: 'verify OAuth tests',
      audience: 'peaks-mut',
      docBudgetTokens: 8000,
      ...f,
    });
    expect(r.audience).toBe('peaks-mut');
  });

  it('truncates when doc budget exceeded', () => {
    const f = fixture('all');
    const r = render({
      goal: 'x',
      audience: 'all',
      docBudgetTokens: 1, // absurdly small
      ...f,
    });
    expect(r.truncated).toBe(true);
    expect(r.truncatedReason).toBe('doc_budget_exceeded');
  });

  it('is immutable', () => {
    const f = fixture('all');
    const r = render({ goal: 'x', audience: 'all', docBudgetTokens: 8000, ...f });
    expect(() => {
      (r as unknown as { sizeBytes: number }).sizeBytes = -1;
    }).toThrow();
  });
});