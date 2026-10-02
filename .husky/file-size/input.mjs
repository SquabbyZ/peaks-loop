// The input binding (`fileSizeInputTrips`) that re-derives the census envelope
// against the seeded policy inputs, and the refusal those trips add up to
// (`describeInputTrips`). Bodies moved verbatim from `.husky/peaks-gate-file-size.mjs`
// (rid `2026-10-02-wave9-file-size-split`).

import {
  FS_CEILING_KEY,
  FS_HOOKS_WHOLE_SCOPE_SOURCE,
  FS_WHOLE_SCOPE_SOURCE
} from './constants.mjs';

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
