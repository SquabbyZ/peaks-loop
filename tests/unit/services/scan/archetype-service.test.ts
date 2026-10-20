import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { scanArchetype } from '../../../../src/services/scan/archetype-service.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

const ws = withTmpWorkspacePerTest('peaks-archetype-');

/**
 * Seed a minimal project fixture: a package.json carrying `deps`, plus
 * (optionally) an interface-doc file, a `bin` entry, and extra files.
 * Nothing else — no lockfile — so every input below is reproducible
 * byte-for-byte.
 */
function seedProject(
  args: {
    deps: Record<string, string>;
    interfaceDoc?: string;
    apiRoutes?: boolean;
    bin?: Record<string, string>;
    files?: Record<string, string>;
  },
  root = ws().path
): string {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      dependencies: args.deps,
      ...(args.bin === undefined ? {} : { bin: args.bin })
    }),
    'utf8'
  );
  for (const [relative, content] of Object.entries(args.files ?? {})) {
    const abs = join(root, relative);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  if (args.interfaceDoc !== undefined) {
    const abs = join(root, args.interfaceDoc);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '{"openapi":"3.0.0"}', 'utf8');
  }
  if (args.apiRoutes === true) {
    mkdirSync(join(root, 'pages', 'api'), { recursive: true });
    writeFileSync(
      join(root, 'pages', 'api', 'health.ts'),
      'export default function handler() {}\n',
      'utf8'
    );
  }
  return root;
}

describe('scanArchetype integration mode', () => {
  it('when a backend framework is present, should report full-stack', async () => {
    // given: a project whose package.json declares express
    const projectRoot = seedProject({ deps: { express: '^4.0.0' } });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: the integration mode is full-stack, with its own reason
    expect(report.integrationMode).toBe('full-stack');
    expect(report.integrationModeReason).toBe('backend-detected');
  });

  it('when no backend is present but an interface doc exists, should report prd-plus-interface-doc', async () => {
    // given: a frontend-only project that also carries a swagger.json
    const projectRoot = seedProject({ deps: { react: '^18.0.0' }, interfaceDoc: 'swagger.json' });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: the integration mode is prd-plus-interface-doc
    expect(report.integrationMode).toBe('prd-plus-interface-doc');
    expect(report.integrationModeReason).toBe('interface-doc-present');
  });

  it('when neither a backend nor an interface doc is present, should report prd-only', async () => {
    // given: a frontend-only project with no interface doc of any kind
    const projectRoot = seedProject({ deps: { react: '^18.0.0' } });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: the integration mode is prd-only
    expect(report.integrationMode).toBe('prd-only');
    expect(report.integrationModeReason).toBe('no-backend-no-interface-doc');
  });

  it('when Next API routes exist without a backend framework dependency, should report full-stack', async () => {
    // given: a Next project whose only backend surface is pages/api — `next` is
    // deliberately absent from `detected.backendFrameworks`, so a
    // framework-only predicate would wrongly call this prd-only
    const projectRoot = seedProject({ deps: { next: '^14.0.0' }, apiRoutes: true });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: the mode agrees with the archetype the same report just computed
    expect(report.archetype).toBe('legacy-fullstack');
    expect(report.integrationMode).toBe('full-stack');
  });
});

describe('scanArchetype frontendOnly back-compat', () => {
  it('when a backend framework is present, should keep frontendOnly byte-identical', async () => {
    // given: the express fixture
    const projectRoot = seedProject({ deps: { express: '^4.0.0' } });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: the pre-slice boolean and its reason are unchanged
    expect(report.frontendOnly).toBe(false);
    expect(report.frontendOnlyReason).toBe('backend-detected');
  });

  it('when an interface doc exists without a backend, should keep frontendOnly byte-identical', async () => {
    // given: the react + swagger.json fixture
    const projectRoot = seedProject({ deps: { react: '^18.0.0' }, interfaceDoc: 'swagger.json' });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: the pre-slice boolean and its reason are unchanged
    expect(report.frontendOnly).toBe(false);
    expect(report.frontendOnlyReason).toBe('swagger-or-proto-present');
  });

  it('when no backend or interface doc is present but a framework dep is, should keep frontendOnly true and name the evidence', async () => {
    // given: the bare react fixture
    const projectRoot = seedProject({ deps: { react: '^18.0.0' } });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: the boolean is unchanged, and its reason now says what it saw
    expect(report.frontendOnly).toBe(true);
    expect(report.frontendOnlyReason).toBe('frontend-evidence=react');
  });

  it('when the same repository state is scanned twice, should return the same integration mode', async () => {
    // given: one fixture scanned by two independent calls
    const projectRoot = seedProject({ deps: { react: '^18.0.0' } });
    // when: the archetype scan runs twice
    const first = await scanArchetype({ projectRoot });
    const second = await scanArchetype({ projectRoot });
    // then: the mode is a pure function of the repo state, not of judgement
    expect(second.integrationMode).toBe(first.integrationMode);
    expect(second.integrationModeReason).toBe(first.integrationModeReason);
  });
});

describe('scanArchetype positive frontend evidence', () => {
  it('when a repository has JS/TS only, should not report frontendOnly', async () => {
    // given: a TypeScript library with no CSS, HTML, or frontend dependency
    const projectRoot = seedProject({
      deps: { typescript: '^5.0.0' },
      files: { 'src/index.ts': 'export const x = 1;\n' }
    });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: "not a backend" is not frontend evidence
    expect(report.frontendOnly).toBe(false);
    expect(report.frontendOnlyReason).toBe('no-frontend-evidence');
    expect(report.detected.frontendEvidence).toBeNull();
  });

  it('when a stylesheet sits under src/, should report frontendOnly with the evidence class', async () => {
    // given: a TypeScript project whose only frontend asset is a stylesheet
    const projectRoot = seedProject({
      deps: { typescript: '^5.0.0' },
      files: { 'src/styles.css': 'body { margin: 0; }\n' }
    });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: the file is positive evidence, and the reason names it
    expect(report.frontendOnly).toBe(true);
    expect(report.frontendOnlyReason).toBe('frontend-evidence=asset-under-src');
  });

  it('when only an HTML or only a .vue asset sits under src/, should name both asset-under-src', async () => {
    // given: two fixtures — one whose only asset is src/index.html, one .vue
    const htmlRoot = seedProject(
      { deps: { typescript: '^5.0.0' }, files: { 'src/index.html': '<p>hi</p>\n' } },
      join(ws().path, 'html-only')
    );
    const vueRoot = seedProject(
      { deps: { typescript: '^5.0.0' }, files: { 'src/App.vue': '<template></template>\n' } },
      join(ws().path, 'vue-only')
    );
    // when: each project is scanned on its own
    const html = await scanArchetype({ projectRoot: htmlRoot });
    const vue = await scanArchetype({ projectRoot: vueRoot });
    // then: the class names the asset family, so both inputs agree
    expect(html.frontendOnlyReason).toBe('frontend-evidence=asset-under-src');
    expect(vue.frontendOnlyReason).toBe('frontend-evidence=asset-under-src');
  });

  it('when a CSS-adjacent dependency is declared, should report frontendOnly with the dependency name', async () => {
    // given: a TypeScript project whose only frontend signal is Tailwind
    const projectRoot = seedProject({
      deps: { typescript: '^5.0.0', tailwindcss: '^3.0.0' }
    });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: a style dependency is positive evidence
    expect(report.frontendOnly).toBe(true);
    expect(report.frontendOnlyReason).toBe('frontend-evidence=tailwindcss');
  });

  it('when a published CLI has no frontend evidence, should report archetype cli and frontendOnly false', async () => {
    // given: a monorepo CLI — the shape this repository itself has
    const projectRoot = seedProject({
      deps: { typescript: '^5.0.0' },
      bin: { peaks: './bin/peaks.js' },
      files: {
        'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
        'src/cli/index.ts': 'export const x = 1;\n'
      }
    });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: the monorepo branch does not swallow it, and the boolean is false
    expect(report.archetype).toBe('cli');
    expect(report.frontendOnly).toBe(false);
    expect(report.frontendOnlyReason).toBe('archetype=cli');
  });

  it('when a stylesheet exists only under examples/, should not count it as evidence', async () => {
    // given: a TypeScript project with a demo stylesheet outside app roots
    const projectRoot = seedProject({
      deps: { typescript: '^5.0.0' },
      files: { 'examples/video-demo/src/styles.css': 'body {}\n' }
    });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: the walk is scoped to application roots
    expect(report.frontendOnly).toBe(false);
    expect(report.frontendOnlyReason).toBe('no-frontend-evidence');
  });

  it('when stylesheets live only in generated trees, should not count them as evidence', async () => {
    // given: styles under node_modules and dist — installed or built output
    const projectRoot = seedProject({
      deps: { typescript: '^5.0.0' },
      files: {
        'src/node_modules/pkg/styles.css': 'body {}\n',
        'src/dist/app.css': 'body {}\n'
      }
    });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: neither generated tree is the project's own surface
    expect(report.frontendOnly).toBe(false);
    expect(report.frontendOnlyReason).toBe('no-frontend-evidence');
  });
});
