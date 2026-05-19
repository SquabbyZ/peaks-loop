import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const packagePath = resolve('package.json');
const binPath = resolve('bin', 'peaks.js');
const tsconfigPath = resolve('tsconfig.json');

describe('package publishing configuration', () => {
  test('publishes the CLI bin and its compiled entrypoint', async () => {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      bin: { peaks: string };
      files: string[];
      scripts: { build: string; prepack: string; postinstall: string; dev: string; 'dev:watch': string };
    };
    const binSource = await readFile(binPath, 'utf8');

    expect(packageJson.bin.peaks).toBe('./bin/peaks.js');
    expect(packageJson.files).toContain('bin/peaks.js');
    expect(packageJson.files).toContain('dist/src/cli/index.js');
    expect(packageJson.files).toContain('scripts/clean-dist.mjs');
    expect(packageJson.files).toContain('scripts/install-skills.mjs');
    expect(packageJson.files).toContain('scripts/watch.mjs');
    expect(packageJson.files).toContain('skills/**');
    expect(packageJson.scripts.build).toBe('node ./scripts/clean-dist.mjs && tsc -p tsconfig.json');
    expect(packageJson.scripts.prepack).toBe('npm run build');
    expect(packageJson.scripts.postinstall).toBe('node ./scripts/install-skills.mjs');
    expect(packageJson.scripts.dev).toBe('tsx src/cli/index.ts');
    expect(packageJson.scripts['dev:watch']).toBe('node ./scripts/watch.mjs');
    expect(binSource).toContain("../dist/src/cli/index.js");
  });

  test('does not publish production sourcemaps', async () => {
    const tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8')) as {
      compilerOptions: { sourceMap?: boolean; declarationMap?: boolean; inlineSources?: boolean };
    };

    expect(tsconfig.compilerOptions.sourceMap).toBe(false);
    expect(tsconfig.compilerOptions.declarationMap).not.toBe(true);
    expect(tsconfig.compilerOptions.inlineSources).not.toBe(true);
  });
});
