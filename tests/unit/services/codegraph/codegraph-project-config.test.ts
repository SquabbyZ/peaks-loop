// tests/unit/services/codegraph/codegraph-project-config.test.ts
//
// Unit test for `src/services/codegraph/codegraph-project-config.ts` — ONE
// answer to "which file holds this project's codegraph config, and what does
// its `include` list mean".
//
// WHY THIS FILE EXISTS. Before the 1.6.2 upgrade every codegraph reader and
// writer spelled `.codegraph/config.json`, and the module that replaced that
// constant decides TWO things at once — the path and the admission semantics —
// by PROBING the installed upstream rather than by reading a version string.
// A probe is only trustworthy if both of its answers are pinned, so the
// positive case (the real 1.6.2 install) and the negative case (a directory
// that has no `project-config.js`) are both asserted here.
//
// Dimensions covered:
//   - behavior:    the model/candidate/path resolution, both arms
//   - integration: the REAL installed @colbymchenry/codegraph, resolved through
//                  the same shared layout module the spawn path uses
//   - render:      OMITTED — this module produces no operator-facing text
//   - a11y:        OMITTED — it is a resolver, not a surface

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CODEGRAPH_DIR_CONFIG_FILENAME,
  CODEGRAPH_PROJECT_CONFIG_FILENAME,
  codegraphConfigModelFor,
  codegraphConfigPathFor,
  codegraphConfigSourceFor,
  resolveCodegraphConfigSource
} from '~/src/services/codegraph/codegraph-project-config';
import { resolveCodegraphUpstreamLayout } from '~/src/services/codegraph/codegraph-upstream-layout';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/codegraph/codegraph-project-config.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the module produces no operator-facing text' },
    { dim: 'a11y', reason: 'it is a path/model resolver, not a surface' }
  ]
);

const cleanups: string[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    rmSync(cleanups.pop() as string, { recursive: true, force: true });
  }
});

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-cg-cfg-'));
  cleanups.push(root);

  return root;
}

// ── behavior: the two model arms, driven by upstream's own module layout ──

describe('codegraphConfigModelFor (the probe)', () => {
  it('should report force-include when the directory ships upstream project-config module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'peaks-cg-mod-'));
    cleanups.push(dir);
    writeFileSync(join(dir, 'project-config.js'), 'exports.PROJECT_CONFIG_FILENAME = "x";\n');

    expect(codegraphConfigModelFor(dir)).toBe('force-include');
  });

  it('should report include-whitelist when the directory has no project-config module', () => {
    const dir = mkdtempSync(join(tmpdir(), 'peaks-cg-mod-'));
    cleanups.push(dir);

    expect(codegraphConfigModelFor(dir)).toBe('include-whitelist');
  });

  it('should refuse to answer for an EMPTY module directory instead of probing the cwd', () => {
    // The trap this guard closes: `join('', 'project-config.js')` is the
    // RELATIVE path `project-config.js`, so answering would depend on the
    // process's working directory rather than on upstream.
    expect(codegraphConfigModelFor('')).toBeNull();
  });
});

// ── behavior: the path each model reads ────────────────────────────────

describe('codegraphConfigPathFor', () => {
  it('should place the config at the project root under force-include', () => {
    expect(codegraphConfigPathFor('/proj', 'force-include')).toBe(
      join('/proj', CODEGRAPH_PROJECT_CONFIG_FILENAME)
    );
  });

  it('should place the config inside .codegraph under include-whitelist', () => {
    expect(codegraphConfigPathFor('/proj', 'include-whitelist')).toBe(
      join('/proj', '.codegraph', CODEGRAPH_DIR_CONFIG_FILENAME)
    );
  });

  it('should report presence and the model together, so neither can be read apart', () => {
    const root = makeProject();

    const absent = codegraphConfigSourceFor(root, 'force-include');
    expect(absent.present).toBe(false);

    writeFileSync(join(root, CODEGRAPH_PROJECT_CONFIG_FILENAME), '{}\n', 'utf8');

    const present = codegraphConfigSourceFor(root, 'force-include');
    expect(present.present).toBe(true);
    expect(present.model).toBe('force-include');
    expect(present.configPath).toBe(join(root, CODEGRAPH_PROJECT_CONFIG_FILENAME));
  });
});

// ── integration: the real installed upstream ───────────────────────────

describe('resolveCodegraphConfigSource (real @colbymchenry/codegraph)', () => {
  it('should resolve the 1.6.x model and the project-root path for the real install', () => {
    const root = makeProject();
    const source = resolveCodegraphConfigSource(root);

    // Pinned to the CAUSE, not only the effect: the model comes from the
    // module the shared layout resolver points at, so a future release that
    // moves that module is caught here rather than surfacing as a wrong
    // verdict about some project's config.
    const { moduleDir } = resolveCodegraphUpstreamLayout();

    expect(codegraphConfigModelFor(moduleDir)).toBe('force-include');
    expect(source.model).toBe('force-include');
    expect(source.configPath).toBe(join(root, CODEGRAPH_PROJECT_CONFIG_FILENAME));
  });

  it('should NOT look for the legacy path, which this upstream never reads', () => {
    // The pre-upgrade constant. A legacy `<root>/.codegraph/config.json` is
    // still not the answer: 1.6.x never opens it, so treating it as the
    // source would reconcile a project against a file upstream ignores.
    const root = makeProject();
    mkdirSync(join(root, '.codegraph'), { recursive: true });
    writeFileSync(join(root, '.codegraph', CODEGRAPH_DIR_CONFIG_FILENAME), '{}\n', 'utf8');

    const source = resolveCodegraphConfigSource(root);

    expect(source.configPath).not.toContain(CODEGRAPH_DIR_CONFIG_FILENAME);
    expect(source.present).toBe(false);
  });
});
