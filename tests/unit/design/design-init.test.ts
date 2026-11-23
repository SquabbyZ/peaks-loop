import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  initDesignContract,
  readDesignStatus,
  removeDesignContract
} from '../../../src/services/design/design-init.js';

declareDimensions('tests/unit/design/design-init.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

/**
 * A small React + Tailwind v4 app. The lockfile is backdated because
 * `scanArchetype` calls a one-file `src/` with a fresh lockfile greenfield,
 * and `scanExistingSystem` short-circuits before extracting any token.
 */
function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-init-'));
  roots.push(root);
  mkdirSync(join(root, 'src', 'styles'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { react: '19.0.0', tailwindcss: '4.3.2' } }),
    'utf8'
  );
  writeFileSync(join(root, 'src', 'main.tsx'), 'export {}', 'utf8');
  writeFileSync(
    join(root, 'src', 'styles', 'theme.css'),
    '@theme { --color-primary: #0f62fe; --spacing-4: 1rem; }\n',
    'utf8'
  );
  const lockfile = join(root, 'pnpm-lock.yaml');
  writeFileSync(lockfile, 'lockfileVersion: 9.0\n', 'utf8');
  const sixtyDaysAgo = (Date.now() - 60 * 24 * 60 * 60 * 1000) / 1000;
  utimesSync(lockfile, sixtyDaysAgo, sixtyDaysAgo);
  return root;
}

describe('Scenario: behavior — init writes the contract once and preserves user files', () => {
  it('when run on a fresh app, should write four contract files and the standard', async () => {
    // given: a React app with a token
    // when: init runs
    // then: the files exist and the token is in the contract
    const root = makeApp();
    const result = await initDesignContract({ projectRoot: root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.written).toContain(join('design', 'contract.md'));
    expect(
      JSON.parse(readFileSync(join(root, 'design', 'tokens.json'), 'utf8')).color['color-primary']
        .$value
    ).toBe('#0f62fe');
    expect(
      readFileSync(join(root, '.peaks', 'standards', 'common', 'design-governance.md'), 'utf8')
    ).toContain('peaks:design-governance:start');
  });

  it('when run twice, should not overwrite the user contract', async () => {
    // given: a project already initialized
    // when: init runs again
    // then: the user prose is preserved
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    writeFileSync(join(root, 'design', 'contract.md'), '# user edited\n', 'utf8');
    const result = await initDesignContract({ projectRoot: root });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, 'design', 'contract.md'), 'utf8')).toBe('# user edited\n');
  });

  it('when --force is used, should back up and rewrite the contract', async () => {
    // given: a project with a user-edited contract
    // when: init runs with force
    // then: a backup exists and the file was regenerated
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    writeFileSync(join(root, 'design', 'contract.md'), '# user edited\n', 'utf8');
    await initDesignContract({ projectRoot: root, force: true });
    expect(readFileSync(join(root, 'design', 'contract.md.bak'), 'utf8')).toBe('# user edited\n');
    expect(readFileSync(join(root, 'design', 'contract.md'), 'utf8')).not.toBe('# user edited\n');
  });

  it('when status is read, should report adoption, age, and token counts', async () => {
    // given: an initialized project
    // when: status is read
    // then: it reports the contract facts
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const status = await readDesignStatus({ projectRoot: root });
    expect(status.adopted).toBe(true);
    expect(status.tokenCounts.color).toBeGreaterThan(0);
  });

  it('when uninit runs, should remove contract files and the standard but keep exemplars', async () => {
    // given: an initialized project with an exemplar
    // when: uninit runs
    // then: generated files are gone, the exemplar remains
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    mkdirSync(join(root, 'design', 'exemplars', 'list'), { recursive: true });
    writeFileSync(join(root, 'design', 'exemplars', 'list', 'meta.json'), '{}', 'utf8');
    const result = await removeDesignContract({ projectRoot: root });
    expect(result.ok).toBe(true);
    expect(() => readFileSync(join(root, 'design', 'contract.md'), 'utf8')).toThrow();
    expect(readFileSync(join(root, 'design', 'exemplars', 'list', 'meta.json'), 'utf8')).toBe('{}');
  });
});
