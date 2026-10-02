#!/usr/bin/env node
/**
 * The file-size leg's measurement path, shared by the two callers that own a row.
 *
 * WHY THIS FILE EXISTS (F5 of the repair cycle for rid `2026-09-30-cap-unify-01`).
 * The cap itself was single-sourced into `src/services/scan/file-size-policy.ts`,
 * but the code that SPAWNS the census and decides when it may not be believed was
 * written twice, near-verbatim — `.husky/peaks-gate.mjs:666` and
 * `.husky/peaks-gate-baseline.mjs:330` — and the copies had already drifted (one
 * passes `windowsHide: true`, the other not). The gate is the enforcement surface
 * and the generator is the thing that seeds the ceiling from the same measurement;
 * if the two disagree about what "could not be measured" means, one of them writes
 * a green the other would have refused. One module, both callers.
 *
 * THE POLICY IS STILL NOT HERE. Caps, scope dirs, extensions and the line
 * convention live in the policy module and reach this file only through the census
 * envelope (`scripts/lint/file-size-census.ts`, the one tool that imports the `.ts`
 * policy). Nothing in this file states a policy number.
 */
import { execFileSync } from 'node:child_process';

/** The census tool: the only thing that imports the `.ts` policy and counts the scope. */
export const FS_CENSUS = 'scripts/lint/file-size-census.ts';
/** The census is TypeScript, so both callers run it through tsx. */
export const TSX_CLI = 'node_modules/tsx/dist/cli.mjs';
/** The ceiling row this leg ratchets. */
export const FS_CEILING_KEY = 'fileSizeOverCap';
/** The label `check()` prints for the row. */
export const FS_ROW_LABEL = 'file-size over cap';
/**
 * The SECOND ceiling row this leg ratchets: the SUM of the lines over those caps,
 * not the count of the files carrying them.
 *
 * WHY IT HAD TO BE ITS OWN ROW (rid `2026-10-01-file-size-excess-row`, measured by
 * C wave 6). `fileSizeOverCap` counts FILES, so a hoist that lengthens an
 * already-over-cap file moves nothing it watches: wave 6 paid 67 lines of extra
 * excess (60,204 → 60,271) to buy 19 lint findings while `fileSizeOverCap` held at
 * 166 and `gate repo` exited 0. The number was printed in the row's scope note and
 * enforced by nothing. Folding it into the over-cap row would make one ceiling two
 * quantities — the conflation §3's per-class rows exist to prevent — so it gets its
 * own key, its own line, and this leg's already-shared measurement.
 */
export const FS_EXCESS_CEILING_KEY = 'fileSizeExcessLines';
/** The label `check()` prints for the excess row. */
export const FS_EXCESS_ROW_LABEL = 'file-size excess lines';
/** The string the census uses when it counted its own scope — i.e. the row itself. */
export const FS_WHOLE_SCOPE_SOURCE = 'git ls-files <policy dirs>';
/**
 * THE THIRD AND FOURTH ROWS THIS LEG RATCHETS: the same two quantities — files over
 * cap, lines over those caps — for the SECOND SCOPE, `.husky/`, the directory the
 * ratchet itself lives in (backlog §2.32, rid `2026-10-02-hooks-size-rows`).
 *
 * WHY THEY ARE NOT A FIFTH DIRECTORY IN THE FIRST SCOPE. `FILE_SIZE_SCOPE_DIRS`
 * covers `src`, `tests`, `packages` and `scripts`; `.husky` is in none of them, so
 * the files that implement this policy were measured by nothing — `peaks-gate.mjs`,
 * `peaks-gate-baseline.mjs` and `peaks-gate-baseline-monotonic.mjs` reached 1004 /
 * 750 / 662 raw lines in a day with no ceiling watching, while `prettierUnformatted`
 * stayed 0 because the prettier leg cannot see them either. Joining them to the main
 * rows at cap 300 would raise `fileSizeOverCap` 162 → 165 and `fileSizeExcessLines`
 * 54,318 → 55,834 (+1,516), which is a policy re-decision, and the monotonicity
 * guard refuses it correctly. So the invisible set gets its own measured pair, and
 * growth in the guard becomes a row that may only go DOWN.
 *
 * THE SAME THREE PROPERTIES AS THE PAIR ABOVE, OR LESS THAN NOTHING: seeded from the
 * census's own `hooks` block, re-derived against the inputs recorded beside them, and
 * unable to print one of the four numbers without the other three.
 */
export const FS_HOOKS_CEILING_KEY = 'fileSizeHooksOverCap';
/** The label `check()` prints for the hooks over-cap row. */
export const FS_HOOKS_ROW_LABEL = 'file-size hooks over cap';
/** The hooks scope's excess-lines row: the LINES over the hooks cap, not the files. */
export const FS_HOOKS_EXCESS_CEILING_KEY = 'fileSizeHooksExcessLines';
/** The label `check()` prints for the hooks excess row. */
export const FS_HOOKS_EXCESS_ROW_LABEL = 'file-size hooks excess lines';
/** The string the census uses when it counted the hooks scope itself. */
export const FS_HOOKS_WHOLE_SCOPE_SOURCE = 'git ls-files <hooks dirs>';

/**
 * The control-arm flag. A named-file list is not the row (see
 * `refuseScopedSubset`), so a caller that means to hand one in says so on purpose.
 */
export const FS_CONTROL_ARM_FLAG = '--control-arm';

/** Split a raw argv into (control-arm?, file list), so two callers cannot disagree about which argument is a path. */
export function parseFileSizeArgv(argv) {
  return {
    controlArm: argv.includes(FS_CONTROL_ARM_FLAG),
    files: argv.filter((arg) => arg !== FS_CONTROL_ARM_FLAG)
  };
}

/**
 * Why a census envelope's `hooks` block may not be believed, or `null` when it may.
 *
 * The same fail-closed posture as `missingFileSizeCeilings`, one layer up: the two
 * hooks rows share the main census run, so an envelope that stopped reporting the
 * second scope has not measured it. `overCap: 0` is exactly what "the `.husky/` debt
 * is cleared" looks like, and it is also what a census that never counted the scope
 * looks like — the distinction is the entire content of the row.
 *
 * A `countedFiles` of 0 is NOT a trip here, unlike the main scope: a `.husky` with no
 * policy-extension files is a measured zero. What makes it trustworthy is upstream —
 * `scripts/lint/file-size-census-hooks.ts` crashes rather than enumerating a hooks
 * directory that is gone, so a run that reports 0 counted files did look at the
 * directory and found nothing in it.
 */
export function hooksEnvelopeProblem(hooks) {
  if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) {
    return `produced no \`hooks\` block, so the ${FS_HOOKS_CEILING_KEY} row would be a number nobody measured`;
  }
  if (!Number.isInteger(hooks.overCap) || hooks.overCap < 0) {
    return 'produced a hooks block with no non-negative integer overCap';
  }
  if (!Number.isInteger(hooks.excessLines) || hooks.excessLines < 0) {
    return 'produced a hooks block with no non-negative integer excessLines';
  }
  if (!Number.isInteger(hooks.scope?.countedFiles) || hooks.scope.countedFiles < 0) {
    return 'produced a hooks block whose countedFiles is not a non-negative integer';
  }
  if (!Number.isInteger(hooks.caps?.hooksCap) || hooks.caps.hooksCap <= 0) {
    return 'produced a hooks block with no usable hooksCap to bind its ceiling to';
  }
  if (typeof hooks.convention !== 'string' || hooks.convention === '') {
    return 'produced a hooks block that does not name the line convention it counted in';
  }
  return null;
}

/**
 * The census envelope, or why this leg may not be believed.
 *
 * `files` narrows the count for a control arm (the same posture as
 * `measureSilentWarnings`); an empty list asks the census for its own scope:
 * `git ls-files` over the policy's four directories. `cwd` is the repo root each
 * caller already resolves for itself — the census paths are repo-relative.
 *
 * FAIL-CLOSED on every path: a census that cannot run, that produced no parseable
 * envelope, that reported no integer count, or that counted nothing, returns a
 * `failure` — it never returns `overCap: 0`, because 0 is what "the whole tree is
 * under the cap" looks like, and telling those two states apart is the entire
 * reason the row exists.
 */
export function measureFileSizeOverCap(files = [], cwd = process.cwd()) {
  let raw = '';
  try {
    raw = execFileSync('node', [TSX_CLI, FS_CENSUS, '--json', ...files], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    });
  } catch (err) {
    // Exit 1 means the census FOUND over-cap files; the envelope is still on
    // stdout — the same shape as eslint's report and the detector's.
    raw = err.stdout ?? '';
  }
  const refuse = (why) => ({ failure: why, env: null });
  let env;
  try {
    env = JSON.parse(raw);
  } catch {
    return refuse(`${FS_CENSUS} --json produced no parseable envelope`);
  }
  if (!Number.isInteger(env.overCap) || env.overCap < 0) {
    return refuse(`${FS_CENSUS} produced an envelope with no integer overCap`);
  }
  if (!Number.isInteger(env.excessLines) || env.excessLines < 0) {
    // The same trip, one row down: `0` is also what "nothing is over cap" looks
    // like, so an envelope without the sum cannot seed or check `fileSizeExcessLines`.
    return refuse(`${FS_CENSUS} produced an envelope with no integer excessLines`);
  }
  if (!Number.isInteger(env.scope?.countedFiles) || env.scope.countedFiles <= 0) {
    return refuse(`${FS_CENSUS} counted 0 files, so it measured nothing`);
  }
  // THE SECOND SCOPE TRIPS THE SAME WAY. One census run feeds four rows, so a
  // hooks block that is missing or malformed is not a reason to print the main pair
  // and skip the rest — it is a reason to print nothing (`§2.32`).
  const hooksProblem = hooksEnvelopeProblem(env.hooks);
  if (hooksProblem !== null) return refuse(`${FS_CENSUS} ${hooksProblem}`);
  return { failure: null, env };
}

/**
 * The refusal for a caller that handed the leg a named-file subset without saying
 * so, or `null` when the leg may speak for `ceilings.fileSizeOverCap`.
 *
 * WHY (F1, reproduced 2026-09-30): `node .husky/peaks-gate.mjs file-size
 * src/one-file.ts` printed `✓ file-size over cap 0 (ceiling 174) … file-size
 * ceiling held` and exited 0. A named-file run cannot contain an over-cap file the
 * whole-tree row does not already count, so its `0` is not a held ceiling — it is
 * the absence of a measurement wearing the row's label. The leg refuses it. A test
 * that genuinely means to hand the leg a subset says so with `--control-arm`, and
 * the leg then reports exactly what it measured: the count OF THE NAMED FILES,
 * labelled as a control arm, with the repo row explicitly disclaimed.
 */
export function refuseScopedSubset({ controlArm, files }) {
  if (files.length === 0 || controlArm) return null;
  return (
    `REFUSING to report the ${FS_CEILING_KEY} row — ${files.length} named file(s) are a ` +
    'subset, and a subset cannot fail a whole-tree row: it can only ever report fewer over-cap ' +
    'files than the census scope contains. A held ceiling here would be a green the row was ' +
    'never measured against.\n' +
    `  Run \`node .husky/peaks-gate.mjs file-size\` with no paths to measure ${FS_CEILING_KEY}, ` +
    'or pass `--control-arm` to test the leg on a subset deliberately.'
  );
}

/**
 * The refusal for a baseline that carries no ceiling for one or more of this leg's
 * rows, or `null` when the leg has numbers to compare against.
 *
 * WHY IT IS HERE AND WHY IT KNOWS ALL FOUR KEYS. The leg's rows share one census run,
 * so a missing ceiling has to take them ALL down: seeding `fileSizeExcessLines` while
 * leaving the guard keyed on `fileSizeOverCap` alone would let the over-cap row print
 * a green next to a number that was never measured against anything, and adding the
 * two hooks rows (§2.32) while keeping a two-key guard would let the main pair print
 * `held` next to a `.husky/` scope the baseline had never seeded. The gate used to
 * spell this refusal inline for one key; the key list and the text now live beside
 * the measurement they guard (F5 of the cap-unify review).
 */
export function missingFileSizeCeilings(ceilings) {
  const missing = [
    FS_CEILING_KEY,
    FS_EXCESS_CEILING_KEY,
    FS_HOOKS_CEILING_KEY,
    FS_HOOKS_EXCESS_CEILING_KEY
  ].filter((key) => !Number.isInteger(ceilings[key]));
  if (missing.length === 0) return null;
  return (
    `REFUSING to measure the file-size leg — the baseline has no ceiling for ${missing.join(', ')}.\n` +
    '  Regenerate it: node .husky/peaks-gate-baseline.mjs'
  );
}

/**
 * Is the census still measuring under the policy the ceiling was seeded under?
 *
 * THE HOLE THIS CLOSES (F2, measured by the security audit 2026-09-30): the
 * artifact bound the row to its LINE CONVENTION and to nothing else. Re-deciding
 * the inputs moved the number the row ratchets and the gate called it green —
 * caps 300/500 → 174, 400/600 → 162, 800 → **40 and exit 0**, and dropping `ts`
 * from the extension list → 5 over cap with 43 counted files, which the
 * `countedFiles <= 0` trip above cannot catch because 43 is not 0. A ratchet whose
 * input can be re-decided in the same commit is not a ratchet.
 *
 * The inputs are read off the artifact, which the generator wrote from a census
 * envelope, and compared against the envelope of this run — so a mismatch means
 * the POLICY MOVED between seeding and checking, which is a policy decision, not a
 * measurement. Keyed on `scope.source`: a `--control-arm` run does not measure the
 * row, so its scope inputs are not compared here (the leg disclaims the row instead).
 */
export function fileSizeInputTrips(envelope, artifact) {
  if (envelope.scope?.source !== FS_WHOLE_SCOPE_SOURCE) return [];
  const recorded = artifact.fileSizePolicyInputs;
  if (recorded === undefined || recorded === null || typeof recorded !== 'object') {
    return [
      `the baseline records no file-size policy inputs, so nothing binds its ${FS_CEILING_KEY} ` +
        'ceiling to the policy that produced it'
    ];
  }
  const asText = (value) => (Array.isArray(value) ? value.join(',') : String(value ?? ''));
  const live = (path) =>
    asText(path.split('.').reduce((current, part) => (current ?? {})[part], envelope));
  // `fileSizeLineConvention` predates the inputs object and stays where the docs
  // point at it; the lookup falls back to the artifact's top level for it.
  const pairs = [
    ['line convention', 'convention', 'fileSizeLineConvention'],
    ['default cap', 'caps.defaultCap', 'defaultCap'],
    ['tests cap', 'caps.testsCap', 'testsCap'],
    ['scope dirs', 'scope.dirs', 'scopeDirs'],
    ['scope extensions', 'scope.extensions', 'scopeExtensions']
  ];
  // THE SECOND SCOPE'S INPUTS ARE BOUND THE SAME WAY (§2.32). A hooks ceiling that
  // ratchets a number while its cap, its directories, its extension list or its unit
  // can be re-decided underneath it is the F2 hole wearing a new label: measured on
  // 2026-09-30, re-deciding the main cap moved the row 174 → 40 and the gate stayed
  // green. Keyed on the hooks block's own source, because a control-arm run does not
  // measure the row and the leg disclaims it instead.
  if (envelope.hooks?.scope?.source === FS_HOOKS_WHOLE_SCOPE_SOURCE) {
    pairs.push(
      ['hooks line convention', 'hooks.convention', 'hooksLineConvention'],
      ['hooks cap', 'hooks.caps.hooksCap', 'hooksCap'],
      ['hooks scope dirs', 'hooks.scope.dirs', 'hooksScopeDirs'],
      ['hooks scope extensions', 'hooks.scope.extensions', 'hooksScopeExtensions']
    );
  }
  const trips = [];
  for (const [label, envelopePath, recordedKey] of pairs) {
    const seeded = asText(recorded[recordedKey] ?? artifact[recordedKey]);
    const measured = live(envelopePath);
    if (seeded !== measured) {
      trips.push(`${label}: ceiling seeded under ${seeded}, this census measured ${measured}`);
    }
  }
  return trips;
}

/** The refusal the trips add up to. */
export function describeInputTrips(trips) {
  return (
    'REFUSING to compare the file-size leg against its ceiling — the policy the census just ' +
    'measured is not the policy the ceiling was seeded under:\n' +
    trips.map((trip) => `    - ${trip}`).join('\n') +
    '\n  Either restore the policy inputs the ceiling was seeded under, or treat this as a policy ' +
    'change: re-decide the cap, regenerate the baseline, and land the re-seed as its own reviewable ' +
    'commit — never as a green gate run.'
  );
}

/** One line of evidence under the row, so the number is never bare. */
export function describeFileSizeEnvelope(env) {
  const buckets = Object.entries(env.byDir ?? {})
    .map(([dir, totals]) => `${dir} ${totals.files}`)
    .join(', ');
  return (
    `  scope note: the census counted ${env.scope.countedFiles} file(s) in ${env.scope.source} ` +
    `against caps ${env.caps.defaultCap}/${env.caps.testsCap} raw lines (${env.convention}); ` +
    `${env.overCap} over cap, ${env.excessLines} excess lines (${buckets}).`
  );
}

/**
 * The same line of evidence for the second scope, naming the files it counted — the
 * `.husky/` scope is four or five files, so its row is checkable from the log without
 * re-running the census, which is precisely what the main pair has never been able to
 * say about this directory.
 */
export function describeHooksFileSizeEnvelope(env) {
  const hooks = env.hooks;
  const files = (hooks.files ?? []).map((entry) => `${entry.file} ${entry.lines}`).join(', ');
  return (
    `  hooks scope note: the census counted ${hooks.scope.countedFiles} hooks file(s) in ` +
    `${hooks.scope.source} against cap ${hooks.caps.hooksCap} raw lines (${hooks.convention}); ` +
    `${hooks.overCap} over cap, ${hooks.excessLines} excess lines` +
    (files === '' ? '.' : ` (${files}).`)
  );
}

/**
 * What a control arm measured, stated as itself: the count of the NAMED FILES, and
 * a refusal to be read as the repo row. Printed instead of `ceiling held` — the
 * sentence F1 found being said about a measurement that had not been made.
 */
export function describeControlArmRun(env, ceiling) {
  return (
    `  CONTROL ARM — NOT THE REPO ROW: this run counted the ${env.scope.countedFiles} ` +
    `file(s) the caller named, not the census scope, so ${env.overCap} over cap is a ` +
    `statement about those files alone. ${FS_CEILING_KEY} counts ${FS_WHOLE_SCOPE_SOURCE} ` +
    `(ceiling ${ceiling}); run \`node .husky/peaks-gate.mjs file-size\` with no paths for ` +
    'it. The two hooks rows are disclaimed in the same breath: a named list is not the ' +
    `${FS_HOOKS_WHOLE_SCOPE_SOURCE} scope either, so ${FS_HOOKS_CEILING_KEY} and ` +
    `${FS_HOOKS_EXCESS_CEILING_KEY} are not claimed by this run. Do not read this exit ` +
    'code as the repo holding.'
  );
}

/** Where a line of the leg's output goes: the measurement is stdout, the verdict is stderr. */
const LEG_STREAMS = { out: (text) => console.log(text), err: (text) => console.error(text) };

/**
 * The leg's lines, IN THE ORDER they reach the log: what was measured, then the
 * verdict. Both callers print through this, so neither can reorder one past the
 * other or drop the evidence when it is refusing.
 *
 * WHY THE ORDER IS PART OF THE CONTRACT (repair cycle 2, rid `2026-09-30-cap-unify-01`).
 * Both callers used to test `refusal` and return before the envelope line was
 * written, so the run that most needed its numbers — `REFUSING to compare the
 * file-size leg against its ceiling`, which fires exactly when the policy moved —
 * printed exit 1 and NO numbers at all: not the caps it measured, not the count,
 * not how many files it looked at. That is the same failure this slice keeps
 * encoding, one layer down: a gate that refuses to show what it COULD see is as
 * unreviewable as one that vouches for what it cannot see. The exit code stays 1;
 * the measurement comes out first, because it is the evidence FOR the refusal.
 *
 * A leg that never got a measurement (the census crashed, or a named subset was
 * refused outright) has `envelope: null` and prints the verdict alone — the fix
 * must not invent a scope note for a run that measured nothing.
 *
 * `write` is injectable so the ORDER is asserted, not promised:
 * `tests/unit/lint/file-size-gate-leg.test.ts` records the stream/text pairs a
 * tripping leg produces. Production callers pass nothing and get `console`.
 */
export function printFileSizeLeg(
  size,
  ceiling,
  write = (stream, text) => LEG_STREAMS[stream](text)
) {
  if (size.envelope !== null) {
    write(
      'out',
      size.controlArm
        ? describeControlArmRun(size.envelope, ceiling)
        : describeFileSizeEnvelope(size.envelope)
    );
    // The second scope's evidence, on the same rule as the first: printed for a run
    // that measured the row, not printed for one that did not. `hooks` is absent only
    // on a synthetic envelope — a real census that cannot report it has already been
    // refused by `hooksEnvelopeProblem`, so a leg never reaches this line with a
    // number it cannot explain.
    if (!size.controlArm && size.envelope.hooks) {
      write('out', describeHooksFileSizeEnvelope(size.envelope));
    }
  }
  if (size.refusal !== null) {
    write('err', `peaks-gate: ${size.refusal}`);
    write('err', '');
    return false;
  }
  return true;
}
