import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { initDesignContract } from '../../../src/services/design/design-init.js';
import {
  checkDesignSourceOnly,
  exitCodeForVerdict
} from '../../../src/services/design/design-check.js';

declareDimensions('tests/unit/design/design-check.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-check-'));
  roots.push(root);
  mkdirSync(join(root, 'src', 'styles'), { recursive: true });
  mkdirSync(join(root, 'src', 'routes'), { recursive: true });
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
  writeFileSync(join(root, 'src', 'routes', 'a.tsx'), 'export const A = () => <div />;\n', 'utf8');
  return root;
}

describe('Scenario: behavior — the verdict matrix', () => {
  it('when the project has no contract, should return not-adopted', async () => {
    // given: an app without design/
    // when: check runs
    // then: it is not adopted
    const root = makeApp();
    const result = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['src/routes/a.tsx']
    });
    expect(result.verdict).toBe('not-adopted');
  });

  it('when the change set is empty, should block rather than pass', async () => {
    // given: an adopted app with no changed files
    // when: check runs with an empty set
    // then: it is blocked
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const result = await checkDesignSourceOnly({ projectRoot: root, changedFiles: [] });
    expect(result.verdict).toBe('blocked');
    expect(result.errorCode).toBe('DESIGN_CHANGE_SET_UNKNOWN');
  });

  it('when the change is not UI, should be not-applicable', async () => {
    // given: an adopted app with a README change
    // when: check runs on a non-UI file
    // then: it does not apply
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const result = await checkDesignSourceOnly({ projectRoot: root, changedFiles: ['README.md'] });
    expect(result.verdict).toBe('not-applicable');
  });

  it('when a UI change is clean and source-only is accepted, should pass', async () => {
    // given: an adopted app with a clean page
    // when: check runs with an explicit acceptance
    // then: it passes and records the acceptance
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const result = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      allowSourceOnly: true,
      acceptNote: 'I accept source-only for this pilot'
    });
    expect(result.verdict).toBe('pass');
    expect(result.checks.g2_render).toEqual({ status: 'skipped', reason: 'explicitly-accepted' });
  });

  it('when a UI change is dirty and source-only is accepted, should fail', async () => {
    // given: an adopted app with an inline style
    // when: check runs with an acceptance
    // then: it fails on the finding
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    writeFileSync(
      join(root, 'src', 'routes', 'a.tsx'),
      "export const A = () => <div style={{ color: 'red' }} />;\n",
      'utf8'
    );
    const result = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['src/routes/a.tsx'],
      allowSourceOnly: true,
      acceptNote: 'I accept source-only for this pilot'
    });
    expect(result.verdict).toBe('fail');
    expect(exitCodeForVerdict(result.verdict)).toBe(1);
  });

  it('when source-only is not accepted, should block instead of claiming a render pass', async () => {
    // given: an adopted app with a clean page
    // when: check runs without the acceptance
    // then: it blocks because S1 cannot run G2
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const result = await checkDesignSourceOnly({
      projectRoot: root,
      changedFiles: ['src/routes/a.tsx']
    });
    expect(result.verdict).toBe('blocked');
    expect(result.errorCode).toBe('DESIGN_RENDER_NOT_IMPLEMENTED');
  });
});
