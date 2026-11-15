// tests/unit/services/prd/project-scan-library-versions.test.ts
//
// THE DEFECT THIS LOCKS. `scanLibraries` concatenates every workspace
// `package.json` in a monorepo, so one name arrives once per declaring package
// with that package's own specifier. The map this module builds feeds the
// `libraryVersions` frontmatter that peaks-rd cross-checks against
// `schemas/library-breaking-changes.data.json`, so WHICH specifier wins decides
// whether a breaking-change hit is found:
//
//   - a workspace package pinning a LOWER major (`typescript ^5.4.0`) must not
//     displace the root's own pin (`^5.7.2`) — filing a project under a floor is
//     the wrong version to check against;
//   - a package only a workspace declares (`ecc-universal`) must not appear at
//     all — the file describes the project, not the monorepo's parts.
//
// Both were observed on this repository before the fix (2026-11-15).
//
// Dimensions covered:
//   - behavior:    which rows survive and which specifier wins
//   - integration: a real monorepo root on disk, read through the real scan
//
// Dimensions omitted:
//   - a11y / render: no user-visible text; the frontmatter rendering is covered
//     by `project-scan-field-refresh.test.ts`.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  libraryVersionsFor,
  rootDeclaredNames,
  toLibraryVersions
} from '~/src/services/prd/project-scan-library-versions';

declareDimensions(
  'tests/unit/services/prd/project-scan-library-versions.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'no user-visible text or exit code in this module' },
    { dim: 'render', reason: 'this module produces a map, not a rendered surface' }
  ]
);

const tempRoots: string[] = [];

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('(behavior) which rows survive', () => {
  it('when the root declares a name, should keep the first row and drop the rest', () => {
    // given: the same name twice, as a monorepo scan reports it
    // when: the map is built against the root's declaration
    // then: one row remains, and it is the first
    const rows = toLibraryVersions(
      [
        { name: 'typescript', version: '^5.7.2' },
        { name: 'typescript', version: '^5.4.0' }
      ],
      new Set(['typescript'])
    );

    expect(rows).toEqual({ typescript: '^5.7.2' });
  });

  it('when only a workspace declares a name, should drop it', () => {
    // given: a dependency the project itself does not declare
    // when: the map is built against the root's declaration
    // then: it is absent, because the file describes the project
    const rows = toLibraryVersions([{ name: 'ws-only', version: '^2.2.3' }], new Set());

    expect(rows).toEqual({});
  });
});

describe('(integration) the map built from a real monorepo root', () => {
  it('when the root and a workspace pin different majors, should record the root specifier', () => {
    // given: a root pinning typescript ^5.7.2 and a workspace pinning ^5.4.0
    // when: the map is built for that project
    // then: the root's specifier wins and the workspace-only name is absent
    const root = makeRoot('peaks-libversions-');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', devDependencies: { typescript: '^5.7.2' } }, null, 2),
      'utf8'
    );
    mkdirSync(join(root, 'packages', 'inner'), { recursive: true });
    writeFileSync(
      join(root, 'packages', 'inner', 'package.json'),
      JSON.stringify(
        {
          name: 'inner',
          devDependencies: { typescript: '^5.4.0' },
          dependencies: { 'ws-only': '^1.0.0' }
        },
        null,
        2
      ),
      'utf8'
    );

    const rows = libraryVersionsFor(root, [
      { name: 'typescript', version: '^5.7.2' },
      { name: 'typescript', version: '^5.4.0' },
      { name: 'ws-only', version: '^1.0.0' }
    ]);

    expect(rows.typescript).toBe('^5.7.2');
    expect(rows['ws-only']).toBeUndefined();
  });

  it('when the root manifest is unreadable, should fall back to the raw scan rather than empty the map', () => {
    // given: a project root with no package.json
    // when: the map is built
    // then: every scanned name survives — an unreadable manifest is not a licence to drop data
    const root = makeRoot('peaks-libversions-nomanifest-');

    expect(rootDeclaredNames(root)).toBeNull();
    expect(libraryVersionsFor(root, [{ name: 'vitest', version: '^4.1.10' }])).toEqual({
      vitest: '^4.1.10'
    });
  });
});
