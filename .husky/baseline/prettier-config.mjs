/**
 * `.husky/baseline/prettier-config.mjs` — the config guard that decides whether
 * this generator may write at all (rid `2026-10-02-wave9-generator-split`, HEAD
 * lines 103–133). Genuinely self-contained, which is why it is the one region
 * that hoists as a plain function: `DECLARED_PRETTIER` is read here and consumed
 * here, and `prettierConfigProblem` has exactly one caller — the prettier leg —
 * so there is nothing to return and no binding for a later region to lose.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROOT } from './paths.mjs';

// ---------------------------------------------------------------------------
// The config guard — why this generator may now REFUSE to write
// ---------------------------------------------------------------------------
// `prettier.resolveConfig()` returns NULL and does not throw when no config is
// found. Spreading that null yields prettier's DEFAULTS (printWidth 80, double
// quotes, trailing commas), under which a file correctly formatted for THIS repo
// reads as dirty. Measured 2026-09-19: of the 88 files the baseline calls
// prettier-clean, 6 of 6 sampled return true with the repo config and false with
// the spread null.
//
// Left unguarded, this generator would not merely print a wrong number — it
// would WRITE it. `prettierUnformatted` would jump 1178 -> ~1266 and become the
// ceiling, and every one of those files would be marked `prettierClean: false`,
// so the ratchet could never be satisfied for them again. A transient race in
// `scripts/bump-version.mjs` (truncate-then-write of the root package.json, not
// atomic) would become permanent damage to the baseline.
//
// So the config is compared against the repo's own declaration before anything
// is written, and a mismatch aborts the run with the ceilings untouched.
const DECLARED_PRETTIER = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).prettier;

export function prettierConfigProblem(resolved) {
  if (DECLARED_PRETTIER === undefined) return 'package.json has no "prettier" key to check against';
  if (resolved === null) return 'prettier found NO config (resolveConfig returned null)';
  for (const [key, want] of Object.entries(DECLARED_PRETTIER)) {
    if (resolved[key] !== want) {
      return `resolved ${key}=${JSON.stringify(resolved[key])} but package.json declares ${JSON.stringify(want)}`;
    }
  }
  return null;
}
