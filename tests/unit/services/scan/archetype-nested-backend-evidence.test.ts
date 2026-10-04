import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { scanArchetype } from '../../../../src/services/scan/archetype-service.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

const ws = withTmpWorkspacePerTest('peaks-archetype-nested-');

function writeFile(abs: string, content: string): void {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function seedRootPackage(deps: Record<string, string>): string {
  const root = ws().path;
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', dependencies: deps }),
    'utf8'
  );
  return root;
}

/**
 * The defect these cases exist for: every probe in the detector read Node's
 * ROOT manifest, so a repository whose backend is Go / Java / Python, or sits
 * in a workspace package, or is a Next server action, was reported
 * `frontendOnly: true` with reason `no-backend-no-swagger`. A false answer
 * there routed the workflow as if there were no system to integrate with.
 *
 * Each case therefore asserts the named EVIDENCE too, not only the flipped
 * boolean — a verdict that cannot say what it saw is the other half of the
 * same complaint.
 */
describe('scanArchetype nested backend evidence', () => {
  it('when a Go service sits beside the frontend, should report a backend and name go.mod', async () => {
    // given: a Vite frontend plus a root Go module
    const root = seedRootPackage({ react: '^18.0.0', vite: '^5.0.0' });
    writeFile(join(root, 'go.mod'), 'module example.com/app\n\ngo 1.22\n');
    writeFile(join(root, 'cmd/server/main.go'), 'package main\n');
    // when
    const report = await scanArchetype({ projectRoot: root });
    // then
    expect(report.frontendOnly).toBe(false);
    expect(report.integrationMode).toBe('full-stack');
    expect(report.detected.nestedServiceEvidence).toContain('go.mod');
  });

  it('when a Maven project carries the service, should report a backend and name pom.xml', async () => {
    // given
    const root = seedRootPackage({ vue: '^3.0.0' });
    writeFile(join(root, 'pom.xml'), '<project></project>');
    writeFile(join(root, 'src/main/java/com/acme/App.java'), 'package com.acme;\n');
    // when
    const report = await scanArchetype({ projectRoot: root });
    // then
    expect(report.frontendOnly).toBe(false);
    expect(report.detected.nestedServiceEvidence).toContain('pom.xml');
  });

  it('when a Python web framework is declared two levels down, should name the path and the framework', async () => {
    // given: `services/checkout` is not one of the seven hard-coded backend
    // dir names, so the directory probe could never see it
    const root = seedRootPackage({ react: '^18.0.0' });
    writeFile(join(root, 'services/checkout/requirements.txt'), 'fastapi==0.110\nuvicorn\n');
    // when
    const report = await scanArchetype({ projectRoot: root });
    // then
    expect(report.frontendOnly).toBe(false);
    expect(report.detected.nestedServiceEvidence.join(',')).toMatch(
      /services\/checkout\/requirements\.txt \(fastapi\)/
    );
  });

  it('when a shared manifest names no web framework, should stay frontend-only', async () => {
    // given: requirements.txt is also what a test harness or a CLI writes, so
    // it counts only when the file itself names a server
    const root = seedRootPackage({ react: '^18.0.0' });
    writeFile(join(root, 'services/reporter/requirements.txt'), 'pytest\nruff\n');
    // when
    const report = await scanArchetype({ projectRoot: root });
    // then: the content gate holds, and the fix is not "everything has a backend"
    expect(report.frontendOnly).toBe(true);
    expect(report.detected.nestedServiceEvidence).toEqual([]);
  });

  it('when a workspace package declares a backend framework, should name the package and the dep', async () => {
    // given: the ROOT manifest carries no express — reading it alone is how an
    // `apps/gateway` service became `frontend-monorepo`
    const root = seedRootPackage({});
    writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n');
    writeFile(
      join(root, 'apps/gateway/package.json'),
      JSON.stringify({ name: 'gateway', dependencies: { express: '^4.0.0' } })
    );
    writeFile(join(root, 'apps/web/package.json'), JSON.stringify({ name: 'web' }));
    // when
    const report = await scanArchetype({ projectRoot: root });
    // then
    expect(report.frontendOnly).toBe(false);
    expect(report.archetype).toBe('fullstack-monorepo');
    expect(report.detected.nestedServiceEvidence).toContain('apps/gateway: express');
  });

  it('when a Next app mutates through server actions with no api directory, should report a backend', async () => {
    // given: `pages/api` / `app/api` were the only Next backend recognised
    const root = seedRootPackage({ next: '^14.0.0', react: '^18.0.0' });
    writeFile(
      join(root, 'app/dashboard/actions.ts'),
      "'use server';\nexport async function save() {}\n"
    );
    writeFile(
      join(root, 'app/dashboard/page.tsx'),
      'export default function Page() { return null }\n'
    );
    // when
    const report = await scanArchetype({ projectRoot: root });
    // then
    expect(report.detected.hasNextServerActions).toBe(true);
    expect(report.frontendOnly).toBe(false);
    expect(report.integrationMode).toBe('full-stack');
  });

  it('when a dependency tree carries a Go module, should not read node_modules as a service', async () => {
    // given: an installed package's manifest is not the project's architecture
    const root = seedRootPackage({ react: '^18.0.0' });
    writeFile(join(root, 'node_modules/some-package/go.mod'), 'module example.com/dep\n');
    // when
    const report = await scanArchetype({ projectRoot: root });
    // then
    expect(report.frontendOnly).toBe(true);
    expect(report.detected.nestedServiceEvidence).toEqual([]);
  });

  it('when any nested evidence exists, should never split the report against itself', async () => {
    // given: one fixture, three decision functions reading it
    const root = seedRootPackage({ react: '^18.0.0' });
    writeFile(join(root, 'go.mod'), 'module example.com/app\n');
    // when
    const report = await scanArchetype({ projectRoot: root });
    // then: `decideArchetype`, `decideFrontendOnly` and `decideIntegrationMode`
    // all answer from `hasBackendEvidence`, so the boolean and the mode cannot
    // disagree about whether this repository has a backend.
    expect(report.frontendOnly).toBe(false);
    expect(report.integrationMode).toBe('full-stack');
    expect(report.signals.find((signal) => signal.name === 'backend-presence')?.matched).toBe(true);
  });
});
