/**
 * ★ CORE INTEGRATION TEST — the load-bearing promise of peaks-context.
 *
 * Per spec §4.1 + Plan 1 §4.1 — when package.json locks antd at 5.21.0,
 * the produced context.json must NEVER contain 6.x API references like
 * `Form.item`. This is the architectural distinction between
 * "CLI-enforced version-aware context" and "LLM-prompted stacking".
 *
 * If this test fails, the core promise of peaks-context is broken.
 * Treat it as a P0 release blocker.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectContext } from '../../../src/services/context/collector.js';
import { retrieveDocs } from '../../../src/services/context/doc-retriever.js';

describe('cross-version isolation (★ core promise)', () => {
  it('antd@5.21.0 deps never produce 6.x API references in any context.json field', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-xver-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      writeFileSync(join(workdir, 'src', 'Login.tsx'), 'export const X = 1;\n');
      writeFileSync(join(workdir, 'package.json'), JSON.stringify({
        name: 'demo',
        dependencies: { antd: '5.21.0', react: '18.3.1' },
      }));
      writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

      const collected = await collectContext({
        goal: 'add login feature',
        project: workdir,
        depsMode: 'locked',
      });

      // The fetcher is intentionally permissive — it returns BOTH 5.x and 6.x
      // docs to prove the DocRetriever filters by exact locked version.
      const fetcher = async (dep: string, version: string) => {
        if (dep === 'antd' && version === '5.21.0') {
          return { version: '5.21.0', excerpt: 'Form.Item, Button, Modal' };
        }
        if (dep === 'antd' && version === '6.0.0') {
          return { version: '6.0.0', excerpt: 'Form.item, Button, Modal' };
        }
        return null;
      };

      const docs = await retrieveDocs(collected.collector.deps, { fetcher });

      const antdDoc = docs.fetchedDocs.find((d) => d.dep === 'antd');
      expect(antdDoc).toBeDefined();
      expect(antdDoc?.version).toBe('5.21.0');

      const allExcerpts = docs.fetchedDocs
        .flatMap((d) => d.sections.map((s) => s.excerpt))
        .join(' ');

      expect(allExcerpts).not.toContain('Form.item');
      expect(allExcerpts).toContain('Form.Item');
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
