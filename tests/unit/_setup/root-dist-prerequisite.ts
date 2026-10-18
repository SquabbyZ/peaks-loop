// tests/unit/_setup/root-dist-prerequisite.ts
//
// The repo-root `dist/` is a PREREQUISITE of the two unit files that consume the
// build output rather than `src/` (backlog §2.13): the statusline suite spawns
// `dist/cli/index.js`, and the tarball suite packs the root `package.json`.
// vitest runs every other file against TS through the alias, so the root build
// is deliberately NOT wired into `pretest` — it costs ≈9–14 s, load-dependent
// (§2.13), and no other file needs it.
//
// What this helper adds is only the DIRECTED failure. Without it a missing build
// is indistinguishable from a broken whitelist: the tarball suite reported
// `expected 1 to be +0`, which names no cause and no remedy. The statusline
// suite already throws the same sentence from `resolveDistEntry()`; this helper
// is the shared form of it, so a future consumer does not have to reinvent it.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The remediation sentence, verbatim in the shape the statusline suite already
 * uses (`tests/unit/cli/statusline-cli-integration.test.ts`).
 */
const ROOT_DIST_BUILD_HINT =
  'Run "pnpm build" in the repo root before running this test. ' +
  'The package pretest script does this for `pnpm test`; a direct vitest invocation does not.';

/**
 * Return `join(projectRoot, relativePath)` when the build output exists, and
 * otherwise throw naming the missing path and the command that creates it.
 *
 * `relativePath` is a root-relative build artifact, e.g.
 * `dist/services/codegraph` for the tarball suite — checking the exact
 * directory the test needs separates an unbuilt tree from a broken whitelist.
 */
export function assertBuiltPath(projectRoot: string, relativePath: string): string {
  const target = join(projectRoot, relativePath);
  if (!existsSync(target)) {
    throw new Error(
      `Prerequisite missing: ${target} does not exist. ` +
        'This test reads the repo-root build output, not `src/`. ' +
        ROOT_DIST_BUILD_HINT
    );
  }
  return target;
}
