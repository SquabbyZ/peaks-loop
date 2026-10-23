// tests/unit/lint/_wide-format-scope-fixture.ts
//
// The two fixture inputs the commit path's WIDE formatting leg needs, kept OUT of
// the harness that owns them: `_file-size-hooks-fixture.ts` is a capped file under
// `tests/` (500 raw lines) and the house rule for those is "extract, do not
// append" — the same reason the copy set lives in `_file-size-copy-set.ts`.
//
// 1. THE WIDE FORMAT SCOPE, MIRRORED. The commit path's wide formatting leg
//    reads the four globs from `package.json#scripts['format:check']` — the same
//    scope the CI job and the push gate's format ratchet measure — so the fixture
//    MUST declare it: a fixture whose package.json has no `format:check` script
//    makes that leg refuse (a scope that cannot be read is not an empty scope),
//    and every arm that runs `staged` in the fixture would go red for a reason
//    that has nothing to do with what it guards. It is COPIED from the
//    repository's own package.json rather than restated here: a second spelling
//    of the scope in a fixture is the drift shape the leg exists to avoid.
// 2. THE PICOMATCH FORWARDER. The leg matches paths against those globs with
//    picomatch — the engine fast-glob (and therefore prettier's own glob
//    expansion) uses — and picomatch is a direct dependency of this package (the
//    one `.husky/coverage-ratchet/report.mjs` already uses). The fixture's copy
//    must resolve to the repository's real one, or the gate dies at LOAD inside
//    its temp repo: `ERR_MODULE_NOT_FOUND`, exit 1, no output — the wave-7
//    failure the copy set exists to prevent.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PICOMATCH_PACKAGE =
  '{"name":"picomatch","version":"0.0.0-fixture","main":"index.js"}\n';

/** The fixture's picomatch is the repository's real one, so the matcher is real. */
export function picomatchShim(repoRoot: string): string {
  const real = join(repoRoot, 'node_modules', 'picomatch');
  return `module.exports = require(${JSON.stringify(real)});\n`;
}

/** The repository's own wide format scope, read from the script that owns it. */
export function declaredFormatCheck(repoRoot: string): string {
  const script = (
    JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts['format:check'];
  if (typeof script !== 'string') {
    throw new Error(
      "the repository's package.json declares no scripts.format:check, so the fixture cannot mirror the wide format scope"
    );
  }
  return script;
}
