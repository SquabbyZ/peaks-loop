import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  initDesignContract,
  readDesignStatus,
  removeDesignContract
} from '../../../src/services/design/design-init.js';
import type { PavedRoadFile } from '../../../src/services/design/paved-road.js';
import type { DesignTokensFile } from '../../../src/services/design/token-contract.js';

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

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

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
      readJsonFile<DesignTokensFile>(join(root, 'design', 'tokens.json')).color['color-primary']
        ?.$value
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

  it('when refresh runs, should rewrite only engine.json and preserve the rest', async () => {
    // given: an initialized project with user prose and an edited engine file
    // when: refresh runs
    // then: only engine.json is written and the other contract files are preserved
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    writeFileSync(join(root, 'design', 'contract.md'), '# user prose\n', 'utf8');
    writeFileSync(join(root, 'design', 'engine.json'), '{"edited":true}\n', 'utf8');
    const result = await initDesignContract({ projectRoot: root, refresh: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.written).toEqual([join('design', 'engine.json')]);
    expect(result.preserved).toEqual(
      expect.arrayContaining([
        join('design', 'tokens.json'),
        join('design', 'paved-road.json'),
        join('design', 'contract.md')
      ])
    );
    expect(readJsonFile<Record<string, unknown>>(join(root, 'design', 'engine.json')).edited).toBe(
      undefined
    );
    expect(readFileSync(join(root, 'design', 'contract.md'), 'utf8')).toBe('# user prose\n');
  });

  it('when a start command is recorded, should mark the policy on-request', async () => {
    // given: one app initialized with a dev-server command and one without
    // when: each engine.json is read
    // then: only the recorded command records startPolicy on-request
    const withStart = makeApp();
    await initDesignContract({ projectRoot: withStart, startCommand: 'npm run dev' });
    const started = readJsonFile<{ render: { startPolicy: string } }>(
      join(withStart, 'design', 'engine.json')
    );
    expect(started.render.startPolicy).toBe('on-request');
    const without = makeApp();
    await initDesignContract({ projectRoot: without });
    const idle = readJsonFile<{ render: { startPolicy: string } }>(
      join(without, 'design', 'engine.json')
    );
    expect(idle.render.startPolicy).toBe('never');
  });

  it('when --force reruns, should preserve the paved-road user overrides', async () => {
    // given: an initialized project whose paved road was customized by the user
    // when: init runs again with force
    // then: every override survives and untouched keys keep their defaults
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const pavedPath = join(root, 'design', 'paved-road.json');
    const saved = readJsonFile<PavedRoadFile>(pavedPath);
    saved.pageRoots = ['app'];
    saved.componentEntrypoints = ['@/components'];
    saved.banned = { inlineStyle: false, rawHex: true, arbitraryTailwind: true };
    saved.rules = { ...saved.rules, DESIGN_RAW_COLOR: 'warn' };
    saved.tokenScale.space = ['4', '8'];
    writeFileSync(pavedPath, JSON.stringify(saved, null, 2), 'utf8');
    await initDesignContract({ projectRoot: root, force: true });
    const next = readJsonFile<PavedRoadFile>(pavedPath);
    expect(next.pageRoots).toEqual(['app']);
    expect(next.componentEntrypoints).toEqual(['@/components']);
    expect(next.banned.inlineStyle).toBe(false);
    expect(next.rules.DESIGN_RAW_COLOR).toBe('warn');
    expect(next.tokenScale.space).toEqual(['4', '8']);
    expect(next.banned.arbitraryTailwind).toBe(true);
  });

  it('when init runs, should write the exemplar redaction rule once', async () => {
    // given: a fresh app
    // when: init runs twice and the user edits the README in between
    // then: the rule exists and the user edit is not overwritten
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const readmePath = join(root, 'design', 'exemplars', 'README.md');
    const readme = readFileSync(readmePath, 'utf8');
    expect(readme).toContain('redacted or synthetic');
    expect(readme).toContain('gitignored');
    writeFileSync(readmePath, '# our exemplars\n', 'utf8');
    await initDesignContract({ projectRoot: root });
    expect(readFileSync(readmePath, 'utf8')).toBe('# our exemplars\n');
  });
});

describe('Scenario: a11y — init refuses symlinked and escaping write targets', () => {
  it('when the design directory links outside the project, should refuse the write', async () => {
    // given: a design directory that is a link to a directory outside the root
    // when: init runs
    // then: it refuses and nothing lands outside the project
    const root = makeApp();
    const outside = mkdtempSync(join(tmpdir(), 'peaks-design-init-outside-'));
    roots.push(outside);
    symlinkSync(outside, join(root, 'design'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(initDesignContract({ projectRoot: root })).rejects.toThrow(
      /outside the project root/i
    );
    expect(existsSync(join(outside, 'tokens.json'))).toBe(false);
  });

  it('when engine.json is a symlink, should refuse the refresh write', async () => {
    // given: an initialized project whose engine file is replaced by a symlink
    // when: init rewrites the machine-owned engine file
    // then: the symlinked target is refused and left untouched
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const outside = mkdtempSync(join(tmpdir(), 'peaks-design-init-outside-'));
    roots.push(outside);
    const victim = join(outside, 'engine.json');
    writeFileSync(victim, '{"keep":true}\n', 'utf8');
    const enginePath = join(root, 'design', 'engine.json');
    rmSync(enginePath);
    symlinkSync(victim, enginePath, 'file');
    await expect(initDesignContract({ projectRoot: root })).rejects.toThrow(
      /symlink|outside the project root/i
    );
    expect(readFileSync(victim, 'utf8')).toBe('{"keep":true}\n');
  });

  it('when the force backup is a symlink, should refuse the rewrite', async () => {
    // given: an initialized project whose contract backup is a symlink outside
    // when: init runs with force
    // then: the backup target is refused and its content survives
    const root = makeApp();
    await initDesignContract({ projectRoot: root });
    const outside = mkdtempSync(join(tmpdir(), 'peaks-design-init-outside-'));
    roots.push(outside);
    const victim = join(outside, 'contract.md');
    writeFileSync(victim, '# outside owns this\n', 'utf8');
    symlinkSync(victim, join(root, 'design', 'contract.md.bak'), 'file');
    await expect(initDesignContract({ projectRoot: root, force: true })).rejects.toThrow(
      /symlink|outside the project root/i
    );
    expect(readFileSync(victim, 'utf8')).toBe('# outside owns this\n');
  });
});
