// tests/unit/services/distribution/plugin-manifest-prettier-clean.test.ts
//
// The prettier-clean guard for the GENERATED distribution manifest
// (PRD rid-t6b-plugin-manifest-prettier-clean — AC-1, AC-2, AC-5).
//
//   AC-1  the committed `.claude-plugin/marketplace.json` is prettier-clean under
//         the config that RESOLVES for that path — not a hard-coded default.
//   AC-2  this file is the thing that keeps it so. A check that cannot fail is not
//         a check, so the pre-slice shape is shown to be reported as NOT clean.
//   AC-5  the render's layout rule is GENERAL: an array that fits is collapsed and
//         an array too wide stays expanded — proved on a synthetic manifest that
//         holds arrays the committed artifact does not have.
//
// WHY THE REAL PRETTIER IS USED HERE AND NOT IN THE RENDERER. `prettier` is a
// devDependency, and the root `package.json#files` allowlist names `dist/**/*.js`,
// so the renderer ships to consumers and must not depend on a package the published
// manifest does not declare. A TEST is not published: so the renderer computes the
// shape, and prettier — the independent judge — is asked whether that shape is
// clean. The two never meet in the same module.
//
// Dimensions covered: render, behavior, integration, a11y.

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import { repoRoot } from 'peaks-loop-shared/paths';

import { renderJsonDocument } from '~/src/services/distribution/json-layout';
import {
  pluginManifestPath,
  renderPluginManifest,
  repositoryJsonLayout
} from '~/src/services/distribution/plugin-manifest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/distribution/plugin-manifest-prettier-clean.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const MANIFEST_PATH = pluginManifestPath();

/** The config that RESOLVES for the artifact's own path — never a literal default. */
async function resolvedConfig(): Promise<prettier.Options> {
  const config = await prettier.resolveConfig(MANIFEST_PATH);
  if (config === null) {
    throw new Error(`no prettier config resolves for ${MANIFEST_PATH}`);
  }
  return config;
}

/** The committed artifact, as text. */
function committed(): string {
  return readFileSync(MANIFEST_PATH, 'utf8');
}

/**
 * A manifest that is NOT the committed one, and that carries array shapes the
 * committed artifact does not have: a short array, an array too wide for the print
 * width, and an array of records.
 */
const SYNTHETIC_MANIFEST = {
  metadata: { pluginRoot: '.', version: '9.9.9' },
  plugins: [
    {
      name: 'synthetic',
      keywords: ['alpha', 'beta'],
      mcpServers: { peaks: { command: 'peaks', args: ['mcp', 'serve'] } },
      longList: [
        'alpha-bravo-charlie-delta-echo-foxtrot',
        'golf-hotel-india-juliett-kilo-lima-mike',
        'november-oscar-papa-quebec-romeo-sierra'
      ],
      records: [
        { name: 'one', path: './one' },
        { name: 'two', path: './two' }
      ]
    }
  ]
};

describe('Scenario: render - the committed artifact is prettier-clean', () => {
  it('when the committed manifest is checked with the config resolved for its path, should be clean', async () => {
    // given: the artifact committed in `.claude-plugin/`
    // when:  it is checked with the config that resolves for that path
    // then:  prettier reports it as already formatted, so `prettier --check` exits 0
    const config = await resolvedConfig();
    expect(await prettier.check(committed(), { ...config, filepath: MANIFEST_PATH })).toBe(true);
  });

  it('when a fresh render is formatted again by prettier, should come back unchanged', async () => {
    // given: a fresh render from the two sources
    // when:  prettier formats that render again
    // then:  the bytes are unchanged — the render is a FIXED POINT of prettier, which
    //        is what makes the artifact clean by construction rather than by luck
    const config = await resolvedConfig();
    const text = await renderPluginManifest();
    expect(await prettier.format(text, { ...config, filepath: MANIFEST_PATH })).toBe(text);
  });
});

describe('Scenario: behavior - the layout rule is general, not one special array', () => {
  it('when a manifest carries a short array, should render that array on one line', () => {
    // given: a manifest carrying an array of two short words
    // when:  it is rendered
    // then:  the array is on ONE line — the rule is "an array that fits is collapsed",
    //        and it is the rule, not the literal `"mcp", "serve"`, that decided it
    const text = renderJsonDocument({ list: ['alpha', 'beta'] }, { printWidth: 100, tabWidth: 2 });
    expect(text).toContain('"list": ["alpha", "beta"]');
  });

  it('when a manifest carries an array too wide for the print width, should keep it expanded', () => {
    // given: a manifest carrying an array whose inline form cannot fit the width
    // when:  it is rendered
    // then:  the array stays one element per line, and never appears inline
    const long = 'a'.repeat(40);
    const text = renderJsonDocument(
      { list: Array.from({ length: 5 }, () => long) },
      { printWidth: 100, tabWidth: 2 }
    );
    expect(text).toContain('"list": [\n');
    expect(text).not.toContain('"list": ["');
  });

  it('when a synthetic manifest is rendered, should be clean under the repository config', async () => {
    // given: a synthetic manifest holding a short array, a too-wide array and an
    //        array of records — none of which the committed artifact has
    // when:  it is rendered with the repository's own layout and prettier is asked
    // then:  prettier reports the render as clean, so the rule holds beyond today's
    //        single array
    const config = await resolvedConfig();
    const rendered = renderJsonDocument(SYNTHETIC_MANIFEST, repositoryJsonLayout());
    expect(await prettier.check(rendered, { ...config, filepath: MANIFEST_PATH })).toBe(true);
  });

  it('when a synthetic manifest is rendered, should collapse its short array and expand its wide ones', () => {
    // given: the same synthetic manifest
    // when:  it is rendered
    // then:  the short array is inline, and the wide array and the array of records
    //        are one element per line
    const rendered = renderJsonDocument(SYNTHETIC_MANIFEST, repositoryJsonLayout());
    expect(rendered).toContain('"keywords": ["alpha", "beta"]');
    expect(rendered).toContain('"longList": [\n');
    expect(rendered).toContain('"records": [\n');
  });
});

describe('Scenario: integration - the config is the repository one, and the package stays dependency-free', () => {
  it('when the config is resolved for the artifact path, should be the repository prettier config', async () => {
    // given: the repository's own prettier config, in the root package.json
    // when:  the config that resolves for the artifact's path is read
    // then:  it carries that config's values — the check uses the repository's
    //        configuration, not a hard-coded default
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      prettier?: Record<string, unknown>;
    };
    const config = await resolvedConfig();
    expect(config).toMatchObject(pkg.prettier ?? {});
  });

  it('when every module under src is scanned, should find no static import of prettier', () => {
    // given: the modules that are compiled into the published `dist/**`
    // when:  each one is scanned for a STATIC `import … from 'prettier'`
    // then:  there is none — `prettier` is a devDependency and the published
    //        package's dependency set must not change
    expect(staticPrettierImports(repoRoot)).toEqual([]);
  });
});

describe('Scenario: a11y - a check that cannot fail is not a check', () => {
  it('when a manifest is written with every array expanded, should report it as not clean', async () => {
    // given: a manifest written the way the PRE-SLICE renderer wrote it — every
    //        array expanded, one element per line, which is what
    //        `JSON.stringify(…, null, 2)` produces
    // when:  prettier is asked about that shape
    // then:  prettier reports it as NOT clean, so the guard above is a real guard
    //        and not a rubber stamp
    const config = await resolvedConfig();
    const expanded = `${JSON.stringify({ list: ['alpha', 'beta'] }, null, 2)}\n`;
    expect(await prettier.check(expanded, { ...config, filepath: MANIFEST_PATH })).toBe(false);
  });

  it('when the committed artifact is compared with the pre-slice serialization, should differ', async () => {
    // given: the committed artifact, and the same content serialized the pre-slice way
    // when:  the two are compared
    // then:  they differ — the committed bytes are the COLLAPSED shape, and the
    //        expanded one is the shape the guard above rejects
    const expanded = `${JSON.stringify(JSON.parse(committed()), null, 2)}\n`;
    expect(expanded).not.toBe(committed());
    expect(await renderPluginManifest()).toBe(committed());
  });
});

/**
 * Every module under `src/` that STATICALLY imports `prettier`.
 *
 * A dynamic `await import('prettier')` is deliberately NOT matched: it is not a
 * static edge, and the guard is about the dependency a published package would
 * declare. The pattern requires whitespace after `import`, so `import('prettier')`
 * does not match it.
 */
function staticPrettierImports(root: string): string[] {
  const pattern = /(^|\n)\s*import\s+(?:[^;]*?\sfrom\s+)?['"]prettier['"]/;
  const hits: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(child);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      if (pattern.test(readFileSync(child, 'utf8'))) {
        hits.push(relative(root, child).split('\\').join('/'));
      }
    }
  };
  visit(join(root, 'src'));
  return hits;
}
