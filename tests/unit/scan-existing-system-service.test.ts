import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { scanExistingSystem } from '../../src/services/scan/existing-system-service.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-scan-existing-'));
}

async function writePkg(project: string, body: Record<string, unknown>): Promise<void> {
  await writeFile(join(project, 'package.json'), JSON.stringify(body, null, 2), 'utf8');
}

async function writeLockfile(project: string): Promise<void> {
  await writeFile(join(project, 'pnpm-lock.yaml'), 'lockfileVersion: "6.0"\n', 'utf8');
}

async function writeManySrcFiles(project: string, count: number): Promise<void> {
  const dir = join(project, 'src');
  await mkdir(dir, { recursive: true });
  for (let i = 0; i < count; i += 1) {
    await writeFile(join(dir, `f-${i}.tsx`), 'export const x = 1;', 'utf8');
  }
}

describe('scanExistingSystem', () => {
  test('skips extraction for greenfield projects', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18' } });
    await writeLockfile(project);
    const report = await scanExistingSystem({ projectRoot: project });
    expect(report.scanned).toBe(false);
    expect(report.scanSkippedReason).toContain('greenfield');
  });

  test('extracts Less variables and classifies them by category', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18', antd: '^5' } });
    await writeManySrcFiles(project, 25);
    await writeLockfile(project);
    await mkdir(join(project, 'src/styles'), { recursive: true });
    await writeFile(
      join(project, 'src/styles/theme.less'),
      ['@primary-color: #1677ff;', '@error-color: #ff4d4f;', '@font-size-base: 14px;', '@border-radius-base: 6px;', '@padding-lg: 24px;'].join('\n'),
      'utf8'
    );
    const report = await scanExistingSystem({ projectRoot: project });
    expect(report.scanned).toBe(true);
    expect(report.visualTokens.colors.find((token) => token.name === 'primary-color')?.value).toBe('#1677ff');
    expect(report.visualTokens.colors.find((token) => token.name === 'error-color')).toBeDefined();
    expect(report.visualTokens.typography.find((token) => token.name === 'font-size-base')).toBeDefined();
    expect(report.visualTokens.radii.find((token) => token.name === 'border-radius-base')).toBeDefined();
    expect(report.visualTokens.spacing.find((token) => token.name === 'padding-lg')).toBeDefined();
    expect(report.visualTokens.sources.some((source) => source.kind === 'less-vars')).toBe(true);
  });

  test('detects PascalCase component naming convention', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18' } });
    await writeManySrcFiles(project, 25);
    await writeLockfile(project);
    await mkdir(join(project, 'src/components'), { recursive: true });
    await writeFile(join(project, 'src/components/UserCard.tsx'), 'export const X = 1;', 'utf8');
    await writeFile(join(project, 'src/components/OrderList.tsx'), 'export const X = 1;', 'utf8');
    const report = await scanExistingSystem({ projectRoot: project });
    expect(report.scanned).toBe(true);
    expect(report.conventions.componentNaming).toBe('PascalCase');
    expect(report.conventions.componentDir).toBe('src/components');
    expect(report.conventions.samples.some((sample) => sample.kind === 'component')).toBe(true);
  });

  test('reports inconsistencies when same token name has different values', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18' } });
    await writeManySrcFiles(project, 25);
    await writeLockfile(project);
    await mkdir(join(project, 'src/styles'), { recursive: true });
    await writeFile(join(project, 'src/styles/a.less'), '@primary-color: #1677ff;\n', 'utf8');
    await writeFile(join(project, 'src/styles/b.less'), '@primary-color: #0052cc;\n', 'utf8');
    const report = await scanExistingSystem({ projectRoot: project });
    expect(report.inconsistencies.some((issue) => issue.includes('primary-color'))).toBe(true);
  });
});

  test('extracts tailwind config tokens', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18', tailwindcss: '^3' } });
    await writeManySrcFiles(project, 25);
    await writeLockfile(project);
    await writeFile(join(project, 'tailwind.config.js'), 'module.exports = { theme: { extend: { colors: { primary: "#1677ff" } } } };', 'utf8');
    const report = await scanExistingSystem({ projectRoot: project });
    expect(report.scanned).toBe(true);
    expect(report.visualTokens.sources.some(s => s.kind === 'tailwind-config')).toBe(true);
  });

  test('detects kebab-case component naming', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18' } });
    await writeManySrcFiles(project, 25);
    await writeLockfile(project);
    await mkdir(join(project, 'src/components'), { recursive: true });
    await writeFile(join(project, 'src/components/user-card.tsx'), 'export const X = 1;', 'utf8');
    await writeFile(join(project, 'src/components/order-list.tsx'), 'export const X = 1;', 'utf8');
    const report = await scanExistingSystem({ projectRoot: project });
    expect(report.scanned).toBe(true);
    expect(report.conventions.componentNaming).toBe('kebab-case');
  });

  test('detects service and hook directories', async () => {
    const project = await makeProject();
    await writePkg(project, { dependencies: { react: '^18' } });
    await writeManySrcFiles(project, 25);
    await writeLockfile(project);
    await mkdir(join(project, 'src/services'), { recursive: true });
    await writeFile(join(project, 'src/services/api.ts'), 'export const api = {};', 'utf8');
    await mkdir(join(project, 'src/hooks'), { recursive: true });
    await writeFile(join(project, 'src/hooks/useData.ts'), 'export const useData = () => {};', 'utf8');
    const report = await scanExistingSystem({ projectRoot: project });
    expect(report.scanned).toBe(true);
    expect(report.conventions.serviceDir).toBe('src/services');
    expect(report.conventions.hookDir).toBe('src/hooks');
    expect(report.conventions.samples.some(s => s.kind === 'service')).toBe(true);
    expect(report.conventions.samples.some(s => s.kind === 'hook')).toBe(true);
  });
