// The leg's single print path (`printFileSizeLeg`) and the scope-note / control-arm
// lines it writes, plus the module-private stream sink. printFileSizeLeg calls its
// sibling describe* functions within this module. Bodies moved verbatim from
// `.husky/peaks-gate-file-size.mjs` (rid `2026-10-02-wave9-file-size-split`).

import {
  FS_CEILING_KEY,
  FS_HOOKS_CEILING_KEY,
  FS_HOOKS_EXCESS_CEILING_KEY,
  FS_HOOKS_WHOLE_SCOPE_SOURCE,
  FS_WHOLE_SCOPE_SOURCE
} from './constants.mjs';

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
