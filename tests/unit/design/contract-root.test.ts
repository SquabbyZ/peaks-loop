import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import type { ContractRootResult } from '../../../src/services/design/design-types.js';

declareDimensions('tests/unit/design/contract-root.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

/**
 * Imported per test after a module reset so the module-level `SKIP_DIR_NAMES` /
 * `WORKSPACE_DIR_NAMES` initialisers run INSIDE a test. Under Stryker's
 * per-test coverage a module-scope initialiser executes before any test, so a
 * mutant in it is never scheduled and reads as survived although no test ran.
 */
import type * as ContractRootModuleTypes from '../../../src/services/design/contract-root.js';
type ContractRootModule = typeof ContractRootModuleTypes;

async function loadContractRoot(): Promise<ContractRootModule> {
  vi.resetModules();
  return import('../../../src/services/design/contract-root.js');
}

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-root-'));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

/** A minimal React app at `dir`: a manifest plus a source entry. */
function writeFrontendApp(root: string, dir: string): void {
  writeJson(join(root, dir, 'package.json'), { dependencies: { react: '19.0.0' } });
  mkdirSync(join(root, dir, 'src'), { recursive: true });
  writeFileSync(join(root, dir, 'src', 'main.tsx'), 'export {}', 'utf8');
}

describe('Scenario: behavior — the contract root is the frontend app root', () => {
  it('when the frontend is at the repo root, should return the root design dir', async () => {
    // given: a root package.json with React and a src entry
    // when: the root is resolved
    // then: the design dir is at the repo root
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    writeFrontendApp(root, '');
    const result = await resolveContractRoot({ projectRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('');
    expect(result.root.designRoot).toBe(join(root, 'design'));
  });

  it('when the frontend lives under web/, should return web/design and not the repo root', async () => {
    // given: a Go root and a web/ React app
    // when: the root is resolved
    // then: the app root is web/, never the Go root
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    writeFileSync(join(root, 'go.mod'), 'module example.com/app\n', 'utf8');
    writeFrontendApp(root, 'web');
    const result = await resolveContractRoot({ projectRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('web');
    expect(result.root.designRoot).toBe(join(root, 'web', 'design'));
  });

  it('when two apps exist without --app, should refuse as ambiguous', async () => {
    // given: two frontend apps created out of alphabetical order
    // when: no --app is supplied
    // then: the command refuses and lists candidates in sorted order
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    for (const app of ['apps/z', 'apps/a']) writeFrontendApp(root, app);
    const result = await resolveContractRoot({ projectRoot: root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DESIGN_APP_AMBIGUOUS');
    expect(result.candidates).toEqual(['apps/a', 'apps/z']);
    expect(result.message).toBe(
      'More than one frontend app root was found (apps/a, apps/z); name one with --app.'
    );
  });

  it('when --app names one of two apps, should select it', async () => {
    // given: two frontend apps
    // when: --app selects apps/a
    // then: the selected app wins
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    for (const app of ['apps/a', 'apps/b']) writeFrontendApp(root, app);
    const result = await resolveContractRoot({ projectRoot: root, appPath: 'apps/a' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('apps/a');
  });

  it('when --app is spelled with a leading ./ or /, should normalize it', async () => {
    // given: two frontend apps
    // when: --app carries empty or dot path segments
    // then: the segment filter makes both spellings name apps/a
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    for (const app of ['apps/a', 'apps/b']) writeFrontendApp(root, app);
    for (const appPath of ['./apps/a', '/apps/a', 'apps//a', 'apps/./a']) {
      const result = await resolveContractRoot({ projectRoot: root, appPath });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.root.appRelPath).toBe('apps/a');
    }
  });

  it('when --app escapes the repository, should refuse it', async () => {
    // given: an app named by a path that climbs out of the root
    // when: --app carries a .. segment
    // then: no candidate can match and the command refuses
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    writeFrontendApp(root, 'apps/a');
    const result = await resolveContractRoot({ projectRoot: root, appPath: 'apps/../apps/a' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DESIGN_APP_NOT_FOUND');
    expect(result.candidates).toEqual(['apps/a']);
  });

  it('when --app names no frontend app, should refuse and name the candidates', async () => {
    // given: one frontend app and a name that matches none
    // when: --app is supplied
    // then: the refusal names the app that could have been chosen
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    writeFrontendApp(root, 'apps/a');
    const result = await resolveContractRoot({ projectRoot: root, appPath: 'apps/b' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DESIGN_APP_NOT_FOUND');
    expect(result.candidates).toEqual(['apps/a']);
    expect(result.message).toBe(
      "--app 'apps/b' does not name a frontend app root in this repository."
    );
  });

  it('when no frontend evidence exists, should return DESIGN_NOT_FRONTEND', async () => {
    // given: a Go-only repo
    // when: the root is resolved
    // then: the command refuses
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    writeFileSync(join(root, 'go.mod'), 'module example.com/app\n', 'utf8');
    const result = await resolveContractRoot({ projectRoot: root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DESIGN_NOT_FRONTEND');
    expect(result.message).toBe(
      'No frontend app root was found; the design contract applies to frontend projects only.'
    );
  });
});

describe('Scenario: integration — only manifest-bearing application dirs are candidates', () => {
  it('when an installed or generated dir holds a manifest, should not propose it', async () => {
    // given: six skipped dir names, each shaped like a frontend app, plus the real one
    // when: the root is resolved
    // then: none of them is a candidate and the root app wins
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    writeFrontendApp(root, '');
    for (const name of ['node_modules', '.git', 'dist', 'build', 'out', 'coverage']) {
      writeFrontendApp(root, name);
    }
    const result = await resolveContractRoot({ projectRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('');
  });

  it('when a root child and a workspace app are both frontend, should list apps sorted', async () => {
    // given: web/ at the repo root and apps/a under the workspace container
    // when: no --app is supplied
    // then: candidates are sorted by relative path, not by discovery order
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    writeFrontendApp(root, 'web');
    writeFrontendApp(root, 'apps/a');
    const result = await resolveContractRoot({ projectRoot: root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DESIGN_APP_AMBIGUOUS');
    expect(result.candidates).toEqual(['apps/a', 'web']);
  });

  it('when a dir has frontend assets but no manifest, should not propose it', async () => {
    // given: web/src/style.css with no package.json anywhere
    // when: the root is resolved
    // then: a manifest is required and the repo is not a frontend project
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    mkdirSync(join(root, 'web', 'src'), { recursive: true });
    writeFileSync(join(root, 'web', 'src', 'style.css'), '.a { color: red; }\n', 'utf8');
    const result = await resolveContractRoot({ projectRoot: root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DESIGN_NOT_FRONTEND');
  });

  it('when a workspace app has frontend assets but no manifest, should not propose it', async () => {
    // given: apps/web/src/style.css with no package.json anywhere
    // when: the root is resolved
    // then: the workspace scan requires a manifest too
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    mkdirSync(join(root, 'apps', 'web', 'src'), { recursive: true });
    writeFileSync(join(root, 'apps', 'web', 'src', 'style.css'), '.a { color: red; }\n', 'utf8');
    const result = await resolveContractRoot({ projectRoot: root });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DESIGN_NOT_FRONTEND');
  });

  it('when a frontend app also has backend evidence, should still count as frontend', async () => {
    // given: one app with React and Express
    // when: the root is resolved
    // then: declared frontend evidence alone qualifies it, backend aside
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    writeJson(join(root, 'package.json'), {
      dependencies: { react: '19.0.0', express: '4.19.0' }
    });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
    const result = await resolveContractRoot({ projectRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('');
  });
});

describe('Scenario: behavior — an --app match is exactly one app root', () => {
  it('when --app names a dir that is a prefix of another, should match only the exact app', async () => {
    // given: apps/a and apps/ab are both frontend apps
    // when: --app names apps/a
    // then: the match is exact, not a prefix of apps/ab
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    for (const app of ['apps/a', 'apps/ab']) writeFrontendApp(root, app);
    const result = await resolveContractRoot({ projectRoot: root, appPath: 'apps/a' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('apps/a');
  });

  it('when --app names an app the resolver never found, should return no root', async () => {
    // given: a frontend app and a spelling that only matches a file, not a dir
    // when: --app names the file
    // then: it is not one of the discovered app roots
    const { resolveContractRoot } = await loadContractRoot();
    const root = makeRoot();
    writeFrontendApp(root, 'apps/a');
    writeFileSync(join(root, 'not-an-app.tsx'), 'export {}', 'utf8');
    const result: ContractRootResult = await resolveContractRoot({
      projectRoot: root,
      appPath: 'not-an-app.tsx'
    });
    expect(result.ok).toBe(false);
  });
});
