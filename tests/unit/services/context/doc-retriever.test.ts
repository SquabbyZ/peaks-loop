/**
 * Per spec §4.1 Step 2 — DocRetriever.
 *
 * HARD CONSTRAINT H2: When deps.antd.version === '5.21.0',
 * DocRetriever MUST NOT return any antd doc whose version !== '5.21.0'.
 * This is the load-bearing cross-version isolation promise.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retrieveDocs } from '../../../../src/services/context/doc-retriever.js';
import type { DepInfo } from '../../../../src/services/context/types.js';

function makeFetcher(map: Record<string, { version: string; excerpt: string }>): (
  dep: string, version: string
) => Promise<{ version: string; excerpt: string } | null> {
  return async (dep, version) => {
    const key = `${dep}@${version}`;
    return map[key] ?? null;
  };
}

describe('retrieveDocs', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('returns doc whose version exactly matches locked dep version', async () => {
    const deps: Record<string, DepInfo> = {
      antd: { version: '5.21.0', source: 'package.json', resolved: '' },
    };
    const fetcher = makeFetcher({
      'antd@5.21.0': { version: '5.21.0', excerpt: 'Form.Item API' },
    });
    const result = await retrieveDocs(deps, { fetcher });
    expect(result.fetchedDocs).toHaveLength(1);
    expect(result.fetchedDocs[0]).toMatchObject({ dep: 'antd', version: '5.21.0' });
  });

  it('skips dep when no doc available at locked version (NOT a fallback to latest)', async () => {
    const deps: Record<string, DepInfo> = {
      antd: { version: '5.21.0', source: 'package.json', resolved: '' },
    };
    const fetcher = makeFetcher({}); // nothing at 5.21.0
    const result = await retrieveDocs(deps, { fetcher });
    expect(result.fetchedDocs).toHaveLength(0);
    expect(result.skipped).toContainEqual({
      dep: 'antd',
      reason: 'version_unknown',
    });
  });

  it('NEVER returns a 6.x doc when dep is locked at 5.21.0 (★ core promise)', async () => {
    const deps: Record<string, DepInfo> = {
      antd: { version: '5.21.0', source: 'package.json', resolved: '' },
    };
    const fetcher = makeFetcher({
      'antd@5.21.0': { version: '5.21.0', excerpt: 'Form.Item' },
      'antd@6.0.0': { version: '6.0.0', excerpt: 'Form.item' },
    });
    const result = await retrieveDocs(deps, { fetcher });
    const antdDoc = result.fetchedDocs.find((d) => d.dep === 'antd');
    expect(antdDoc?.version).toBe('5.21.0');
    const allExcerpts = result.fetchedDocs
      .flatMap((d) => d.sections.map((s) => s.excerpt))
      .join(' ');
    expect(allExcerpts).not.toContain('Form.item');
    expect(allExcerpts).toContain('Form.Item');
  });

  it('records network_error when fetcher throws', async () => {
    const deps: Record<string, DepInfo> = {
      axios: { version: '1.7.7', source: 'package.json', resolved: '' },
    };
    const fetcher = async () => { throw new Error('ECONNREFUSED'); };
    const result = await retrieveDocs(deps, { fetcher });
    expect(result.fetchedDocs).toHaveLength(0);
    expect(result.skipped).toContainEqual({
      dep: 'axios',
      reason: 'network_error',
    });
  });
});
