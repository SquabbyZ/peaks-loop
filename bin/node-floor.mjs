/**
 * The Node version floor, checked by `bin/peaks.js` before it imports the app.
 *
 * WHY THIS FILE IS NEXT TO THE SHIM AND NOT IN `src/`. Every store now imports
 * `node:sqlite`, so on a Node that predates that builtin the failure is raised while
 * resolving the import graph — `ERR_UNKNOWN_BUILTIN_MODULE`, before one line of our code
 * runs. A check inside the CLI would be compiled into the very graph that cannot load.
 * `bin/peaks.js` is already the place that translates pre-app Node failures (a stale
 * `dist/`) into sentences, so the floor lives with it.
 *
 * WHY 24. `node:sqlite` exists in 22.5+ but not as something this code can import
 * unconditionally; 24 is the line measured on the developer host that started this change,
 * where `import { DatabaseSync } from 'node:sqlite'` works with no flag and no warning.
 * The number is asserted against `package.json#engines.node` by
 * `tests/unit/cli/node-floor.test.ts`, because two spellings of one boundary is this
 * repository's oldest defect class.
 *
 * WHAT IT REFUSES TO GUESS. An empty version string is not evidence of an old Node, so it
 * does not block anyone; a NON-empty string that cannot be parsed fails loudly instead,
 * because a wrong "you're fine" costs a crash two commands later and a wrong "too old"
 * costs one confusing message.
 */

/** The major version at which `node:sqlite` is importable with no flag. */
export const MIN_NODE_MAJOR = 24;

/**
 * A short reason string when `version` is below the floor, undefined when it is not.
 *
 * Returns the reason rather than printing it so the caller decides the stream and the exit
 * code, and so the predicate is testable at every version without spawning a Node per case.
 */
export function nodeFloorProblem(version) {
  if (typeof version !== 'string' || version.length === 0) return undefined;
  const major = Number.parseInt(version.replace(/^v/, ''), 10);
  if (!Number.isFinite(major)) {
    return `the running Node version could not read as a version: "${version}"`;
  }
  if (major >= MIN_NODE_MAJOR) return undefined;
  return `Node ${version} predates the builtin SQLite module`;
}

/** The full operator-facing message: what is wrong, and what to do about it. */
export function nodeFloorSentence(version) {
  return (
    `peaks-loop requires Node >=${String(MIN_NODE_MAJOR)}.0.0 — found ${version || 'unknown'}.\n` +
    '  why:    the stores read and write through `node:sqlite`, a Node builtin. It replaced\n' +
    '          a native SQLite addon so that installing this CLI needs no C++ toolchain and\n' +
    '          no prebuilt binary matching your Node ABI.\n' +
    '  fix:    switch to Node ' +
    String(MIN_NODE_MAJOR) +
    '.x (nvm install ' +
    String(MIN_NODE_MAJOR) +
    ' && nvm use ' +
    String(MIN_NODE_MAJOR) +
    '),\n' +
    '          then re-run the same command.\n'
  );
}
