/**
 * `.husky/baseline/prettier-leg.mjs` — the prettier pass and its fail-closed
 * config refusal (rid `2026-10-02-wave9-generator-split`, HEAD lines 414–458
 * wrapped as `async measurePrettierLeg({ scope })`).
 *
 * HEAD ran this at top level because it awaits; so does this, one module down,
 * and the entry awaits the call. The refusal is still `console.error` +
 * `process.exit(1)` BEFORE any write, and `prettierConfigProblem` is still the
 * guard `prettier-config.mjs` exports.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import prettier from 'prettier';

import { prettierConfigProblem } from './prettier-config.mjs';
import { OUT_PATH, ROOT, rel } from './paths.mjs';

/** `prettierCleanByFile` feeds the artifact's per-file rows; the rest feed ceilings. */
export async function measurePrettierLeg({ scope }) {
  // ---- prettier --------------------------------------------------------------
  console.error('checking prettier...');
  const prettierCleanByFile = {};
  const unparsable = [];
  let prettierDirty = 0;
  let configFailure = null;
  for (const file of scope) {
    const abs = resolve(ROOT, file);
    let src;
    try {
      src = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const opts = await prettier.resolveConfig(abs, { editorconfig: false });
    const problem = prettierConfigProblem(opts);
    if (problem !== null) {
      configFailure = `${file}: ${problem}`;
      break;
    }
    try {
      const clean = await prettier.check(src, { ...opts, filepath: abs });
      prettierCleanByFile[file] = clean;
      if (!clean) prettierDirty++;
    } catch (err) {
      unparsable.push({ file, reason: String(err.cause?.message ?? err.message).split('\n')[0] });
      prettierCleanByFile[file] = false;
    }
  }

  // Refuse BEFORE writing. Writing here would poison the ceiling with ~1266
  // false "unformatted" entries and the ratchet could never recover from it.
  if (configFailure !== null) {
    console.error(
      `\nREFUSING to write ${rel(OUT_PATH)}: prettier's config did not resolve.\n  ${configFailure}\n\n` +
        'The root package.json is the config host. If it is being rewritten right now\n' +
        '(scripts/bump-version.mjs truncates then writes it, not atomically), re-run in\n' +
        'a moment. Nothing has been written; the existing ceilings are untouched.\n'
    );
    process.exit(1);
  }
  console.error(
    `prettier: ${prettierDirty} of ${scope.length} unformatted; ${unparsable.length} unparsable`
  );
  for (const u of unparsable) console.error(`  ! ${u.file}: ${u.reason}`);
  return { prettierCleanByFile, unparsable, prettierDirty, configFailure };
}
