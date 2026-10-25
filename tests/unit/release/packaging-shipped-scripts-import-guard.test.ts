// tests/unit/release/packaging-shipped-scripts-import-guard.test.ts
//
// THE DEFECT THIS GUARDS (rid-t5-release-packaging-hotfix).
//
// The published root package `peaks-loop` failed to install from 4.1.18 onward,
// at the `postinstall` step, before the CLI was ever usable:
//
//   npm error Error [ERR_MODULE_NOT_FOUND]: Cannot find module
//     '.../node_modules/peaks-loop/scripts/canonical-store-report.mjs'
//     imported from '.../node_modules/peaks-loop/scripts/install-skills-bundles.mjs'
//
// The mechanism is an ALLOWLIST-vs-IMPORTER mismatch, not a missing file in the
// repository: `scripts/install-skills-bundles.mjs` (shipped) imports
// `./canonical-store-report.mjs`, and the root `package.json#files` allowlist —
// the only thing that decides what the tarball contains — never named that file.
// npm therefore shipped an importer whose sibling was missing, and Node's ESM
// loader failed the entire install.
//
// WHAT THIS FILE IS. A STATIC guard (PRD goal G2, preserved behaviour P4): it
// reads the root manifest's `files` allowlist, takes the `scripts/*.mjs` entries
// as the SHIPPED script set, parses each shipped script's local relative
// imports, and asserts every imported sibling is itself shipped. No network, no
// registry, no real `npm install`.
//
// WHY IT MUST NOT HAVE FALSE POSITIVES (PRD boundary case B4). The rule is
// about imports BETWEEN SHIPPED SCRIPTS. The repository holds many `scripts/*.mjs`
// that are deliberately outside `files` (dev / build / test helpers); nothing
// here asks for those to ship. Only a relative import made BY a shipped script,
// to a sibling `.mjs`, is in scope.
//
// SCOPE BOUNDARY (deliberate). Only `./x.mjs` specifiers are checked, which is
// the form the PRD names. A shipped script importing a non-`.mjs` local asset is
// a different defect class and is NOT part of this slice's contract.
//
// THE GUARD IS PROVEN LOAD-BEARING, NOT ASSUMED (PRD boundary case B3). Two
// independent ways:
//   1. `behavior` — a synthetic in-memory fixture where a shipped script imports
//      an unshipped sibling MUST be reported. A detector that cannot fail is not
//      a detector.
//   2. red reproduction on the real tree — removing
//      `scripts/canonical-store-report.mjs` from `package.json#files` turns this
//      file red, and restoring the manifest byte-for-byte (sha256-compared)
//      turns it green again. Measured; see `rd/test-reports/` for this rid.

import { existsSync, readFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseJson } from '../../../src/shared/json-parse.js';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions('tests/unit/release/packaging-shipped-scripts-import-guard.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** The repository root, from this file: `tests/unit/release/` -> repo root. */
const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/**
 * The manifest shape this guard reads. `looseObject` because a real
 * `package.json` carries far more than `version` and `files`, and validation is
 * not licence to reject the rest.
 */
const rootManifestSchema = z.looseObject({
  version: z.string(),
  files: z.array(z.string())
});

/** One local relative import made by a shipped script. */
interface ResolvedLocalImport {
  /** The importer, repo-relative (`scripts/install-skills-bundles.mjs`). */
  importer: string;
  /** The specifier exactly as written (`./canonical-store-report.mjs`). */
  specifier: string;
  /** The resolved repo-relative target (`scripts/canonical-store-report.mjs`). */
  target: string;
}

/**
 * A local relative import specifier, in any of the three spellings a `.mjs`
 * script uses: `from './x.mjs'`, `import './x.mjs'` and `await import('./x.mjs')`.
 * The `from` / `import` prefix is REQUIRED, so a bare string literal that
 * happens to look like a path is not mistaken for an import.
 */
const LOCAL_RELATIVE_IMPORT_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+\.mjs)\1/g;

/**
 * Remove comments WITHOUT touching string literals.
 *
 * A naive `/\/\/.*$/` stripper would also eat the tail of a line holding a URL
 * (`https://…`) or a `'//'` inside a string, and could then hide a real import
 * that follows on the same line. This scanner tracks quote state, so only a
 * comment marker outside a string starts a comment.
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let quote: '"' | "'" | '`' | null = null;
  while (index < source.length) {
    const char = source[index];
    if (quote !== null) {
      out += char;
      if (char === '\\') {
        out += source[index + 1] ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * The `scripts/*.mjs` entries of the root `files` allowlist = the SHIPPED script
 * set. This is the exact set `npm pack` will place in the tarball's `scripts/`.
 *
 * Only LITERAL entries are taken. A glob entry under `scripts/` is not a set
 * member — it is an unresolvable entry, and {@link collectUnresolvableScriptGlobs}
 * reports it so the guard fails loud instead of quietly narrowing its own scope.
 */
function collectShippedScripts(files: readonly string[]): string[] {
  return files.filter(
    (entry) => entry.startsWith('scripts/') && entry.endsWith('.mjs') && !entry.includes('*')
  );
}

/**
 * `files` entries under `scripts/` that carry a glob. Such an entry makes the
 * shipped set impossible to compute statically, so the guard must FAIL LOUD
 * rather than quietly narrow its own scope and report a false green.
 */
function collectUnresolvableScriptGlobs(files: readonly string[]): string[] {
  return files.filter((entry) => entry.startsWith('scripts/') && entry.includes('*'));
}

/** The local relative `.mjs` import specifiers of one script, de-duplicated. */
function parseLocalRelativeImports(source: string): string[] {
  const code = stripComments(source);
  const found = new Set<string>();
  for (const match of code.matchAll(LOCAL_RELATIVE_IMPORT_RE)) {
    const specifier = match[2];
    if (specifier !== undefined) found.add(specifier);
  }
  return [...found];
}

/** Resolve a relative specifier against the importer's directory, POSIX-style. */
function resolveRelativeTarget(importer: string, specifier: string): string {
  return posix.normalize(posix.join(posix.dirname(importer), specifier));
}

/**
 * Every local relative `.mjs` import made by the shipped scripts.
 * `readSource` returns `undefined` for a script that is not on disk — the
 * guard then has nothing to check for it, which is reported by the separate
 * "every shipped script exists on disk" assertion.
 */
function collectLocalImports(
  shipped: readonly string[],
  readSource: (relativePath: string) => string | undefined
): ResolvedLocalImport[] {
  const found: ResolvedLocalImport[] = [];
  for (const importer of shipped) {
    const source = readSource(importer);
    if (source === undefined) continue;
    for (const specifier of parseLocalRelativeImports(source)) {
      found.push({ importer, specifier, target: resolveRelativeTarget(importer, specifier) });
    }
  }
  return found;
}

/**
 * The defect itself: a shipped script importing a sibling that the allowlist
 * does not ship. Every entry is a package that would fail to install.
 */
function findUnshippedImports(
  shipped: readonly string[],
  readSource: (relativePath: string) => string | undefined
): ResolvedLocalImport[] {
  const shippedSet = new Set(shipped);
  return collectLocalImports(shipped, readSource).filter((entry) => !shippedSet.has(entry.target));
}

/** Read a repo-relative file, or `undefined` when it is not there. */
function readRepoSource(relativePath: string): string | undefined {
  const absolute = join(REPO_ROOT, relativePath);
  if (!existsSync(absolute)) return undefined;
  return readFileSync(absolute, 'utf8');
}

/** Read the real root manifest. */
function readRootManifest(): z.infer<typeof rootManifestSchema> {
  return parseJson(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'), rootManifestSchema);
}

/** The human-readable form of one violation — the sentence a human has to read. */
function describeViolation(violation: ResolvedLocalImport): string {
  return (
    `${violation.importer} imports ${violation.specifier} ` +
    `(-> ${violation.target}), but ${violation.target} is not in package.json#files`
  );
}

// ---- behavior dimension ----------------------------------------------------
// The detector is exercised against SYNTHETIC fixtures first. If these fail, the
// guard cannot fail on the real tree either, and a green on the real tree would
// prove nothing.

describe('Scenario: (behavior) — the detector reports an unshipped sibling and ignores a shipped one', () => {
  it('when a shipped script imports a sibling that is not shipped, should report that import as a violation', () => {
    // given: a synthetic shipped set and a script that imports a sibling outside it
    // when:  the detector runs over that fixture
    // then:  the import is reported, with the importer and the resolved target
    const shipped = ['scripts/importer.mjs', 'scripts/other.mjs'];
    const sources: Record<string, string> = {
      'scripts/importer.mjs': "import { x } from './missing.mjs';\n",
      'scripts/other.mjs': "import { y } from './other.mjs';\n"
    };
    const readSource = (relativePath: string): string | undefined => sources[relativePath];

    const violations = findUnshippedImports(shipped, readSource);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.importer).toBe('scripts/importer.mjs');
    expect(violations[0]?.specifier).toBe('./missing.mjs');
    expect(violations[0]?.target).toBe('scripts/missing.mjs');
  });

  it('when every shipped script imports only shipped siblings, should report no violation', () => {
    // given: a synthetic shipped set whose imports all land inside it
    // when:  the detector runs over that fixture
    // then:  nothing is reported
    const shipped = ['scripts/importer.mjs', 'scripts/sibling.mjs'];
    const sources: Record<string, string> = {
      'scripts/importer.mjs': "import { x } from './sibling.mjs';\n",
      'scripts/sibling.mjs': ''
    };
    const readSource = (relativePath: string): string | undefined => sources[relativePath];

    expect(findUnshippedImports(shipped, readSource)).toEqual([]);
  });

  it('when a repository script that is deliberately not shipped imports another, should report no violation', () => {
    // given: a dev/build script that is outside the allowlist and imports a sibling
    // when:  the detector runs over the shipped set only
    // then:  the dev script is not in scope, so nothing is reported (PRD B4)
    const shipped = ['scripts/importer.mjs'];
    const sources: Record<string, string> = {
      'scripts/importer.mjs': '',
      'scripts/dev-only-helper.mjs': "import { x } from './dev-only-sibling.mjs';\n"
    };
    const readSource = (relativePath: string): string | undefined => sources[relativePath];

    expect(findUnshippedImports(shipped, readSource)).toEqual([]);
  });

  it('when a script mentions a relative path in a comment, should not count it as an import', () => {
    // given: a shipped script whose only relative path is inside a comment
    // when:  the detector runs over that fixture
    // then:  the comment is not an import, so nothing is reported
    const shipped = ['scripts/importer.mjs'];
    const sources: Record<string, string> = {
      'scripts/importer.mjs': "// see './missing.mjs' for the old shape\n"
    };
    const readSource = (relativePath: string): string | undefined => sources[relativePath];

    expect(findUnshippedImports(shipped, readSource)).toEqual([]);
  });

  it('when a script imports a sibling in all three spellings, should count that sibling once', () => {
    // given: a shipped script that imports the same sibling three different ways
    // when:  the detector runs over that fixture
    // then:  the sibling is one violation, not three
    const shipped = ['scripts/importer.mjs'];
    const sources: Record<string, string> = {
      'scripts/importer.mjs': [
        "import { a } from './missing.mjs';",
        "import './missing.mjs';",
        "const m = await import('./missing.mjs');",
        ''
      ].join('\n')
    };
    const readSource = (relativePath: string): string | undefined => sources[relativePath];

    expect(findUnshippedImports(shipped, readSource)).toHaveLength(1);
  });

  it('when the allowlist names a scripts glob, should refuse to narrow the scope silently', () => {
    // given: a files allowlist whose scripts entry carries a glob
    // when:  the shipped set is computed
    // then:  the glob is reported as unresolvable, so the guard fails loud
    const files = ['scripts/*.mjs', 'dist/**/*.js'];

    expect(collectUnresolvableScriptGlobs(files)).toEqual(['scripts/*.mjs']);
    expect(collectShippedScripts(files)).toEqual([]);
  });
});

// ---- integration dimension -------------------------------------------------
// The real tree. This is the assertion that would have failed on 4.1.18.

describe('Scenario: (integration) — the real root manifest ships every sibling its shipped scripts import', () => {
  it('when the shipped script set is checked, should every local relative import resolve to a shipped script', () => {
    // given: the real root manifest and the real scripts directory
    // when:  every shipped script's local relative imports are resolved
    // then:  every one of them is itself a shipped script
    const manifest = readRootManifest();
    const shipped = collectShippedScripts(manifest.files);

    expect(shipped.length).toBeGreaterThan(0);
    expect(collectUnresolvableScriptGlobs(manifest.files)).toEqual([]);

    const violations = findUnshippedImports(shipped, readRepoSource);

    expect(violations.map(describeViolation).join('\n')).toBe('');
    expect(violations).toEqual([]);
  });

  it('when the shipped script set is listed, should every shipped script exist on disk', () => {
    // given: the real root manifest
    // when:  the shipped script set is listed
    // then:  every entry is a file that exists (an allowlist entry pointing at
    //        nothing would make the whole guard meaningless)
    const manifest = readRootManifest();
    const shipped = collectShippedScripts(manifest.files);

    expect(shipped.filter((entry) => !existsSync(join(REPO_ROOT, entry)))).toEqual([]);
  });

  it('when the shipped script set is counted, should the counts are the measured ones', () => {
    // given: the real root manifest and the real scripts directory
    // when:  the shipped scripts and their local relative imports are counted
    // then:  the two numbers this guard is measured against are these
    //        (19 shipped script entries, 27 local relative imports checked —
    //        26 of them the shipped scripts' own, plus the one
    //        `./canonical-store.mjs` import inside `canonical-store-report.mjs`,
    //        which only became a shipped script with this slice's fix)
    const manifest = readRootManifest();
    const shipped = collectShippedScripts(manifest.files);
    const imports = collectLocalImports(shipped, readRepoSource);

    expect(shipped.length).toBe(19);
    expect(imports.length).toBe(27);
  });

  it('when the allowlist is read, should it names the script the importer needs', () => {
    // given: the real root manifest
    // when:  the shipped script set is listed
    // then:  `scripts/canonical-store-report.mjs` is in it — the entry the
    //        4.1.18 defect was missing (the direct AC-1 pin)
    const manifest = readRootManifest();
    const shipped = collectShippedScripts(manifest.files);

    expect(shipped).toContain('scripts/canonical-store-report.mjs');
  });
});

// ---- render dimension ------------------------------------------------------
// The shape of the guard's own output.

describe('Scenario: (render) — the violation is reported with importer, specifier and target', () => {
  it('when a violation is described, should the sentence names the importer, the specifier and the target', () => {
    // given: one violation as the detector produces it
    // when:  it is rendered for a human
    // then:  the sentence names all three, so the reader knows what to add
    const violation: ResolvedLocalImport = {
      importer: 'scripts/install-skills-bundles.mjs',
      specifier: './canonical-store-report.mjs',
      target: 'scripts/canonical-store-report.mjs'
    };

    const sentence = describeViolation(violation);

    expect(sentence).toContain('scripts/install-skills-bundles.mjs');
    expect(sentence).toContain('./canonical-store-report.mjs');
    expect(sentence).toContain('package.json#files');
  });
});

// ---- a11y dimension --------------------------------------------------------
// What the human sees when the guard fails.

describe('Scenario: (a11y) — a red run tells the reader what to add to the allowlist', () => {
  it('when the guard fails, should the message names the file to add and the manifest to edit', () => {
    // given: the real violation the 4.1.18 defect produced
    // when:  it is rendered for a human
    // then:  the message says WHICH file is missing and WHICH manifest to edit
    const sentence = describeViolation({
      importer: 'scripts/install-skills-bundles.mjs',
      specifier: './canonical-store-report.mjs',
      target: 'scripts/canonical-store-report.mjs'
    });

    expect(sentence).toMatch(/is not in package\.json#files/);
    expect(sentence).toContain('scripts/canonical-store-report.mjs');
  });

  it('when the guard passes, should the violation list is empty and says so', () => {
    // given: the real tree after the fix
    // when:  the violations are rendered
    // then:  the rendered list is empty — the guard reports nothing to fix
    const manifest = readRootManifest();
    const shipped = collectShippedScripts(manifest.files);

    const rendered = findUnshippedImports(shipped, readRepoSource).map(describeViolation);

    expect(rendered.join('\n')).toBe('');
  });
});
