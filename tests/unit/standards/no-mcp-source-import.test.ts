// tests/unit/standards/no-mcp-source-import.test.ts
//
// The mechanical form of the load-bearing invariant (PRD rid-035 AC-8, and the
// second half of AC-1).
//
// "The MCP server is a deletable pipe" is a claim about EDGES, and the edge that
// breaks it is an `import`. Nothing in the tree today points at either forbidden
// target, so a guard that only asserts "zero findings on the real repo" would be
// indistinguishable from a guard that never looks. The plant arm below is the
// control: a tree that DOES contain each forbidden edge must be reported, and the
// same tree without the edge must be reported clean. Delete the scan's body and
// the plant arm goes red rather than green.
//
// Nothing is written into the repository: every fixture tree lives under
// `mkdtempSync(join(tmpdir(), ...))` via `withFixtureTree`, which removes it.
//
// Dimensions covered: render, behavior, integration, a11y.

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { REPO_ROOT, withFixtureTree } from './_file-size-cap-scan.js';
import {
  MCP_SURFACE_ROOT_REL,
  READONLY_WHITELIST_ARTIFACT_REL,
  SCAN_ROOTS,
  isInsideMcpRoot,
  normalizeSpecifier,
  scanForbiddenImports,
  sourceFilesUnder,
  specifiersOf
} from './_no-mcp-source-import-scan.js';

declareDimensions('tests/unit/standards/no-mcp-source-import.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const MCP_SERVER_SOURCE = 'export const startServer = 1;\n';

/** Every file the repo-wide scan walks, as repo-relative POSIX paths. */
function walkedFiles(): string[] {
  const root = REPO_ROOT.split('\\').join('/');
  return sourceFilesUnder(REPO_ROOT).map((file) =>
    file
      .split('\\')
      .join('/')
      .slice(root.length + 1)
  );
}

describe('Scenario: render - the real tree carries no forbidden edge', () => {
  it('when the repository is scanned, should report no module importing MCP source or the whitelist artifact', () => {
    // given: the working tree
    // when:  every source file under src/, scripts/ and tests/ is scanned
    // then:  there are no findings - the invariant holds today, which is what makes the plant arms meaningful
    const findings = scanForbiddenImports(REPO_ROOT);
    expect(
      findings.map((finding) => `${finding.rule}:${finding.file}:${finding.specifier}`)
    ).toEqual([]);
  });
});

describe('Scenario: behavior - a planted forbidden edge is reported, and its absence is not', () => {
  it('when a module outside the MCP root imports into it, should be reported', () => {
    // given: a fixture tree whose cli module imports a file under the declared MCP root
    withFixtureTree(
      {
        [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE,
        'src/cli/bridge.ts': "import { startServer } from '../services/mcp/server.js';\n"
      },
      (root) => {
        // when:  the tree is scanned
        const findings = scanForbiddenImports(root);
        // then:  exactly that edge is named, and nothing else
        expect(findings).toHaveLength(1);
        expect(findings[0]?.rule).toBe('mcp-source-import');
        expect(findings[0]?.file).toBe('src/cli/bridge.ts');
      }
    );
  });

  it('when no module outside the MCP root reaches in, should report nothing', () => {
    // given: the same tree with the importing module removed
    withFixtureTree({ [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE }, (root) => {
      // when:  the tree is scanned
      // then:  the scan is silent - it is not a scan that reports everything
      expect(scanForbiddenImports(root)).toEqual([]);
    });
  });

  it('when the MCP root imports one of its own modules, should allow it', () => {
    // given: the server importing its own sibling
    withFixtureTree(
      {
        [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE,
        [`${MCP_SURFACE_ROOT_REL}/tools.ts`]: "import './server.js';\n"
      },
      (root) => {
        // when:  the tree is scanned
        // then:  a module inside the root may depend on its own internals
        expect(scanForbiddenImports(root)).toEqual([]);
      }
    );
  });

  // --- the module's OWN tests (slice ②) --------------------------------------
  // A test that mirrors the MCP root is that module's test, and is exempt; a
  // test anywhere else is not. The pair below is the exemption AND its control:
  // without the second arm, an exemption that had accidentally become "any test
  // file" would look identical to this one.

  it('when a test mirrors the MCP root, should allow it', () => {
    // given: a suite co-located with the module it exercises
    withFixtureTree(
      {
        [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE,
        'tests/unit/services/mcp/server.test.ts': "import '~/src/services/mcp/server.js';\n"
      },
      (root) => {
        // when:  the tree is scanned
        // then:  the module's own test may reach it - the test is deleted with
        //        the module, so it is not a dependent the deletion would strand
        expect(scanForbiddenImports(root)).toEqual([]);
      }
    );
  });

  it('when a test does NOT mirror the MCP root, should still report it', () => {
    // given: a suite elsewhere importing MCP source, which deleting the module
    //        WOULD strand
    withFixtureTree(
      {
        [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE,
        'tests/unit/cli/status.test.ts': "import '~/src/services/mcp/server.js';\n"
      },
      (root) => {
        // when:  the tree is scanned
        const findings = scanForbiddenImports(root);
        // then:  the exemption is a mirror, not "any test file"
        expect(findings).toHaveLength(1);
        expect(findings[0]?.rule).toBe('mcp-source-import');
      }
    );
  });

  it('when a directory merely NAMES itself tests, should not be read as a tests root', () => {
    // given: a module in the SHIPPED tree and one in repo automation, each
    //        sitting under a path segment spelled `tests` that is NOT a tests
    //        root - the two forms the first predicate exempted by reading any
    //        `tests` segment as one (QA repair cycle 1, F-2)
    withFixtureTree(
      {
        [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE,
        'src/tests/services/mcp/evil.ts': "import '~/src/services/mcp/server.js';\n",
        'scripts/tests/services/mcp/evil.mjs': "import '~/src/services/mcp/server.js';\n"
      },
      (root) => {
        // when:  the tree is scanned
        const findings = scanForbiddenImports(root);
        // then:  both are findings - the exemption is anchored to a tests ROOT,
        //        so neither shipped code nor repo automation can opt out of the
        //        invariant by naming one of its directories `tests`
        expect(findings.map((finding) => finding.file).sort()).toEqual([
          'scripts/tests/services/mcp/evil.mjs',
          'src/tests/services/mcp/evil.ts'
        ]);
        expect(findings.every((finding) => finding.rule === 'mcp-source-import')).toBe(true);
      }
    );
  });

  it('when a module imports the whitelist artifact, should be reported whatever its location', () => {
    // given: a fixture tree importing the generated JSON, and one importing it from inside the MCP root
    withFixtureTree(
      {
        'src/services/readonly-surface/user.ts': `import whitelist from '../../${READONLY_WHITELIST_ARTIFACT_REL}';\n`,
        [`${MCP_SURFACE_ROOT_REL}/surface.ts`]: `import whitelist from '../../${READONLY_WHITELIST_ARTIFACT_REL}';\n`
      },
      (root) => {
        // when:  the tree is scanned
        const findings = scanForbiddenImports(root);
        // then:  both are reported - the artifact is data, and data has no importers
        expect(findings).toHaveLength(2);
        expect(findings.every((finding) => finding.rule === 'whitelist-artifact-import')).toBe(
          true
        );
      }
    );
  });

  it('when a specifier uses the source alias, should be resolved like any relative path', () => {
    // given: a module reaching the MCP root through the `~/src` alias rather than `../`
    withFixtureTree(
      {
        [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE,
        'src/cli/aliased.ts': "import { startServer } from '~/src/services/mcp/server.js';\n"
      },
      (root) => {
        // when:  the tree is scanned
        const findings = scanForbiddenImports(root);
        // then:  the alias does not launder the edge
        expect(findings).toHaveLength(1);
        expect(findings[0]?.rule).toBe('mcp-source-import');
      }
    );
  });

  it('when a specifier points at a package or a builtin, should ignore it', () => {
    // given: an importer file and a set of specifiers that leave the repository
    withFixtureTree({ 'src/cli/imports.ts': 'export const value = 1;\n' }, (root) => {
      const importer = `${root}/src/cli/imports.ts`;
      // when:  each specifier is normalized
      // then:  none of them resolves to a repo-relative path
      for (const specifier of ['node:fs', 'zod', 'peaks-loop-shared/paths', 'mcp-something']) {
        expect(normalizeSpecifier(importer, root, specifier), specifier).toBeUndefined();
      }
    });
  });

  it('when a specifier is read, should come from the AST rather than from the text', () => {
    // given: a module whose only mention of an import edge is inside a string literal
    withFixtureTree(
      {
        'src/cli/quoted.ts':
          'export const planted = "import { x } from \'../services/mcp/server.js\';";\n'
      },
      (root) => {
        // when:  the specifiers are read
        // then:  the quoted edge is not one - which is why this scan uses the parser
        expect(specifiersOf(`${root}/src/cli/quoted.ts`)).toEqual([]);
        expect(scanForbiddenImports(root)).toEqual([]);
      }
    );
  });

  // --- require() is an edge too (QA repair cycle 1, P2) ---------------------
  // Each form below is a REAL edge by a different spelling. Before these arms the
  // scan read none of them, so the guard was falsifiable only through the ESM
  // spelling - a hole an injection could walk through (measured by QA).

  it('when a CommonJS module requires MCP source, should be reported', () => {
    // given: a `.cjs` module reaching into the declared MCP root with `require`
    withFixtureTree(
      {
        [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE,
        'src/cli/legacy.cjs': "const { startServer } = require('../services/mcp/server.js');\n"
      },
      (root) => {
        // when:  the tree is scanned
        const findings = scanForbiddenImports(root);
        // then:  `require` is not a loophole around the invariant
        expect(findings).toHaveLength(1);
        expect(findings[0]?.rule).toBe('mcp-source-import');
        expect(findings[0]?.file).toBe('src/cli/legacy.cjs');
      }
    );
  });

  it('when a module requires the whitelist artifact, should be reported', () => {
    // given: the artifact reached by `require.resolve` and by `createRequire` -
    //        a `"type":"module"` repo reaches CommonJS loading through the latter
    withFixtureTree(
      {
        'src/services/readonly-surface/user.ts': `const p = require.resolve('../../${READONLY_WHITELIST_ARTIFACT_REL}');\n`,
        'src/cli/create-require.ts':
          `import { createRequire } from 'node:module';\n` +
          `const loaded = createRequire(import.meta.url)('../../${READONLY_WHITELIST_ARTIFACT_REL}');\n`
      },
      (root) => {
        // when:  the tree is scanned
        const findings = scanForbiddenImports(root);
        // then:  both spellings are reported as the same data edge
        expect(findings).toHaveLength(2);
        expect(findings.every((f) => f.rule === 'whitelist-artifact-import')).toBe(true);
      }
    );
  });

  it('when a TS module uses import-equals-require, should be reported', () => {
    // given: TypeScript's CommonJS import form, which is not an `ImportDeclaration`
    withFixtureTree(
      {
        [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE,
        'src/cli/ts-cjs.ts': "import server = require('../services/mcp/server.js');\n"
      },
      (root) => {
        // when:  the tree is scanned
        const findings = scanForbiddenImports(root);
        // then:  the third spelling is not a loophole either
        expect(findings).toHaveLength(1);
        expect(findings[0]?.rule).toBe('mcp-source-import');
      }
    );
  });

  it('when require names a builtin or a package, should ignore it', () => {
    // given: requires that leave the repository, alongside one in-root require
    withFixtureTree(
      {
        [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE,
        'src/cli/outside.cjs':
          "const fs = require('node:fs');\nconst zod = require('zod');\nconst local = require('../services/mcp/server.js');\n"
      },
      (root) => {
        // when:  the tree is scanned
        const findings = scanForbiddenImports(root);
        // then:  only the in-repo specifier is an edge - the engine is not a regex
        expect(findings).toHaveLength(1);
      }
    );
  });

  it('when a require call sits inside a string literal, should not read it', () => {
    // given: the same AST discipline as the quoted-import arm, in the new form
    withFixtureTree(
      { 'src/cli/quoted.cjs': 'const planted = "require(\'../services/mcp/server.js\')";\n' },
      (root) => {
        // when:  the specifiers are read
        // then:  a quoted require is text, not an edge
        expect(specifiersOf(`${root}/src/cli/quoted.cjs`)).toEqual([]);
        expect(scanForbiddenImports(root)).toEqual([]);
      }
    );
  });
});

describe('Scenario: integration - the scan walks a real tree', () => {
  it('when the repository is walked, should find the source files the scan claims to cover', () => {
    // given: the working tree
    // when:  the walk runs over src/, scripts/ and tests/
    // then:  it finds many files, so a zero-finding verdict is a measurement rather than an empty set
    const files = sourceFilesUnder(REPO_ROOT);
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.endsWith('readonly-whitelist.ts'))).toBe(true);
  });

  it('when the declared MCP root is compared with itself, should only match paths beneath it', () => {
    // given: the declared root and three paths
    // when:  each is tested
    // then:  containment is a prefix relation on a path boundary, not a substring match
    expect(isInsideMcpRoot(`${MCP_SURFACE_ROOT_REL}/server.ts`)).toBe(true);
    expect(
      isInsideMcpRoot('src/services/recommendations/capability-seed-sources-mcp-server.ts')
    ).toBe(false);
    expect(isInsideMcpRoot('src/services/mcpfoo.ts')).toBe(false);
  });

  it('when the scan roots are read, should cover the CLI entry and every repo source root', () => {
    // given: the declared root set (QA repair cycle 1, P2: it used to be only
    //        src/scripts/tests, so an edge from the CLI ENTRY was invisible)
    // when:  the roots and the files they actually walk are read
    const files = walkedFiles();
    // then:  `bin` (the entry the proof launches) and `packages` (workspace
    //        sources) are covered, not merely documented as out of scope
    expect([...SCAN_ROOTS]).toEqual(['src', 'scripts', 'tests', 'bin', 'packages']);
    expect(files.includes('bin/peaks.js')).toBe(true);
    expect(files.some((file) => file.startsWith('packages/') && file.endsWith('.ts'))).toBe(true);
  });

  it('when a directory sits outside every scan root, should say so rather than assume it', () => {
    // The exclusions, asserted instead of implied. `config/` and the ROOT-level
    // `*.ts` tooling configs are outside every root, deliberately: they are
    // build/test configuration, not runtime modules. (Tooling config that lives
    // INSIDE a scanned root - `packages/*/vitest.config.ts` - is walked, because
    // the root is the source of truth, not the file name.)
    // when:  the walked files are read
    const files = walkedFiles();
    // then:  the excluded top level is absent, and the walk is non-trivial
    expect(files.some((file) => file.startsWith('config/'))).toBe(false);
    expect(
      files.some((file) => file === 'vitest.config.ts' || file === 'vitest.config.integration.ts')
    ).toBe(false);
    expect(files.length).toBeGreaterThan(100);
  });
});

// AC-8 clause 2 - "delete the MCP module and the tests stay green" - in a
// FALSIFIABLE form (QA repair cycle 1, P4).
//
// The literal claim is vacuously true in slice ①: `src/services/mcp` does not
// exist, so there is nothing to delete. Asserting its absence on the real tree
// would be the wrong repair - slice ② creates that module, and a guard that
// fails on the next slice is not a guard. What makes deletion safe is that the
// verdict is about inbound EDGES, never about the module file existing, and that
// property IS measurable here: the same tree scans identically with the module
// present and with it deleted, and one planted inbound edge is reported in BOTH.
//
// The injection that turns this red: rewrite the scan so the verdict depends on
// the module file existing (e.g. filter specifiers through `existsSync`). Then
// the deleted tree reports 0 while the present tree reports 1, the equality
// below fails, and the deletion claim is shown to be false.
describe('Scenario: behavior - deleting the declared MCP module cannot change the verdict', () => {
  const MCP_MODULE_FILES = { [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE };
  const UNRELATED = { 'src/cli/unrelated.ts': 'export const value = 1;\n' };
  const INBOUND_EDGE = { 'src/cli/user.ts': "import '../services/mcp/server.js';\n" };

  /** Scan one fixture tree and report the finding count. */
  function verdictOf(files: Readonly<Record<string, string>>): number {
    let count = -1;
    withFixtureTree(files, (root) => {
      count = scanForbiddenImports(root).length;
    });
    return count;
  }

  it('when the module is present and when it is deleted, should report the same verdict', () => {
    // given: one tree holding the declared MCP module and one with it deleted,
    //        both holding the same unrelated module
    // when:  each is scanned
    // then:  deleting the module changes nothing - the invariant is the EDGE
    expect(verdictOf({ ...MCP_MODULE_FILES, ...UNRELATED })).toBe(0);
    expect(verdictOf({ ...UNRELATED })).toBe(0);
  });

  it('when an inbound edge is planted in either tree, should report it in both', () => {
    // given: the same two trees, each now with one module importing the root
    // when:  each is scanned
    // then:  both report exactly one finding - so the two zeros above are the
    //        guard judging edges, not the guard being blind to a deleted root
    expect(verdictOf({ ...MCP_MODULE_FILES, ...UNRELATED, ...INBOUND_EDGE })).toBe(1);
    expect(verdictOf({ ...UNRELATED, ...INBOUND_EDGE })).toBe(1);
  });
});

describe('Scenario: a11y - a finding explains what to undo', () => {
  it('when a forbidden edge is reported, should name the file, the specifier and the rule', () => {
    // given: a planted MCP-source import
    withFixtureTree(
      {
        [`${MCP_SURFACE_ROOT_REL}/server.ts`]: MCP_SERVER_SOURCE,
        'src/cli/bridge.ts': "import { startServer } from '../services/mcp/server.js';\n"
      },
      (root) => {
        // when:  the finding is read
        const finding = scanForbiddenImports(root)[0];
        // then:  the message carries the file, the rule's reason and the declared root
        expect(finding?.message).toContain('src/cli/bridge.ts');
        expect(finding?.message).toContain(MCP_SURFACE_ROOT_REL);
        expect(finding?.message).toContain('deletable');
      }
    );
  });
});
