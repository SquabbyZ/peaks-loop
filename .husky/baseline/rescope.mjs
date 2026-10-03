/**
 * `.husky/baseline/rescope.mjs` — the rescope guard (H1) and the shadow tally
 * (H3), pure, rid `2026-10-03-w10-rescope-a` (backlog §2.42).
 *
 * WHY THE GUARD EXISTS. The monotonicity comparison compares VALUES and knew
 * nothing about the SCOPE that produced them. Narrow the enforced file set and
 * one regeneration reports `eslintFindings 2768 -> 2130` — a 638-finding
 * improvement nobody made — and the ratchet re-anchors to the smaller number.
 * That is §2.27's laundering door through a new frame: not a raised number, a
 * shrunken denominator. So the anchor comparison now reads the artifact's
 * `scope` block too, and a scope change REFUSES by default, naming both dir
 * lists, both measured-file counts, and every ceiling row it is about to hide.
 * `--rescope` is the only thing that writes through it — same refuse-first,
 * print-everything, opt-in-by-flag shape as `--seed`.
 */

/** The escape hatch. Named so it cannot be reached by accident, like `--seed`. */
export const RESCOPE_FLAG = '--rescope';

/** Read at module load, exactly like `anchor.mjs` reads `--seed`. */
export const rescopeRun = process.argv.slice(2).includes(RESCOPE_FLAG);

/** The one stderr sentence every generator run prints, gated or not (H3). */
export function shadowStderrLine(shadow) {
  return (
    `out-of-scope (not gated, owner decision 2026-10-03): ${shadow.measuredFiles} files, ` +
    `${shadow.eslintFindings} findings, ${shadow.fileSizeExcessLines} excess lines`
  );
}

const sameDirs = (a, b) =>
  Array.isArray(a) && Array.isArray(b) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/**
 * H1 — may this run write an artifact whose `scope.dirs` differ from HEAD's?
 *
 * Returns `null` when the question does not arise (HEAD carries no readable
 * scope block — a pre-rescope artifact from before this slice, which nothing
 * here can compare against), or when the dirs are equal (no rescope). Returns
 * the refusal text when they differ and `--rescope` was NOT passed. The text
 * names both dir lists, both measured-file counts, every per-row delta the
 * write is about to hide, and says in words that the drop is a scope change,
 * not a reduction in debt.
 */
export function scopeTrip({ headScope, headFileCount, newScopeDirs, gatedCount, headCeilings, ceilings }) {
  const headDirs = Array.isArray(headScope?.dirs) ? headScope.dirs : null;
  if (headDirs === null) return null;
  if (sameDirs(headDirs, newScopeDirs)) return null;
  const rows = [];
  for (const [key, value] of Object.entries(ceilings)) {
    const previous = headCeilings?.[key];
    if (typeof previous === 'number' && previous !== value) {
      rows.push(`${key}: ${previous} -> ${value}`);
    }
  }
  return (
    `SCOPE CHANGE without ${RESCOPE_FLAG}: this run measured a different file set than ` +
    `${headScope.source ?? 'HEAD'} did.\n` +
    `    - HEAD scope.dirs: ${JSON.stringify(headDirs)}\n` +
    `    - new scope.dirs:  ${JSON.stringify(newScopeDirs)} (rule: src/** + packages/*/src/**)\n` +
    `    - measured files: ${headFileCount} -> ${gatedCount}\n` +
    (rows.length > 0
      ? `    - ceilings this write would re-anchor:\n${rows.map((r) => `        ${r}`).join('\n')}\n`
      : '    - no ceiling row moves in this write\n') +
    `  EVERY movement above is a SCOPE CHANGE, not a reduction in debt: the files that ` +
    'left the\n' +
    '  enforced view are still there, unfixed. If that is really the decision being made,\n' +
    `  say so on purpose with ${RESCOPE_FLAG}; the shadow rows then keep the out-of-scope ` +
    'totals reported.'
  );
}

/**
 * The other direction: `--rescope` passed when NOTHING rescoped. The flag is a
 * statement about a boundary moving, not a cosmetic override — with no scope
 * difference to write it refuses, the same way `--seed` over a readable anchor
 * does not silently become "write anyway".
 */
export function rescopeUnneededTrip({ headScope, newScopeDirs }) {
  const headDirs = Array.isArray(headScope?.dirs) ? headScope.dirs : null;
  if (headDirs !== null && !sameDirs(headDirs, newScopeDirs)) return null;
  return (
    `${RESCOPE_FLAG} was passed but the scope has not changed since HEAD: ` +
    (headDirs === null
      ? 'HEAD carries no scope block and this run derives none differently'
      : `scope.dirs are ${JSON.stringify(newScopeDirs)} on both sides`) +
    '. There is nothing to rescope. Run without the flag.'
  );
}

/**
 * The eslint tally over ANY file list, using the SAME classification the gated
 * rows use (never a second tally rule): this is `eslint-leg.mjs`'s loop,
 * factored out so the gated ceilings and the shadow block partition ONE
 * measurement rather than running two.
 */
export function scopeTally(files, lint) {
  const { messagesByFile, classify } = lint;
  let findings = 0;
  let errors = 0;
  let phantomFindings = 0;
  const coverageGapFiles = [];
  const syntaxErrorFiles = [];
  const notLinted = [];
  for (const file of files) {
    const v = classify(messagesByFile[file]);
    if (v.notLinted) {
      notLinted.push(file);
      continue;
    }
    phantomFindings += v.phantomFindings;
    if (v.syntaxError) syntaxErrorFiles.push(file);
    else if (v.coverageGap) coverageGapFiles.push(file);
    else {
      findings += v.eslint;
      errors += v.eslintErrors;
    }
  }
  return { findings, errors, phantomFindings, coverageGapFiles, syntaxErrorFiles, notLinted };
}

/**
 * H3 — the shadow tally over a measured population. eslint numbers come from the
 * SAME classification the gated rows use; the size numbers come from the census
 * partition. These keys are REPORTED, never ceilings: they must not appear in
 * `CEILING_KEYS`, and the generator compares nothing against them.
 */
export function shadowTally({ shadow, lint, size }) {
  const tally = scopeTally(shadow, lint);
  return {
    eslintFindings: tally.findings,
    eslintErrors: tally.errors,
    fileSizeOverCap: size.shadow.overCap,
    fileSizeExcessLines: size.shadow.excessLines
  };
}
