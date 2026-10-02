// .husky/gate/prettier.mjs
// The prettier leg: the declared-config check that makes an unresolved config its
// own failure class, and `prettierCheck`. Hoisted VERBATIM out of
// `.husky/peaks-gate.mjs` by rid `2026-10-02-wave9-gate-entry-split`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import prettier from 'prettier';
import { ROOT } from './context.mjs';

// ---------------------------------------------------------------------------
// Config resolution — the failure mode this gate got wrong
// ---------------------------------------------------------------------------
// `prettier.resolveConfig()` returns NULL and does not throw when no config can
// be found. Spreading that null — `{ ...opts }` — yields `{ filepath }`, i.e.
// prettier's DEFAULTS (printWidth 80, double quotes). A file correctly formatted
// under this repo's config then fails the check. Measured 2026-09-19 on the 88
// files the baseline calls prettier-clean: 6 of 6 sampled return `true` with the
// repo config and `false` with `{ ...null }`.
//
// What can make it unresolvable: `scripts/bump-version.mjs` rewrites the root
// `package.json` with `writeFileSync(JSON.stringify(...))` — truncate-then-write,
// not atomic — so a gate run inside that window finds no config anywhere up the
// tree. That is a long-lived, low-probability race, which is exactly the kind of
// failure that shows up once, cannot be reproduced, and destroys trust in the
// gate. It happened once already: this gate reported a clean file as
// "not prettier-formatted" and the cause was not recoverable from the output.
//
// Two consequences, both worse than a false red:
//   1. The advice was destructive. Under defaults `prettier --write` rewrites
//      the file with double quotes — measured 8380 -> 8505 bytes on
//      scripts/dist-freshness.mjs. A dev obeying the gate mangles the file.
//   2. `.husky/peaks-gate-baseline.mjs` spreads the same null, so a run inside
//      the window would record `prettierClean: false` for ALL 1266 files and
//      write that as the ceiling. The ratchet would be poisoned permanently.
//
// So a config that did not resolve is now its own failure class: no `--write`
// advice, and the resolved config is compared against the repo's own declaration
// in package.json — which catches a WRONG config too, not only a missing one.
const DECLARED_PRETTIER = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).prettier;

/** Returns a human-readable problem, or null when the config is the declared one. */
function prettierConfigProblem(resolved) {
  if (DECLARED_PRETTIER === undefined) return 'package.json has no "prettier" key to check against';
  if (resolved === null) return 'prettier found NO config (resolveConfig returned null)';
  for (const [key, want] of Object.entries(DECLARED_PRETTIER)) {
    if (resolved[key] !== want) {
      return `resolved ${key}=${JSON.stringify(resolved[key])} but package.json declares ${JSON.stringify(want)}`;
    }
  }
  return null;
}

/**
 * true = already formatted, false = would be rewritten, throws = unparsable.
 * A config that did not resolve is reported as `{ configProblem }` — NEVER as
 * "false", because under defaults `false` is what a perfect file looks like.
 */
async function prettierCheck(file) {
  const abs = resolve(ROOT, file);
  const resolved = await prettier.resolveConfig(abs, { editorconfig: false });
  const configProblem = prettierConfigProblem(resolved);
  // `configProblem` is ALWAYS present on the returned object, null included.
  // Omitting the key on success made `result.configProblem` read as `undefined`,
  // and `undefined !== null` is TRUE — so every file took the CONFIG UNRESOLVED
  // branch and nothing could ever commit. The sentinel has to be one value, not
  // "null or absent". Caught by running the gate against a healthy tree.
  if (configProblem !== null) return { configProblem, configFailed: true };
  const clean = await prettier.check(readFileSync(abs, 'utf8'), { ...resolved, filepath: abs });
  return { configProblem: null, configFailed: false, clean, resolved };
}

export { prettierCheck, prettierConfigProblem, DECLARED_PRETTIER };
