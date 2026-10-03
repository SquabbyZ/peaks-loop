/**
 * `.husky/baseline/rescope.mjs` — the rescope guard (H1), the shadow tally (H3) and
 * the shadow-move check (W1), pure. Rids `2026-10-03-w10-rescope-a` (§2.42),
 * `2026-10-03-silent-warning-scope` (§2.43), `2026-10-03-shadow-move-rider` (§2.46)
 * and `2026-10-03-scope-growth-vs-shrink` (§2.50), whose policy this file enforces.
 *
 * WHY THE GUARD EXISTS: the monotonicity comparison compares VALUES and knew nothing
 * about the SCOPE that produced them. Narrow the enforced file set and one
 * regeneration reports `eslintFindings 2768 -> 2130` — a 638-finding improvement
 * nobody made — and the ratchet re-anchors to the smaller number (§2.27's laundering
 * door as a shrunken denominator). So the comparison reads the HEAD artifact's
 * `scope` block too — whole (§2.43: a leg population is recorded under `scope`, read
 * by `leg-scope.mjs`, and a moved one is a boundary event) — and refuses by default,
 * naming everything it is about to hide. `--rescope` is the only way through: the
 * same refuse-first, print-everything, opt-in shape as `--seed`.
 *
 * SINCE §2.50 (owner decision 2026-10-03) the trip DIRECTIONALISES the question: the
 * flag is required when the boundary TEXT moved (rule, dirs, extensions) OR a file
 * that was in scope at HEAD LEFT it — a SET difference of the two enumerations, never
 * an arithmetic one, because `950 > 943` does not prove nothing left. Pure growth
 * proceeds unflagged and prints `scope grew: ...` — ceremony relaxed, never the
 * ratchet: a bigger watched population can only RAISE measured counts, and the
 * monotonicity guard refuses any raised ceiling regardless of the flag.
 */

import { describeLegScopeMove, legScopeMoves, scopePopulationMove } from './leg-scope.mjs';

/** The escape hatch. Named so it cannot be reached by accident, like `--seed`. */
export const RESCOPE_FLAG = '--rescope';
/** Read at module load, exactly like `anchor.mjs` reads `--seed`. */
export const rescopeRun = process.argv.slice(2).includes(RESCOPE_FLAG);

/**
 * THE NUMERIC ROWS OF THE SHADOW BLOCK, in the order the shadow-move check reads
 * them (rid `2026-10-03-shadow-move-rider`, W1). Shadow rows, NOT ceilings, so the
 * check has a fixed set and can never be handed a ceiling key by accident;
 * `anchor.mjs` reads the same list for "does HEAD's block have a number here at all".
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
 * THE WHOLE BOUNDARY in one reading, DIRECTIONALISED (§2.42 dirs, §2.43 legs, §2.50
 * text and set difference). `null` when HEAD carries no readable `scope.dirs` — a
 * question nobody can ask is not a refusal, the posture §2.42 took. Otherwise:
 *   - `textChanged` — rule, dirs or extensions moved: the boundary DESCRIPTION;
 *   - `entered` / `left` — set differences of the enforced enumerations; empty `[]`
 *     when either list is absent (unprovable — §2.41's unknown posture);
 *   - `moves` — leg population records that moved (`leg-scope.mjs`);
 *   - `grew` — pure growth: files in, none left, text still, every leg move a
 *     derivative of the bigger crowd — the state §2.50 lets pass unflagged;
 *   - `requiresFlag` — text moved, coverage LEFT, or a leg move growth does not
 *     explain (§2.43 holds: a leg widening inside an unchanged gate scope is the
 *     905->943 laundering shape, and a leg shrinking is coverage loss);
 *   - `gatePopulationMoved` — what explains a no-leg row's rise once the flag is on.
 */
export function scopeDifference({
  headScope, newScope, headFileCount, gatedCount, headFiles = null, runFiles = null
}) {
  const headDirs = Array.isArray(headScope?.dirs) ? headScope.dirs : null;
  if (headDirs === null) return null;
  const newDirs = Array.isArray(newScope?.dirs) ? newScope.dirs : [];
  const dirsDiffer = !sameDirs(headDirs, newDirs);
  const textChanged =
    dirsDiffer || headScope.rule !== newScope?.rule || headScope.extensions !== newScope?.extensions;
  const population = scopePopulationMove(headFiles, runFiles);
  const entered = population === null ? [] : population.entered;
  const left = population === null ? [] : population.left;
  const moves = legScopeMoves(headScope, newScope);
  const grew = !textChanged && left.length === 0 && entered.length > 0;
  const unexplained = moves.filter(
    (move) => !(grew && move.from !== null && move.to !== null && move.to > move.from)
  );
  return {
    headDirs, newDirs, dirsDiffer, textChanged, entered, left, moves,
    grew: grew && unexplained.length === 0,
    requiresFlag: textChanged || left.length > 0 || unexplained.length > 0,
    gatePopulationMoved: dirsDiffer || headFileCount !== gatedCount
  };
}

/**
 * H1 — the no-flag refusal when the boundary moved in a way §2.50 still calls a
 * rescope: text changed, files LEFT (named path by path — a SET difference, because
 * the count may have grown anyway), or a leg moved unexplained (§2.43). It names the
 * dir lists, both counts, the moved legs with directions, and every hidden row.
 */
export function scopeTrip({
  headScope, headFileCount, newScope, gatedCount, headCeilings, ceilings,
  headFiles = null, runFiles = null
}) {
  const diff = scopeDifference({ headScope, newScope, headFileCount, gatedCount, headFiles, runFiles });
  if (diff === null || !diff.requiresFlag) return null;
  const rows = [];
  for (const [key, value] of Object.entries(ceilings)) {
    const previous = headCeilings?.[key];
    if (typeof previous === 'number' && previous !== value) rows.push(`        ${key}: ${previous} -> ${value}`);
  }
  const parts = [];
  if (diff.textChanged) {
    parts.push(
      `    - HEAD scope.dirs: ${JSON.stringify(diff.headDirs)}`,
      `    - new scope.dirs:  ${JSON.stringify(diff.newDirs)} (rule: src/** + packages/*/src/**)`,
      `    - rule: ${JSON.stringify(headScope.rule ?? null)} -> ${JSON.stringify(newScope?.rule ?? null)}`,
      `    - extensions: ${JSON.stringify(headScope.extensions ?? null)} -> ` +
        `${JSON.stringify(newScope?.extensions ?? null)}`
    );
  } else if (diff.moves.length > 0) {
    parts.push(
      `    - scope.dirs: unchanged (${JSON.stringify(diff.newDirs)}) — what moved is a LEG's own population,`,
      '      which the gate-wide scope has no room to say'
    );
  }
  if (diff.left.length > 0) {
    const more = diff.left.length > 12 ? ` (+${String(diff.left.length - 12)} more)` : '';
    parts.push(`    - FILES LEFT THE SCOPE (${String(diff.left.length)}, a SET difference — the count may ` +
      `have grown anyway): ${diff.left.slice(0, 12).join(', ')}${more}`);
  }
  const legs =
    diff.moves.length > 0 ? `${diff.moves.map((m) => `    - ${describeLegScopeMove(m)}`).join('\n')}\n` : '';
  return (
    `SCOPE CHANGE without ${RESCOPE_FLAG}: this run measured a different file set than ` +
    `${headScope.source ?? 'HEAD'} did.\n${parts.join('\n')}\n` +
    `    - measured files: ${headFileCount} -> ${gatedCount}\n` +
    legs +
    (rows.length > 0
      ? `    - ceilings this write would re-anchor:\n${rows.join('\n')}\n`
      : '    - no ceiling row moves in this write\n') +
    '  EVERY movement above is a SCOPE CHANGE, not a reduction in debt: the files that left the\n' +
    '  enforced view are still there, unfixed, and the files that ENTERED it were always there\n' +
    `  too. If that is really the decision being made, say so on purpose with ${RESCOPE_FLAG}; the\n` +
    '  shadow rows then keep the out-of-scope totals reported, and only the rows of a population\n' +
    '  that moved may change.'
  );
}

/**
 * THE OTHER DIRECTION: `--rescope` with no boundary to state — and over pure growth
 * there is none (§2.50): the flag means "the owner redrew the boundary", and spending
 * it on an ordinary split is the dilution the policy exists to prevent.
 */
export function rescopeUnneededTrip({
  headScope, newScope, headFileCount, gatedCount, headFiles = null, runFiles = null
}) {
  const diff = scopeDifference({ headScope, newScope, headFileCount, gatedCount, headFiles, runFiles });
  if (diff !== null && diff.requiresFlag) return null;
  const why =
    diff === null
      ? 'HEAD carries no scope block and this run derives none differently'
      : diff.entered.length > 0 && diff.left.length === 0 && !diff.textChanged
        ? `this run measured ${String(diff.entered.length)} MORE file(s) than HEAD inside an ` +
          'unchanged boundary — growth is not a rescope'
        : `scope.dirs are ${JSON.stringify(diff.newDirs)} on both sides and no leg population moved`;
  return (
    `${RESCOPE_FLAG} was passed but the scope has not changed since HEAD: ${why}. ` +
    'There is nothing to rescope. Run without the flag.'
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
