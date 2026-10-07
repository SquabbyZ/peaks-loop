// tests/unit/ide/install-skills-published-modules.test.ts
//
// THE GENERAL RULE behind a guard that used to name one and check two.
//
// WHAT WAS WRONG. `agents-output-styles-canonical-store.test.ts` carried a case called
// "when the installer imports a sibling module, should ship that module in the tarball"
// whose body asserted `manifest.files` contains `scripts/canonical-store.mjs` and
// `scripts/canonical-store-link.mjs` — two NAMES, typed in. A guard that promises a
// general rule and checks a fixed list keeps passing the moment a third module is
// added, which is exactly the failure it exists to catch: `scripts/install-skills.mjs`
// IS the npm postinstall, so a sibling module missing from `package.json#files` throws
// `ERR_MODULE_NOT_FOUND` for every user of the published package while the entire test
// suite stays green. That mistake has been made twice in this session.
//
// WHAT THIS FILE PINS. The RULE, read off the installer: every relative specifier it
// imports must appear in the published allowlist under `scripts/`, and must exist on
// disk. Add a fourth module tomorrow and this file fails until `files` names it — with
// no list here to update.
//
// ANTI-VACUITY. A parser that cannot see imports would report zero and every loop over
// zero passes, so:
//   - the real-file case asserts the parse is NON-EMPTY first (and names what it found),
//     so "nothing found" is a failure, never a pass;
//   - a control case runs the SAME parser over two fixture strings — one holding two
//     relative imports, one holding none — so a parser that regressed into a no-op is
//     caught by its own reading, not by the file it is applied to.
//
// NO REAL $HOME IS TOUCHED: this file reads two tracked files and writes nothing.
//
// Dimensions covered:
//   - behavior:    the rule, and the parser's own ability to see anything
//   - integration: the real installer and the real published allowlist on disk
//   - render:      OMITTED — no human-facing output is produced or asserted here
//   - a11y:        OMITTED — no exit code, message or interaction surface is involved

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/ide/install-skills-published-modules.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the guard reads two files and prints nothing' },
    { dim: 'a11y', reason: 'no human-facing text, exit code or message is asserted here' }
  ]
);

const PACKAGE_ROOT = resolve(__dirname, '..', '..', '..');
const INSTALLER = join('scripts', 'install-skills.mjs');

/**
 * Every RELATIVE specifier `source` imports — both `import … from './x.mjs'` and the
 * side-effect form `import './x.mjs'`. Sorted and de-duplicated so the reading is
 * stable; nested specifiers (`./lib/x.mjs`) are kept as written.
 */
function relativeImportsOf(source: string): string[] {
  const found = new Set<string>();
  const patterns = [/\bfrom\s+['"](\.[^'"]+)['"]/g, /^\s*import\s+['"](\.[^'"]+)['"]/gm];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (typeof specifier === 'string') found.add(specifier);
    }
  }
  return [...found].sort();
}

/** `./canonical-store.mjs` is published as `scripts/canonical-store.mjs`. */
function publishedPathOf(specifier: string): string {
  return join('scripts', specifier.replace(/^\.\//, '')).split('\\').join('/');
}

const installSkillsSource = readFileSync(join(PACKAGE_ROOT, INSTALLER), 'utf8');
const publishedFiles = (
  JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { files: string[] }
).files;

describe('Scenario: integration — every sibling module the postinstall imports is published', () => {
  it('when the installer imports a relative module, should ship it in the published allowlist', () => {
    // given: the real `scripts/install-skills.mjs`, which runs as the npm postinstall
    //        and therefore cannot resolve a sibling the tarball left behind
    // when: its relative imports are read off and checked against `package.json#files`
    // then: every one of them is published, so no user meets ERR_MODULE_NOT_FOUND
    const specifiers = relativeImportsOf(installSkillsSource);
    // Non-vacuity FIRST: a parser that sees nothing must fail here, not pass the loop.
    expect(specifiers.length, `no relative import found in ${INSTALLER}`).toBeGreaterThan(0);

    const unpublished = specifiers
      .filter((specifier) => !publishedFiles.includes(publishedPathOf(specifier)))
      .map(publishedPathOf);
    expect(unpublished, `imported but NOT in package.json#files`).toEqual([]);
  });

  it('when a sibling module is imported, should also exist on disk under scripts/', () => {
    // given: the same imports, which `scripts/install-skills.mjs` resolves relative to
    //        its own directory at install time
    // when: each is resolved against the repo
    // then: each is a real file — a rename that missed the import cannot pass silently
    const specifiers = relativeImportsOf(installSkillsSource);
    expect(specifiers.length).toBeGreaterThan(0);

    const missing = specifiers.filter(
      (specifier) => !existsSync(join(PACKAGE_ROOT, publishedPathOf(specifier)))
    );
    expect(missing, 'imported but absent from scripts/').toEqual([]);
  });

  it('when the parser is handed fixture text, should read the imports and only the imports', () => {
    // given: two fixture sources — one with two relative imports, one with none, plus a
    //        bare package import that must NOT be mistaken for a published sibling
    // when: the same parser the two cases above rely on reads them
    // then: it returns exactly the relative specifiers, proving it is not a no-op
    const withImports =
      "import { a } from './one.mjs';\nimport 'node:fs';\nimport { b } from '@scope/pkg';\nimport './two.mjs';\n";

    expect(relativeImportsOf(withImports)).toEqual(['./one.mjs', './two.mjs']);
    expect(relativeImportsOf("import { a } from 'node:fs';\n")).toEqual([]);
  });
});
