import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/design/source-scan-exclude.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

import { EXCLUDED_MESSAGE } from '../../../src/services/design/acceptance.js';
import { initDesignContract } from '../../../src/services/design/design-init.js';
import { appFiles, isExcluded } from '../../../src/services/design/source-scan/inputs.js';
import type * as DesignCheckModuleTypes from '../../../src/services/design/design-check.js';

/** Re-imported per test so the module-level message table initialises inside it. */
async function loadDesignCheck(): Promise<typeof DesignCheckModuleTypes> {
  vi.resetModules();
  return import('../../../src/services/design/design-check.js');
}

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

const DIRTY_PAGE = "export const A = () => <div style={{ color: 'red' }} />;\n";
const CLEAN_PAGE = 'export const A = () => <section />;\n';

/** An adopted-shape React app with one clean route and one dirty legacy route. */
function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-exclude-'));
  roots.push(root);
  mkdirSync(join(root, 'src', 'styles'), { recursive: true });
  mkdirSync(join(root, 'src', 'routes', 'legacy'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { react: '19.0.0', tailwindcss: '4.3.2' } }),
    'utf8'
  );
  writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
  writeFileSync(
    join(root, 'src', 'styles', 'theme.css'),
    '@theme { --color-primary: #0f62fe; }\n',
    'utf8'
  );
  writeFileSync(join(root, 'src', 'routes', 'a.tsx'), CLEAN_PAGE, 'utf8');
  writeFileSync(join(root, 'src', 'routes', 'legacy', 'old.tsx'), DIRTY_PAGE, 'utf8');
  return root;
}

describe('Scenario: behavior — the exclude filter is a path prefix check', () => {
  it('when an entry names a directory, should exclude it and only it', () => {
    // given: an exclude entry with a trailing slash and a lookalike sibling
    // when: each app path is tested and the change set is filtered
    // then: the subtree is excluded, the lookalike and the parent are not
    expect(isExcluded('src/legacy/old.tsx', ['src/legacy/'])).toBe(true);
    expect(isExcluded('src/legacy', ['./src/legacy'])).toBe(true);
    expect(isExcluded('src/legacyish/old.tsx', ['src/legacy'])).toBe(false);
    expect(isExcluded('src/legacy/old.tsx', [''])).toBe(false);
    expect(appFiles('/app', '', ['src/a.tsx', 'src/legacy/old.tsx'], ['src/legacy'])).toEqual([
      'src/a.tsx'
    ]);
  });

  it('when entries use Windows or app-relative spellings, should still exclude', () => {
    // given: backslash, leading ./, and repo-relative exclude entries
    // when: each is matched against the translated change set
    // then: every spelling removes the same subtree
    expect(isExcluded('src/gen/a.tsx', ['src\\gen'])).toBe(true);
    expect(isExcluded('src/gen/a.tsx', ['.\\src\\gen'])).toBe(true);
    expect(isExcluded('src/gen/a.tsx', ['./src/gen/'])).toBe(true);
    expect(appFiles('/app', 'web', ['web/src/gen/a.tsx'], ['web/src/gen'])).toEqual([]);
    expect(appFiles('/app', 'web', ['web/src/gen/a.tsx'], ['src/gen'])).toEqual([]);
    expect(appFiles('/app', 'web', ['web/src/routes/a.tsx'], ['web/src/gen'])).toEqual([
      'src/routes/a.tsx'
    ]);
  });
});

describe('Scenario: integration — the scanner skips excluded changed files', () => {
  it('when every changed file is excluded, should report not-applicable', async () => {
    // given: an app whose legacy route is excluded at init
    // when: only that legacy file changed
    // then: there is nothing to judge and the result is not-applicable, not a block
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const root = makeApp();
    await initDesignContract({ projectRoot: root, exclude: ['src/routes/legacy'] });
    const result = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['src/routes/legacy/old.tsx']
    });
    expect(result.verdict).toBe('not-applicable');
    expect(result.message).toBe(EXCLUDED_MESSAGE);
  });

  it('when an excluded dirty file changes with a clean page, should scan only the page', async () => {
    // given: the same app, with the dirty legacy route and a clean page changed
    // when: the check runs with and without the exclusion
    // then: the excluded file never produces a finding or fails the verdict
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const changed = ['src/routes/legacy/old.tsx', 'src/routes/a.tsx'];
    const unfiltered = await checkDesignSourceOnly({ projectRoot: root, changedFiles: changed });
    expect(unfiltered.verdict).toBe('fail');
    expect(unfiltered.findings.some((finding) => finding.file.includes('legacy'))).toBe(true);

    await initDesignContract({ projectRoot: root, exclude: ['src/routes/legacy'], force: true });
    const filtered = await checkDesignSourceOnly({ projectRoot: root, changedFiles: changed });
    expect(filtered.findings.some((finding) => finding.file.includes('legacy'))).toBe(false);
    expect(filtered.verdict).not.toBe('fail');
  });
});
