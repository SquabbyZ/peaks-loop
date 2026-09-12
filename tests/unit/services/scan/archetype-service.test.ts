import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { scanArchetype } from '../../../../src/services/scan/archetype-service.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

const ws = withTmpWorkspacePerTest('peaks-archetype-');

/**
 * Seed a minimal project fixture: a package.json carrying `deps`, plus
 * (optionally) an interface-doc file. Nothing else — no `src/`, no
 * lockfile — so every input below is reproducible byte-for-byte.
 */
function seedProject(args: { deps: Record<string, string>; interfaceDoc?: string; apiRoutes?: boolean }): string {
  const root = ws().path;
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: args.deps }), 'utf8');
  if (args.interfaceDoc !== undefined) {
    const abs = join(root, args.interfaceDoc);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, '{"openapi":"3.0.0"}', 'utf8');
  }
  if (args.apiRoutes === true) {
    mkdirSync(join(root, 'pages', 'api'), { recursive: true });
    writeFileSync(join(root, 'pages', 'api', 'health.ts'), 'export default function handler() {}\n', 'utf8');
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

  it('when neither is present, should keep frontendOnly byte-identical', async () => {
    // given: the bare react fixture
    const projectRoot = seedProject({ deps: { react: '^18.0.0' } });
    // when: the archetype scan runs
    const report = await scanArchetype({ projectRoot });
    // then: the pre-slice boolean and its reason are unchanged
    expect(report.frontendOnly).toBe(true);
    expect(report.frontendOnlyReason).toBe('no-backend-no-swagger');
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
