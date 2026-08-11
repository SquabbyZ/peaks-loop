// tests/unit/runtime/cli-version-lockstep.test.ts
//
// Slice 2026-08-11 F6 — lockstep guard for peaks-loop / peaks-loop-shared.
//
// Background: peaks-loop's `src/cli/program.ts` imports `CLI_VERSION` from
// `peaks-loop-shared/version`. The shared package's `src/version.ts` is
// rewritten from root `package.json#version` by `scripts/sync-version.mjs`,
// but a manual edit (or a stale dist) can let CLI_VERSION lag the root
// version, which surfaces as `peaks -v` printing the wrong number (see
// .peaks/memory/peaks-cli-version-shared-chicken-egg.md for the lineage).
//
// This test asserts the on-disk lockstep: CLI_VERSION in
// `packages/peaks-loop-shared/src/version.ts` MUST equal
// `package.json#version` at the project root. The fix path is to run
// `node ./scripts/sync-version.mjs` (which is also wired into `prepack`,
// `predev`, and `pretest`).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..', '..', '..');
const sharedVersionPath = join(projectRoot, 'packages', 'peaks-loop-shared', 'src', 'version.ts');
const rootPkgPath = join(projectRoot, 'package.json');

describe('peaks-loop / peaks-loop-shared CLI_VERSION lockstep', () => {
  it('CLI_VERSION in shared/src/version.ts matches root package.json#version', () => {
    const rootPkg = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as { version?: string };
    const sharedSrc = readFileSync(sharedVersionPath, 'utf8');
    const match = sharedSrc.match(/CLI_VERSION\s*=\s*["']([^"']+)["']/);

    expect(typeof rootPkg.version).toBe('string');
    expect(match).not.toBeNull();

    const cliVersion = match?.[1] ?? '';
    expect(cliVersion).toBe(rootPkg.version);
  });
});