/**
 * `src/services/context/collector.ts` — the file-kind classifier, exercised
 * through its public entry (`collectContext`) against a real directory tree.
 *
 * The defect this file pins: the walk computes `rel` normalised to `/` and then
 * hands `classifyKind` the UN-normalised `relative(root, full)`. On win32 that
 * value is `\`-separated, `classifyKind` tests `path.includes('/__tests__/')`,
 * and so a nested test directory is kinded `source` on the one platform where
 * the branch exists to fire. The case is therefore red on win32 and green on
 * posix before the fix — `relative()` already returns `/` on posix — which is
 * why the assertion is written on the thing that is true on both: a file whose
 * collected `path` reads `src/__tests__/…` is a test file, and its kind must
 * agree with its path.
 *
 * Dimensions: behavior (path shape -> kind), integration (the real fs walk and
 * the `package.json` boundary), render (the `CollectedFile` shape). `a11y` is
 * omitted: this module emits no human-facing message, only a data envelope.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { collectContext } from '../../../../src/services/context/collector.js';

const roots: string[] = [];

/** A project the collector accepts: a `package.json` with a non-empty dep set. */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-context-collector-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'fixture', dependencies: { zod: '4.4.3' } }, null, 2)}\n`,
    'utf8'
  );
  return root;
}

function put(root: string, relPath: string, body = 'export const x = 1;\n'): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf8');
}

async function kindByPath(root: string): Promise<Map<string, string>> {
  const result = await collectContext({ goal: 'g', project: root, depsMode: 'locked' });
  return new Map(result.collector.files.map((file) => [file.path, file.kind]));
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe('Scenario: collector — behavior, a path segment decides the file kind', () => {
  it('when a source file sits under a nested __tests__ directory, should kind it test', async () => {
    // given: the shape whose branch exists to fire — a NESTED test directory
    const root = makeProject();
    put(root, join('src', '__tests__', 'nested-case.ts'));

    // when:  the tree is walked
    const kinds = await kindByPath(root);

    // then:  the file is a test file — the key below is its collected `path`, which
    //        carries a `__tests__` segment, and the kind must agree with that path on
    //        every platform (the key is not a repository path: the fixture is written
    //        into a scratch tree at run time)
    expect(kinds.get('src/__tests__/nested-case.ts')).toBe('test');
  });

  it('when a source file is outside any test directory, should keep kinding it source', async () => {
    // given: an ordinary source file — the control arm the change must not move
    const root = makeProject();
    put(root, join('src', 'services', 'plain-service.ts'));

    // when:  the tree is walked
    const kinds = await kindByPath(root);

    // then:  unchanged
    expect(kinds.get('src/services/plain-service.ts')).toBe('source');
  });

  it('when the filename carries the .test.ts convention, should kind it test', async () => {
    // given: the filename arm of the classifier, outside any test directory
    const root = makeProject();
    put(root, join('src', 'thing.test.ts'));

    // when:  the tree is walked
    const kinds = await kindByPath(root);

    // then:  test, as before
    expect(kinds.get('src/thing.test.ts')).toBe('test');
  });

  it('when a file is markdown, should kind it doc', async () => {
    // given: a doc file
    const root = makeProject();
    put(root, 'NOTES.md', '# notes\n');

    // when:  the tree is walked
    const kinds = await kindByPath(root);

    // then:  doc, as before
    expect(kinds.get('NOTES.md')).toBe('doc');
  });
});

describe('Scenario: collector — render, the collected path and its kind describe one file', () => {
  it('when a file below the root is collected, should report a /-separated relative path', async () => {
    // given: a nested file
    const root = makeProject();
    put(root, join('src', '__tests__', 'nested-case.ts'));

    // when:  the tree is walked
    const result = await collectContext({ goal: 'g', project: root, depsMode: 'locked' });

    // then:  `path` is the normalised value the walk already computed, with no
    //        native separator anywhere in it — the same value the kind must read
    const file = result.collector.files.find((f) => f.path.endsWith('nested-case.ts'));
    expect(file?.path).toBe('src/__tests__/nested-case.ts');
    expect(file?.path).not.toContain('\\');
  });
});

describe('Scenario: collector — integration, the walk skips what it must not read', () => {
  it('when a node_modules tree is present, should not collect from it', async () => {
    // given: a dependency directory the walk refuses
    const root = makeProject();
    put(root, join('node_modules', 'dep', 'index.ts'));
    put(root, join('src', 'kept.ts'));

    // when:  the tree is walked
    const kinds = await kindByPath(root);

    // then:  only the source file is collected
    expect(kinds.has('src/kept.ts')).toBe(true);
    expect([...kinds.keys()].some((path) => path.startsWith('node_modules/'))).toBe(false);
  });

  it('when the project has no package.json, should refuse rather than report empty deps', async () => {
    // given: a directory that is not a project
    const root = mkdtempSync(join(tmpdir(), 'peaks-context-collector-'));
    roots.push(root);

    // when:  collection is attempted
    const attempt = collectContext({ goal: 'g', project: root, depsMode: 'locked' });

    // then:  refused, per spec §4.1 H2
    await expect(attempt).rejects.toThrow(/no package\.json/i);
  });
});
