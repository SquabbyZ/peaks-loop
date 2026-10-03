/**
 * `.husky/baseline/rescope.mjs` — the rescope guard (H1), the shadow tally (H3) and
 * the shadow-move check (W1), pure, rid `2026-10-03-w10-rescope-a` (backlog §2.42)
 * with W1 from rid `2026-10-03-shadow-move-rider` (backlog §2.46).
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

/**
 * THE NUMERIC ROWS OF THE SHADOW BLOCK, in the order the shadow-move check reads
 * them (rid `2026-10-03-shadow-move-rider`, W1). They are shadow rows, NOT
 * ceilings — this list exists so the check has a fixed set to compare and can
 * never be handed a ceiling key by accident. `anchor.mjs` reads it too, so the
 * "does HEAD's block have a number here at all" question and the "did this row
 * move" question are answered from ONE list.
 */
export const SHADOW_MOVE_ROWS = Object.freeze([
  'measuredFiles',
  'eslintFindings',
  'eslintErrors',
  'fileSizeOverCap',
  'fileSizeExcessLines'
]);

/** Is `block` a shadow block the check may compare row by row? Absent/malformed: no. */
export function isShadowBlock(block) {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) return false;
  return SHADOW_MOVE_ROWS.every((row) => typeof block[row] === 'number');
}

/** The population, in the one sentence every state of the check is allowed to name. */
function shadowPopulation(shadow) {
  return (
    `${shadow.measuredFiles} files, ${shadow.eslintFindings} findings, ${shadow.eslintErrors} errors, ` +
    `${shadow.fileSizeOverCap} over-cap, ${shadow.fileSizeExcessLines} excess lines`
  );
}

/**
 * W1 — WARN WHEN THE SHADOW RISES, given the block HEAD's artifact carries and the
 * block this run measured. Pure: it returns the lines, the caller prints them, and
 * nothing here can reach an exit code or a byte of the artifact.
 *
 * WHY A VOICE AND NOT A GATE (owner ruling 2026-10-03, backlog §2.46). The rescope
 * made 558 files measured-and-not-gated, so their debt can move while every ceiling
 * holds — §2.46 is exactly that happening with nobody noticing. A ceiling would be a
 * second ratchet the owner did not ask for; silence is the defect. So: stderr, one
 * line per moved row, exit code untouched.
 *
 * Four states, none of them allowed to be silent:
 *   - inactive — HEAD carries no readable shadow block (its artifact predates the
 *     rescope), so there is nothing to compare against, and that is said out loud
 *     with the size of the population it could not compare;
 *   - equal — one line naming the population;
 *   - rise — one WARNING per moved row, and when `--rescope` was applied this run
 *     the same line says so, because "we stopped watching more files" and "the files
 *     we stopped watching got worse" are different facts the artifact cannot tell
 *     apart afterwards;
 *   - fall — no warning at all (real cleanup, or a population that left the scope,
 *     which the census's own empty/missing-scope guard already refuses), but still
 *     stated rather than dropped.
 */
export function shadowMoveLines({ headShadow, shadow, rescopeApplied = false }) {
  const boundary = rescopeApplied ? ' (the boundary moved this run — --rescope)' : '';
  if (!isShadowBlock(shadow)) {
    // No measurement to speak about: the check stays out of the way rather than
    // printing a population it does not have. Every generator run has one.
    return [];
  }
  if (!isShadowBlock(headShadow)) {
    return [
      `shadow-move check: inactive — HEAD's artifact carries no shadow block, so there is nothing ` +
        `to compare this run's ${shadow.measuredFiles} exempt files against.`
    ];
  }
  const rose = [];
  const fell = [];
  for (const row of SHADOW_MOVE_ROWS) {
    const previous = headShadow[row];
    const current = shadow[row];
    if (current > previous) rose.push(`${row} ${previous} -> ${current}`);
    else if (current < previous) fell.push(`${row} ${previous} -> ${current}`);
  }
  if (rose.length > 0) {
    return [
      ...rose.map(
        (move) => `WARNING: shadow moved up: ${move} — the boundary exempts it; nobody fixed it${boundary}`
      ),
      `  compared: this run ${shadowPopulation(shadow)} against HEAD's ${shadowPopulation(headShadow)}`
    ];
  }
  if (fell.length > 0) {
    return [
      `shadow moved down: ${fell.join(', ')} — not a warning: either real cleanup, or a ` +
        'population that left the scope (the census refuses an empty or missing one)',
      `  compared: this run ${shadowPopulation(shadow)} against HEAD's ${shadowPopulation(headShadow)}`
    ];
  }
  return [`shadow unchanged: ${shadowPopulation(shadow)}`];
}

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
