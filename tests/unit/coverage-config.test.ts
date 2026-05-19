import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const vitestConfigPath = resolve('vitest.config.ts');

describe('coverage configuration', () => {
  test('keeps 100 percent thresholds for included modules', async () => {
    const source = await readFile(vitestConfigPath, 'utf8');

    expect(source).toContain('lines: 100');
    expect(source).toContain('functions: 100');
    expect(source).toContain('branches: 100');
    expect(source).toContain('statements: 100');
  });

  test('normalizes Windows coverage root without disabling included-file coverage', async () => {
    const source = await readFile(vitestConfigPath, 'utf8');

    expect(source).toContain('root: stableCoverageRoot');
    expect(source).toContain("process.platform === 'win32'");
    expect(source).toContain('toLowerCase()');
    expect(source).not.toContain('all: false');
  });
});
