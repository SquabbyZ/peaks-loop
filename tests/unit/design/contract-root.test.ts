import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { resolveContractRoot } from '../../../src/services/design/contract-root.js';

declareDimensions('tests/unit/design/contract-root.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

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

describe('Scenario: behavior — the contract root is the frontend app root', () => {
  it('when the frontend is at the repo root, should return the root design dir', async () => {
    // given: a root package.json with React and a src entry
    const root = makeRoot();
    writeJson(join(root, 'package.json'), { dependencies: { react: '19.0.0' } });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
    // when: the root is resolved
    const result = await resolveContractRoot({ projectRoot: root });
    // then: the design dir is at the repo root
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('');
    expect(result.root.designRoot).toBe(join(root, 'design'));
  });

  it('when the frontend lives under web/, should return web/design and not the repo root', async () => {
    // given: a Go root and a web/ React app
    const root = makeRoot();
    writeFileSync(join(root, 'go.mod'), 'module example.com/app\n', 'utf8');
    writeJson(join(root, 'web', 'package.json'), { dependencies: { react: '19.0.0' } });
    mkdirSync(join(root, 'web', 'src'), { recursive: true });
    writeFileSync(join(root, 'web', 'src', 'main.tsx'), 'export {}', 'utf8');
    // when: the root is resolved
    const result = await resolveContractRoot({ projectRoot: root });
    // then: the app root is web/, never the Go root
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('web');
    expect(result.root.designRoot).toBe(join(root, 'web', 'design'));
  });

  it('when two apps exist without --app, should refuse as ambiguous', async () => {
    // given: two frontend apps
    const root = makeRoot();
    for (const app of ['apps/a', 'apps/b']) {
      writeJson(join(root, app, 'package.json'), { dependencies: { react: '19.0.0' } });
      mkdirSync(join(root, app, 'src'), { recursive: true });
      writeFileSync(join(root, app, 'src', 'main.tsx'), 'export {}', 'utf8');
    }
    // when: no --app is supplied
    const result = await resolveContractRoot({ projectRoot: root });
    // then: the command refuses instead of guessing
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DESIGN_APP_AMBIGUOUS');
    expect(result.candidates).toEqual(['apps/a', 'apps/b']);
  });

  it('when --app names one of two apps, should select it', async () => {
    // given: two frontend apps
    const root = makeRoot();
    for (const app of ['apps/a', 'apps/b']) {
      writeJson(join(root, app, 'package.json'), { dependencies: { react: '19.0.0' } });
      mkdirSync(join(root, app, 'src'), { recursive: true });
      writeFileSync(join(root, app, 'src', 'main.tsx'), 'export {}', 'utf8');
    }
    // when: --app selects apps/a
    const result = await resolveContractRoot({ projectRoot: root, appPath: 'apps/a' });
    // then: the selected app wins
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root.appRelPath).toBe('apps/a');
  });

  it('when no frontend evidence exists, should return DESIGN_NOT_FRONTEND', async () => {
    // given: a Go-only repo
    const root = makeRoot();
    writeFileSync(join(root, 'go.mod'), 'module example.com/app\n', 'utf8');
    // when: the root is resolved
    const result = await resolveContractRoot({ projectRoot: root });
    // then: the command refuses
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DESIGN_NOT_FRONTEND');
  });
});
