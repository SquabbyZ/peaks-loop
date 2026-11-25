import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  DEFAULT_MAX_IMPORTS,
  readImportClosure,
  type ImportClosure
} from '../../../src/services/design/audit/import-closure.js';
import { readPathAliases } from '../../../src/services/design/audit/path-aliases.js';
import { MAX_SOURCE_BYTES } from '../../../src/services/design/audit/source-cache.js';

declareDimensions('tests/unit/design/audit-import-closure.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/audit');
const ALIAS_TREE = join(FIXTURES, 'alias-tree');

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

const canSymlink = ((): boolean => {
  const probe = mkdtempSync(join(tmpdir(), 'peaks-closure-symlink-'));
  try {
    writeFileSync(join(probe, 'target.txt'), 'x', 'utf8');
    symlinkSync(join(probe, 'target.txt'), join(probe, 'link.txt'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-closure-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body, 'utf8');
  }
  return root;
}

function readTree(
  root: string,
  file: string,
  source: string,
  extra: Partial<Parameters<typeof readImportClosure>[0]> = {}
): ImportClosure {
  return readImportClosure({ appRoot: root, file, source, ...extra });
}

function filesOf(closure: ImportClosure): string[] {
  return closure.sources.map((entry) => entry.file);
}

describe('Scenario: render — the closure returns the documented shape', () => {
  it('when a page has no imports, should return every gap list empty', () => {
    // given: a page with no import statement at all
    // when: its closure is read
    // then: nothing is reported and the walk is not truncated
    const root = makeTree({ 'pages/plain.tsx': 'export const X = () => <p>plain</p>;\n' });
    const closure = readTree(root, 'pages/plain.tsx', 'export const X = () => <p>plain</p>;\n');
    expect(closure).toEqual({
      sources: [],
      skipped: [],
      aliasGaps: [],
      escapes: [],
      truncated: false
    });
  });

  it('when two modules are imported out of order, should sort the sources by path', () => {
    // given: a page importing ./Zeta before ./Alpha
    // when: the closure is read
    // then: the returned sources are sorted app-relative paths with their text
    const root = makeTree({
      'pages/sorted.tsx': "import { Z } from './Zeta';\nimport { A } from './Alpha';\n",
      'pages/Zeta.tsx': 'export const Z = () => <p>z</p>;\n',
      'pages/Alpha.tsx': 'export const A = () => <p>a</p>;\n'
    });
    const source = "import { Z } from './Zeta';\nimport { A } from './Alpha';\n";
    const closure = readTree(root, 'pages/sorted.tsx', source);
    expect(filesOf(closure)).toEqual(['pages/Alpha.tsx', 'pages/Zeta.tsx']);
    expect(closure.sources[0]?.source).toBe('export const A = () => <p>a</p>;\n');
  });

  it('when a module is imported twice, should return it once', () => {
    // given: two import statements naming the same module
    // when: the closure is read
    // then: the visited set keeps a single source for it
    const root = makeTree({
      'pages/dup.tsx': "import { A } from './Alpha';\nimport { B } from './Alpha';\n",
      'pages/Alpha.tsx': 'export const A = () => <p>a</p>;\n'
    });
    const closure = readTree(
      root,
      'pages/dup.tsx',
      "import { A } from './Alpha';\nimport { B } from './Alpha';\n"
    );
    expect(filesOf(closure)).toEqual(['pages/Alpha.tsx']);
  });
});

describe('Scenario: behavior — every module syntax is followed exactly once', () => {
  it('when a page uses every import form, should follow each relative module', () => {
    // given: default, named, namespace, side-effect, type-only, re-export,
    //        star, require, dynamic import, and both quote styles
    // when: the closure is read
    // then: every one of the named modules is a source
    const names = [
      'Default',
      'Named',
      'Namespace',
      'SideEffect',
      'TypeOnly',
      'Reexport',
      'Star',
      'Cjs',
      'Dynamic',
      'DoubleQuoted'
    ];
    const imports = [
      "import Default from '../forms/Default';",
      "import { Named } from '../forms/Named';",
      "import * as Namespace from '../forms/Namespace';",
      "import '../forms/SideEffect';",
      "import type { T } from '../forms/TypeOnly';",
      "export { R } from '../forms/Reexport';",
      "export * from '../forms/Star';",
      "const Cjs = require('../forms/Cjs');",
      "const Dynamic = import('../forms/Dynamic');",
      'import { Dq } from "../forms/DoubleQuoted";'
    ];
    const files: Record<string, string> = {
      'pages/forms.tsx': `${imports.join('\n')}\n`
    };
    for (const name of names) files[`forms/${name}.tsx`] = `export const ${name} = 1;\n`;
    const root = makeTree(files);
    const closure = readTree(root, 'pages/forms.tsx', `${imports.join('\n')}\n`);
    expect(filesOf(closure)).toEqual(names.map((name) => `forms/${name}.tsx`).sort());
    expect(closure.skipped).toEqual([]);
  });

  it('when whitespace separates the keywords, should still read the specifier', () => {
    // given: two-space separation, a newline after from, and spaced require/import calls
    // when: the closure is read
    // then: every module is still followed
    const imports = [
      "import  Multi  from  '../forms/MultiSpace';",
      "import { Wrapped } from\n  '../forms/WrappedFrom';",
      "import  '../forms/SideMulti';",
      "const S = require ('../forms/SpacedRequire');",
      "const T = require( '../forms/SpacedInner' );",
      "const U = import ('../forms/SpacedDynamic');"
    ];
    const names = [
      'MultiSpace',
      'WrappedFrom',
      'SideMulti',
      'SpacedRequire',
      'SpacedInner',
      'SpacedDynamic'
    ];
    const files: Record<string, string> = {
      'pages/spaced.tsx': `${imports.join('\n')}\n`
    };
    for (const name of names) files[`forms/${name}.tsx`] = `export const ${name} = 1;\n`;
    const root = makeTree(files);
    const closure = readTree(root, 'pages/spaced.tsx', `${imports.join('\n')}\n`);
    expect(filesOf(closure)).toEqual(names.map((name) => `forms/${name}.tsx`).sort());
  });

  it('when a string merely contains import-like words, should not follow it', () => {
    // given: a page whose only quotes are a bare string and an imported label
    // when: the closure is read
    // then: neither string is mistaken for an import
    const root = makeTree({
      'pages/words.tsx':
        "export const imported = '../forms/Ghost';\nexport const label = 'from \"../forms/Ghost\"';\n"
    });
    const closure = readTree(
      root,
      'pages/words.tsx',
      "export const imported = '../forms/Ghost';\nexport const label = 'from \"../forms/Ghost\"';\n"
    );
    expect(closure.sources).toEqual([]);
    expect(closure.skipped).toEqual([]);
  });

  it('when a page imports a stylesheet or an asset, should leave it to their own readers', () => {
    // given: imports of .css, .json and .svg instead of code modules
    // when: the closure is read
    // then: nothing is read and no gap is recorded
    const root = makeTree({
      'pages/assets.tsx': "import './styles/app.css';\nimport data from './data.json';\n",
      'styles/app.css': '.a { color: red; }\n',
      'data.json': '{}\n'
    });
    const closure = readTree(
      root,
      'pages/assets.tsx',
      "import './styles/app.css';\nimport data from './data.json';\n"
    );
    expect(closure).toEqual({
      sources: [],
      skipped: [],
      aliasGaps: [],
      escapes: [],
      truncated: false
    });
  });

  it('when an import names a test module, should refuse to read it', () => {
    // given: an existing Foo.test.tsx and a __mocks__ module, both imported as code
    // when: the closure is read beside a normal sibling import
    // then: only the sibling is a source and each test module is a named gap
    const source =
      "import './Foo.test.tsx';\nimport './__mocks__/rows.tsx';\nimport { A } from './Alpha';\n" +
      'export const X = 1;\n';
    const root = makeTree({
      'pages/with-test.tsx': source,
      'pages/Foo.test.tsx': 'export const Foo = 1;\n',
      'pages/__mocks__/rows.tsx': 'export const rows = [];\n',
      'pages/Alpha.tsx': 'export const A = 1;\n'
    });
    const closure = readTree(root, 'pages/with-test.tsx', source);
    expect(filesOf(closure)).toEqual(['pages/Alpha.tsx']);
    expect(closure.skipped.join('\n')).toContain('Foo.test.tsx');
    expect(closure.skipped.join('\n')).toContain('__mocks__/rows.tsx');
  });

  it('when a relative import names no file, should name it while following the others', () => {
    // given: a page importing a resolvable module and a missing relative one
    // when: the closure is read
    // then: the present module is read and the missing one is a named gap
    const source = "import { A } from './Alpha';\nimport './Nope';\n";
    const root = makeTree({
      'pages/partial.tsx': source,
      'pages/Alpha.tsx': 'export const A = 1;\n'
    });
    const closure = readTree(root, 'pages/partial.tsx', source);
    expect(filesOf(closure)).toEqual(['pages/Alpha.tsx']);
    expect(closure.skipped).toEqual(['pages/partial.tsx -> ./Nope (not followed)']);
  });

  it('when a package is imported, should name the unresolved import instead of reading it', () => {
    // given: a page importing react beside one relative module
    // when: the closure is read
    // then: react is a named gap and the relative module is still followed
    const root = makeTree({
      'pages/mixed.tsx': "import React from 'react';\nimport { A } from './Alpha';\n",
      'pages/Alpha.tsx': 'export const A = 1;\n'
    });
    const source = "import React from 'react';\nimport { A } from './Alpha';\n";
    const closure = readTree(root, 'pages/mixed.tsx', source);
    expect(filesOf(closure)).toEqual(['pages/Alpha.tsx']);
    expect(closure.skipped).toEqual(['pages/mixed.tsx -> react (not followed)']);
  });
});

describe('Scenario: behavior — resolution falls back the way TypeScript ESM does', () => {
  it('when an extension-less import names a directory, should read its index module', () => {
    // given: an import of ../forms/Indexed where only forms/Indexed/index.tsx exists
    // when: the closure is read
    // then: the index module is the source
    const root = makeTree({
      'pages/indexed.tsx': "import { I } from '../forms/Indexed';\n",
      'forms/Indexed/index.tsx': 'export const I = 1;\n'
    });
    const closure = readTree(root, 'pages/indexed.tsx', "import { I } from '../forms/Indexed';\n");
    expect(filesOf(closure)).toEqual(['forms/Indexed/index.tsx']);
  });

  it('when an import names .js, should prefer that file and fall back to its TS source', () => {
    // given: Literal.js beside Literal.tsx, and only .tsx siblings for the rest
    // when: .js, .jsx, .mjs and .cjs emitted names are imported
    // then: the literal file wins and every missing one falls back to its source
    const source =
      "import './Literal.js';\nimport './EsmOnly.js';\nimport './JsxOnly.jsx';\n" +
      "import './MjsOnly.mjs';\nimport './CjsOnly.cjs';\n";
    const root = makeTree({
      'pages/esm.tsx': source,
      'pages/Literal.js': 'export const L = 1;\n',
      'pages/Literal.tsx': 'export const L = 2;\n',
      'pages/EsmOnly.tsx': 'export const E = 1;\n',
      'pages/JsxOnly.tsx': 'export const J = 1;\n',
      'pages/MjsOnly.tsx': 'export const M = 1;\n',
      'pages/CjsOnly.tsx': 'export const C = 1;\n'
    });
    const closure = readTree(root, 'pages/esm.tsx', source);
    expect(filesOf(closure)).toEqual([
      'pages/CjsOnly.tsx',
      'pages/EsmOnly.tsx',
      'pages/JsxOnly.tsx',
      'pages/Literal.js',
      'pages/MjsOnly.tsx'
    ]);
  });

  it('when an import names an explicit .ts file, should not substitute another extension', () => {
    // given: Exact.ts exists, while Sibling.ts names only a Sibling.tsx on disk
    // when: both explicit .ts names are imported
    // then: the exact file is read and the missing one is never substituted
    const source = "import './Exact.ts';\nimport './Sibling.ts';\n";
    const root = makeTree({
      'pages/exact.tsx': source,
      'pages/Exact.ts': 'export const Exact = 1;\n',
      'pages/Sibling.tsx': 'export const Sibling = 1;\n'
    });
    const closure = readTree(root, 'pages/exact.tsx', source);
    expect(filesOf(closure)).toEqual(['pages/Exact.ts']);
    expect(closure.skipped).toEqual(['pages/exact.tsx -> ./Sibling.ts (not followed)']);
  });

  it('when a cycle imports the page back, should never re-read the seed', () => {
    // given: a page importing Loop, and Loop importing the page again
    // when: the closure is read
    // then: the page itself never appears among its own sources
    const root = makeTree({
      'pages/circle.tsx': "import { L } from '../components/Loop';\nexport const P = 1;\n",
      'components/Loop.tsx': "import { P } from '../pages/circle';\nexport const L = 1;\n"
    });
    const source = "import { L } from '../components/Loop';\nexport const P = 1;\n";
    const closure = readTree(root, 'pages/circle.tsx', source);
    expect(filesOf(closure)).toEqual(['components/Loop.tsx']);
  });

  it('when two modules share an import, should read that module once', () => {
    // given: a page importing A and B, both importing the shared component C
    // when: the closure is drained
    // then: C is queued twice but read and returned exactly once
    const source = "import { A } from './A';\nimport { B } from './B';\n";
    const root = makeTree({
      'pages/diamond.tsx': source,
      'pages/A.tsx': "import { C } from './C';\nexport const A = 1;\n",
      'pages/B.tsx': "import { C } from './C';\nexport const B = 1;\n",
      'pages/C.tsx': 'export const C = 1;\n'
    });
    const closure = readTree(root, 'pages/diamond.tsx', source);
    expect(filesOf(closure)).toEqual(['pages/A.tsx', 'pages/B.tsx', 'pages/C.tsx']);
  });

  it('when a relative import climbs out of the app root, should not name it an escape', () => {
    // given: a page importing ../../secret, which exists outside the app root
    // when: the closure is read
    // then: it is an unresolved import, never a symlink escape that was skipped
    const source = "import '../../secret';\n";
    const root = makeTree({
      'app/pages/climber.tsx': source,
      'secret.ts': 'export const secret = 1;\n'
    });
    const closure = readTree(join(root, 'app'), 'pages/climber.tsx', source);
    expect(closure.sources).toEqual([]);
    expect(closure.escapes).toEqual([]);
    expect(closure.skipped).toEqual(['pages/climber.tsx -> ../../secret (not followed)']);
  });

  it('when the file bound is reached, should stop early and report truncation', () => {
    // given: a two-module chain and a one-file bound
    // when: the closure is read
    // then: one module is returned and the walk says it stopped early
    const root = makeTree({
      'pages/bounded.tsx': "import { A } from './A';\n",
      'pages/A.tsx': "import { B } from './B';\nexport const A = 1;\n",
      'pages/B.tsx': 'export const B = 1;\n'
    });
    const closure = readTree(root, 'pages/bounded.tsx', "import { A } from './A';\n", {
      maxFiles: 1
    });
    expect(filesOf(closure)).toEqual(['pages/A.tsx']);
    expect(closure.truncated).toBe(true);
    expect(DEFAULT_MAX_IMPORTS).toBe(400);
  });
});

describe('Scenario: integration — aliases, symlinks and size bounds', () => {
  it('when a page imports through a declared alias, should follow it to the file', () => {
    // given: the alias-tree tsconfig declaring @/* → ./src/*, one resolvable and one missing alias
    // when: the closure is read with the declared aliases
    // then: the resolvable target is a source and the missing one is an alias gap
    const aliases = readPathAliases(ALIAS_TREE);
    const source =
      "import { RowList } from '@/components/RowList';\nimport { N } from '@/components/Nope';\n";
    const closure = readTree(ALIAS_TREE, 'src/pages/aliased.tsx', source, { aliases });
    expect(filesOf(closure)).toEqual(['src/components/RowList.tsx']);
    expect(closure.aliasGaps).toEqual([
      'alias src/pages/aliased.tsx -> @/components/Nope (no matching path)'
    ]);
  });

  it('when an alias targets no file, should record an alias gap', () => {
    // given: an import of @/components/Missing, a target that does not exist
    // when: the closure is read
    // then: the gap names the file and the specifier and nothing is read
    const aliases = readPathAliases(ALIAS_TREE);
    const source = "import { Missing } from '@/components/Missing';\n";
    const closure = readTree(ALIAS_TREE, 'src/pages/missing.tsx', source, { aliases });
    expect(closure.sources).toEqual([]);
    expect(closure.aliasGaps).toEqual([
      'alias src/pages/missing.tsx -> @/components/Missing (no matching path)'
    ]);
  });

  it('when no alias is declared, should treat @/ imports as packages', () => {
    // given: the same alias-shaped specifier with an empty alias table
    // when: the closure is read
    // then: it is a named package gap, not a silent nothing
    const root = makeTree({ 'pages/no-alias.tsx': "import { X } from '@/components/X';\n" });
    const closure = readTree(root, 'pages/no-alias.tsx', "import { X } from '@/components/X';\n");
    expect(closure.aliasGaps).toEqual([]);
    expect(closure.skipped).toEqual(['pages/no-alias.tsx -> @/components/X (not followed)']);
  });

  it('when a source exceeds the byte cap, should skip it and name the gap', () => {
    // given: one imported module one byte over the cap
    // when: the closure is read
    // then: it is not returned as a source and the gap names the cap
    const root = makeTree({ 'pages/huge.tsx': "import './Huge';\n" });
    mkdirSync(join(root, 'pages'), { recursive: true });
    writeFileSync(join(root, 'pages', 'Huge.ts'), Buffer.alloc(MAX_SOURCE_BYTES + 1, 0x61));
    const closure = readTree(root, 'pages/huge.tsx', "import './Huge';\n");
    expect(closure.sources).toEqual([]);
    expect(closure.skipped.join('\n')).toContain(`larger than ${MAX_SOURCE_BYTES} bytes`);
  });

  it.skipIf(!canSymlink)(
    'when an import resolves through an escaping symlink, should not read it',
    () => {
      // given: outside.tsx is a symlink to a file outside the app root
      // when: the closure resolves ./outside
      // then: the target is not read and the escape is named, never followed
      const root = makeTree({ 'app/pages/list.tsx': "import './outside';\n" });
      writeFileSync(join(root, 'secret.ts'), 'export const leaked = "SECRET";\n', 'utf8');
      mkdirSync(join(root, 'app', 'pages'), { recursive: true });
      symlinkSync(join(root, 'secret.ts'), join(root, 'app', 'pages', 'outside.tsx'), 'file');
      const closure = readTree(join(root, 'app'), 'pages/list.tsx', "import './outside';\n");
      expect(closure.sources).toEqual([]);
      expect(closure.escapes.join('\n')).toContain('symlink escapes app root');
      expect(closure.skipped).toContain('pages/list.tsx -> ./outside (not followed)');
    }
  );
});

describe('Scenario: a11y — every gap says which file and why', () => {
  it('when an import cannot be followed, should name the importing file and the specifier', () => {
    // given: a page importing both a package and a missing relative target
    // when: the closure is read
    // then: each gap is a readable sentence pairing the file with the import
    const root = makeTree({ 'pages/gaps.tsx': "import 'zod';\nimport './Nope';\n" });
    const closure = readTree(root, 'pages/gaps.tsx', "import 'zod';\nimport './Nope';\n");
    expect(closure.skipped).toContain('pages/gaps.tsx -> zod (not followed)');
    expect(closure.skipped).toContain('pages/gaps.tsx -> ./Nope (not followed)');
  });
});
