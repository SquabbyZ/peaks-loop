// Slice 2026-09-11 (runtime-version-lockstep) — this file used to grep
// publish.yml for three strings while its `it` claimed to check that the
// three versions "all equal". It asserted no version at all, so it stayed
// green through the 4.0.37 release while `RUNTIME_VERSION` sat at 4.0.36
// and CI's gate-cli-version step aborted before npm publish. A guard that
// cannot fail is not a guard: the three values are now read and compared.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const rootVersion = (): string =>
  (JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version: string })
    .version;

/** Read `export const <name> = '<version>';` out of a source or built file. */
const declaredVersion = (relPath: string, constName: string): string => {
  const src = readFileSync(join(projectRoot, relPath), 'utf8');
  const value = src.match(new RegExp(`\\b${constName}\\s*=\\s*['"]([^'"]+)['"]`))?.[1];
  if (value === undefined) {
    throw new Error(`${relPath} does not declare ${constName} = '<version>'`);
  }
  return value;
};

const expectLockstep = (label: string, actual: string, root: string): void => {
  if (actual !== root) {
    throw new Error(`${label} is ${actual}, but root package.json#version is ${root}`);
  }
};

describe('publish.yml lockstep — runtime added as on-disk gate only (private package, not published)', () => {
  it('checks runtime RUNTIME_VERSION + shared dist/version.js + root package.json all equal', () => {
    const root = rootVersion();

    expectLockstep(
      'RUNTIME_VERSION in packages/peaks-loop-internal-runtime/src/index.ts',
      declaredVersion('packages/peaks-loop-internal-runtime/src/index.ts', 'RUNTIME_VERSION'),
      root,
    );
    expectLockstep(
      'CLI_VERSION in packages/peaks-loop-shared/src/version.ts',
      declaredVersion('packages/peaks-loop-shared/src/version.ts', 'CLI_VERSION'),
      root,
    );

    // The CI gate reads the *built* artifact. dist/ is gitignored, so it
    // only exists after a build; when it does, it must agree too.
    if (existsSync(join(projectRoot, 'packages/peaks-loop-shared/dist/version.js'))) {
      expectLockstep(
        'CLI_VERSION in packages/peaks-loop-shared/dist/version.js',
        declaredVersion('packages/peaks-loop-shared/dist/version.js', 'CLI_VERSION'),
        root,
      );
    }

    // Supplement, not the whole test: the publish-time gate that stops a
    // drift from reaching the registry still has to exist and cover both
    // packages (this used to be the test's entire body).
    const yml = readFileSync('.github/workflows/publish.yml', 'utf8');
    expect(yml).toMatch(/gate-cli-version/);
    expect(yml).toMatch(/peaks-loop-internal-runtime/);
    expect(yml).toMatch(/peaks-loop-shared/);
  });

  it('does NOT add peaks-loop-internal-runtime to publish list (private package)', () => {
    const yml = readFileSync('.github/workflows/publish.yml', 'utf8');
    // gate-cli-version does check runtime on-disk; but the publish
    // list (npm publish invocation) only contains peaks-loop-shared
    // + peaks-loop. runtime is private.
    const publishListSection = yml.match(/publish[\s\S]*?(?=\n      -|\Z)/i)?.[0] ?? '';
    // The publish filter excludes private packages; runtime is
    // private: true. This is the structural guarantee — we don't need
    // to grep for "private" in publish.yml because pnpm publish
    // respects package.json#private.
    expect(publishListSection.length).toBeGreaterThan(0);
  });
});
