// tests/_global-setup/packages-build.ts
//
// Preflight for every suite that imports a workspace package: make the build
// prerequisite real before a single test file loads.
//
// WHY A PREFLIGHT AND NOT A HOOK IN `package.json#scripts`
//
// A `pretest` hook only fires for the entry point that has it, and only when
// the entry point is reached through pnpm's lifecycle. `test` had one and it
// was wrong (it built 1 of the 4 packages); `test:unit`, `test:dev`,
// `test:dev:cli`, `test:cli`, `test:workflow`, `test:fast`, `test:ci` and the
// whole `test:coverage*` family had none. A hook per script is N scripts to
// keep in sync, and the next entry point added is unprotected by construction.
// `globalSetup` runs once per suite, before collection, and no test file can
// opt out of it.
//
// WHICH CONFIGS LOAD THIS — the four vitest configs do NOT inherit from each
// other, so this is enumerated rather than assumed:
//
//   vitest.config.ts             -> this file. Covers `test` (the bare
//                                   `vitest run`), `test:unit`, `test:dev`,
//                                   `test:dev:cli`, `test:cli`, `test:workflow`,
//                                   `test:fast`, `test:ci`,
//                                   `test:coverage:vitest`,
//                                   `test:coverage:workflow`,
//                                   `scripts/coverage-c8.mjs` (`test:coverage`,
//                                   `test:coverage:c8`), which runs `vitest run`
//                                   with no `--config`, and `test:race`,
//                                   `test:replay`, `test:changed`, which pass
//                                   files to the same bare `vitest run`.
//                                   `test:full` (`pnpm -r … run test`) reaches
//                                   this file through its ROOT leg only — the
//                                   package-local legs run vitest from their own
//                                   directories and load no globalSetup. That is
//                                   harmless today (both package-local test
//                                   files import only their own `../src/…`), and
//                                   it is the shape that bites the day one of
//                                   them imports a sibling package.
//   vitest.config.integration.ts -> this file, plus the root-`dist/` preflight.
//                                   Covers `test:integration` and
//                                   `test:capability-guard`. Measured: 9 files
//                                   under `tests/integration/` import a
//                                   workspace package, so it needs this too.
//   vitest.config.e2e.ts         -> NOT added, deliberately. Its suites import
//                                   no workspace package (measured: zero hits
//                                   for all four package names under
//                                   `tests/e2e/` and `tests/lint/`), and it
//                                   drives the CLI in-process via `runCli` with
//                                   no spawn and no `dist/`.
//   vitest.config.lint.ts        -> NOT added, same reason: prose checks, no
//                                   package import.
//
// The root-`dist/` axis is a DIFFERENT prerequisite and this file does not
// cover it. Measured on this tree: with `dist/` removed, TWO unit files fail,
// and only one of them is the shape that made this decision tolerable —
// `tests/unit/cli/statusline-cli-integration.test.ts` throws from module load
// naming the file and telling the reader to run `pnpm build`. The other,
// `tests/unit/cli/verify-codegraph-tarball.test.ts`, fails as a bare
// `expected 1 to be +0` with no remediation text at all. That is the
// misleading shape this file exists to remove, arriving by a second route, and
// leaving the axis alone is a scope decision that does not describe it. It is
// recorded in the slice handoff's backlog section rather than widened here
// (that would make the heavier root `tsc` build implicit on every test run).

import { ensurePackagesBuilt } from '../../scripts/packages-build-prerequisite.mjs';

export default function setup(): void {
  const result = ensurePackagesBuilt(process.cwd(), {
    log: (line) => {
      process.stdout.write(line);
    }
  });

  // A green whose basis is unstated is the ambiguity this preflight removes:
  // say which of the two ways it was satisfied.
  if (!result.built) {
    process.stdout.write(
      `[packages-build] ${result.fresh.length} workspace package(s) already built from their current src/\n`
    );
  }
}
