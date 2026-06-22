/**
 * ★ Cross-version isolation: end-to-end — Plan 1 (context) + Plan 3 (gate).
 *
 * If peaks-context produces a context.json with 5.x API summaries AND
 * the AST gate rejects LLM use of a non-locked 6.x API, the two layers
 * are aligned. This test pins that alignment.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectContext } from '../../../src/services/context/collector.js';
import { retrieveDocs } from '../../../src/services/context/doc-retriever.js';
import { runTacticalStage } from '../../../src/services/rd/tactical-stage.js';

describe('context + ast-gate alignment', () => {
  it('AST gate fails when LLM uses 6.x API in 5.x project (BOTH layers aligned)', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'peaks-rd-xver-'));
    try {
      mkdirSync(join(workdir, 'src'), { recursive: true });
      // 6.x API name (`FormV6`) — not present in 5.21.0 doc summary
      writeFileSync(join(workdir, 'src', 'Login.tsx'), `
        import { FormV6 } from 'antd';
        FormV6({ children: [] });
      `);
      writeFileSync(join(workdir, 'package.json'), JSON.stringify({
        name: 'demo', dependencies: { antd: '5.21.0' },
      }));
      writeFileSync(join(workdir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');

      const collected = await collectContext({
        goal: 'add login form', project: workdir, depsMode: 'locked',
      });
      // DocRetriever returns 5.x summary (Form, Form.Item — NOT FormV6).
      const docs = await retrieveDocs(collected.collector.deps, {
        fetcher: async (dep, version) => {
          if (dep === 'antd' && version === '5.21.0') {
            return { version: '5.21.0', excerpt: 'Form, Form.Item, Button' };
          }
          return null;
        },
      });
      const docSummaries = docs.fetchedDocs.map((d) => ({
        dep: d.dep, version: d.version,
        apis: [...new Set(d.sections.flatMap((s) => s.excerpt.split(/[\s,]+/)).filter(Boolean))],
      }));

      await expect(runTacticalStage({
        project: workdir,
        changedFiles: ['src/Login.tsx'],
        inputSig: 'a'.repeat(64),
        context: {
          deps: Object.fromEntries(
            Object.entries(collected.collector.deps).map(([k, v]) => [k, v]),
          ),
          docSummaries,
        },
        out: join(workdir, 'impl.json'),
      })).rejects.toThrow(/AST gate/);
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});
