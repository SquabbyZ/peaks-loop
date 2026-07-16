import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

const packagePath = resolve('package.json');
const binPath = resolve('bin', 'peaks.js');
const tsconfigPath = resolve('tsconfig.json');
const versionPath = resolve('src', 'shared', 'version.ts');

beforeAll(() => {
  // Slice 2026-06-26 W8-b: keep `src/shared/version.ts` in lockstep with
  // `package.json#version` so the assertion below is deterministic without
  // requiring `pnpm build` (which would otherwise be the only thing that
  // invokes `scripts/sync-version.mjs`).
  execFileSync(process.execPath, [resolve(__dirname, '..', '..', 'scripts', 'sync-version.mjs')], { stdio: 'ignore' });
});

describe('package publishing configuration', () => {
  test('publishes the CLI bin and its compiled entrypoint', async () => {
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
      bin: { peaks: string };
      files: string[];
      version: string;
      scripts: { build: string; prepack: string; postinstall: string; dev: string; 'dev:watch': string };
    };
    const binSource = await readFile(binPath, 'utf8');
    const versionSource = await readFile(versionPath, 'utf8');

    expect(versionSource).toBe(`export const CLI_VERSION = ${JSON.stringify(packageJson.version)};\n`);
    expect(packageJson.bin.peaks).toBe('./bin/peaks.js');
    expect(packageJson.files).toContain('bin/peaks.js');
    expect(packageJson.files).toContain('dist/cli/index.js');
    expect(packageJson.files).toContain('scripts/clean-dist.mjs');
    expect(packageJson.files).toContain('scripts/sync-version.mjs');
    expect(packageJson.files).toContain('scripts/install-skills.mjs');
    expect(packageJson.files).toContain('scripts/watch.mjs');
    expect(packageJson.files).toContain('skills/**');
    expect(packageJson.scripts.build).toBe('node ./scripts/sync-version.mjs && node ./scripts/clean-dist.mjs && tsc -p tsconfig.build.json && node ./scripts/copy-templates.mjs');
    expect(packageJson.scripts.prepack).toBe('npm run build');
    expect(packageJson.scripts.postinstall).toBe('node ./scripts/install-skills.mjs');
    expect(packageJson.scripts.dev).toBe('tsx src/cli/index.ts');
    expect(packageJson.scripts['dev:watch']).toBe('node ./scripts/watch.mjs');
    expect(binSource).toContain("../dist/cli/index.js");
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
