import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { scanArchetype } from '../../src/services/scan/archetype-service.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-scan-archetype-'));
}

async function writePkg(project: string, body: Record<string, unknown>): Promise<void> {
  await writeFile(join(project, 'package.json'), JSON.stringify(body, null, 2), 'utf8');
}

async function writeLockfile(project: string, name = 'pnpm-lock.yaml'): Promise<void> {
  await writeFile(join(project, name), 'lockfileVersion: "6.0"\n', 'utf8');
}

async function writeManySrcFiles(project: string, count: number): Promise<void> {
  const dir = join(project, 'src');
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < count; i += 1) {
    await writeFile(join(dir, `component-${i}.tsx`), 'export const x = 1;', 'utf8');
  }
}

describe('scanArchetype', () => {
  test('returns unknown when package.json is missing', async () => {
    const project = await makeProject();
    const report = await scanArchetype({ projectRoot: project });
    expect(report.archetype).toBe('unknown');
    expect(report.detected.hasPackageJson).toBe(false);
  });

  test('detects legacy-fullstack when backend framework + many src files', async () => {
    const project = await makeProject();
    await writePkg(project, {
      dependencies: { express: '^4', react: '^18' }
    });
    await writeManySrcFiles(project, 25);
    const report = await scanArchetype({ projectRoot: project });
    expect(report.archetype).toBe('legacy-fullstack');
    expect(report.detected.hasBackendFramework).toBe(true);
    expect(report.frontendOnly).toBe(false);
  });

  test('detects legacy-frontend when no backend + many src files + no swagger', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18', antd: '^5' } });
    await writeManySrcFiles(project, 30);
    await writeLockfile(project); const { utimesSync } = require("fs"); utimesSync(join(project, "pnpm-lock.yaml"), Date.now()/1000, (Date.now()-60*86400000)/1000);
    const report = await scanArchetype({ projectRoot: project });
    expect(report.archetype).toBe('legacy-frontend');
    expect(report.frontendOnly).toBe(true);
    expect(report.frontendOnlyReason).toContain('archetype=legacy-frontend');
  });

  test('detects frontend-monorepo when monorepo config exists and no backend', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18' } });
    await writeFile(join(project, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n", 'utf8');
    const report = await scanArchetype({ projectRoot: project });
    expect(report.archetype).toBe('frontend-monorepo');
    expect(report.frontendOnly).toBe(true);
  });

  test('detects greenfield when src is empty and lockfile is fresh', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18' } });
    await writeLockfile(project);
    const report = await scanArchetype({ projectRoot: project });
    expect(report.archetype).toBe('greenfield');
  });

  test('classifies as legacy-fullstack when Next.js with API routes present', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { next: '^14', react: '^18' } });
    await mkdir(join(project, 'pages/api'), { recursive: true });
    await writeFile(join(project, 'pages/api/health.ts'), 'export default () => {};', 'utf8');
    await writeManySrcFiles(project, 25);
    const report = await scanArchetype({ projectRoot: project });
    expect(report.detected.hasNextApiRoutes).toBe(true);
    expect(report.archetype).toBe('legacy-fullstack');
  });

  test('marks frontendOnly=false when swagger.json is present even without backend deps', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18' } });
    await writeFile(join(project, 'swagger.json'), '{}', 'utf8');
    const report = await scanArchetype({ projectRoot: project });
    expect(report.detected.hasSwaggerOrProto).toBe(true);
    expect(report.frontendOnly).toBe(false);
  });

  test('detects legacy-fullstack with medium confidence when backend exists but few src files', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { express: '^4', react: '^18' } });
    await writeLockfile(project);
    await writeManySrcFiles(project, 5);
    const report = await scanArchetype({ projectRoot: project });
    expect(report.archetype).toBe('legacy-fullstack');
    expect(report.confidence).toBe('medium');
  });

  test('returns unknown when no backend, has swagger, few src files, old lockfile', async () => {
    const project = await makeProject();
    await writeFile(join(project, 'swagger.json'), '{}', 'utf8');
    await writeLockfile(project);
    const { utimesSync } = require('fs');
    utimesSync(join(project, 'pnpm-lock.yaml'), Date.now()/1000, (Date.now() - 60*86400000)/1000);
    await writePkg(project, { dependencies: { react: '^18' } });
    const report = await scanArchetype({ projectRoot: project });
    expect(report.archetype).toBe('unknown');
    expect(report.confidence).toBe('low');
  });
});

  test('counts source files in nested directories', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18' } });
    await writeLockfile(project);
    // Create nested dirs with source files
    const nested = join(project, 'src', 'components', 'ui');
    await mkdir(nested, { recursive: true });
    await writeFile(join(project, 'src', 'app.tsx'), 'export const App = () => null;', 'utf8');
    await writeFile(join(project, 'src', 'components', 'Button.tsx'), 'export const B = 1;', 'utf8');
    await writeFile(join(nested, 'Card.tsx'), 'export const C = 1;', 'utf8');
    const report = await scanArchetype({ projectRoot: project });
    expect(report.detected.srcFileCount).toBe(3);
  });

  test('detects backend directory when server dir exists', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18' } });
    await mkdir(join(project, 'server'), { recursive: true });
    await writeFile(join(project, 'server', 'index.ts'), 'export {}', 'utf8');
    await writeLockfile(project);
    const report = await scanArchetype({ projectRoot: project });
    expect(report.detected.backendDirsPresent).toContain('server');
  });

  test('detects proto directory as swagger/proto signal', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18' } });
    await mkdir(join(project, 'proto'), { recursive: true });
    await writeFile(join(project, 'proto', 'service.proto'), 'syntax = "proto3";', 'utf8');
    await writeLockfile(project);
    const report = await scanArchetype({ projectRoot: project });
    expect(report.detected.hasSwaggerOrProto).toBe(true);
    expect(report.detected.swaggerPaths).toContain('proto/');
  });
