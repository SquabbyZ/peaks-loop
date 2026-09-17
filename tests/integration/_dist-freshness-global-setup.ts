// tests/integration/_dist-freshness-global-setup.ts
//
// Preflight for the whole integration suite: refuse to run against a `dist/`
// that does not match the `src/` on disk.
//
// WHY A PREFLIGHT AND NOT AN ASSERTION IN EACH TEST
//
// `vitest.config.integration.ts` documents the suite's real precondition — it
// spawns the BUILT CLI (`bin/peaks.js` -> `dist/`), which is the right way to
// end-to-end test a packaged CLI. The failure mode is that a STALE `dist/`
// makes the suite pass against code that no longer exists: measured
// 2026-09-17, 18 files under `src/` were newer than every artifact in `dist/`
// and the suite was green. A per-test assertion would have to be repeated in
// every file that spawns `bin/peaks.js` (~28 of them) and would still be
// silently absent from the next one. `globalSetup` runs once before the suite
// and cannot be opted out of by an individual file.
//
// THE THREE OUTCOMES, AND WHY NONE OF THEM IS A SILENT PASS
//
//   no-dist   Every build-dependent test skips (`PEAKS_BUILD_AVAILABLE=0` in
//             the config). Nothing claims to have verified anything.
//   fresh     `dist/.dist-stamp.json` matches the current sources — or, for a
//             dist built before the stamp existed, no source is newer than the
//             build. The log line names WHICH rule ran.
//   stale     THROWS, naming the files and the command that fixes it.
//
// The comparison itself — identity (content digest) as the authority, mtime as
// the fallback, and the measurement behind that choice — lives in
// `scripts/dist-freshness.mjs`. `assertDistFresh` below turns its verdict into
// a log line or a throw; it is exported and takes the root explicitly so the
// message can be asserted without changing the process's cwd.

import { evaluateDistFreshness, REBUILD_COMMAND } from '../../scripts/dist-freshness.mjs';

const MAX_NAMED = 8;

/**
 * Returns the one-line status to log, or throws when `dist/` is stale.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function assertDistFresh(projectRoot: string): string {
  const result = evaluateDistFreshness(projectRoot);

  if (result.state === 'no-dist') {
    return '[dist-freshness] no dist/ — build-dependent tests will skip\n';
  }

  if (result.state === 'stale') {
    const evidence = result.method === 'digest'
      ? [
          `  built digest:  ${result.builtDigest.slice(0, 12)}${result.builtAt === null ? '' : ` (${result.builtAt})`}`,
          `  source digest: ${result.digest.slice(0, 12)}`,
        ]
      : [
          '  No usable dist/.dist-stamp.json was present, so the weaker mtime rule ran.',
          '  These source files are newer than every built artifact:',
          ...result.newerSources.slice(0, MAX_NAMED).map((source) => `    ${source.path}`),
          ...(result.newerSources.length > MAX_NAMED ? [`    … (+${result.newerSources.length - MAX_NAMED} more)`] : []),
        ];

    throw new Error(
      [
        '',
        'Integration suite refused to start: dist/ is STALE.',
        '',
        `  dist/ was checked against ${result.fileCount} source file(s) via the '${result.method}' comparison.`,
        ...evidence,
        '',
        '  Every test in this suite that spawns `bin/peaks.js` would have passed',
        '  against code that no longer exists. Rebuild first:',
        '',
        `    ${REBUILD_COMMAND}`,
        '',
        '  (`pnpm test:unit` is the suite that does not need a build.)',
        '',
      ].join('\n')
    );
  }

  // Fresh. Say which rule decided it — a green whose basis is unstated is the
  // ambiguity this guard exists to remove.
  return result.method === 'digest'
    ? `[dist-freshness] dist/ matches all ${result.fileCount} source file(s) (content digest)\n`
    : `[dist-freshness] no stamp; dist/ is not older than any of ${result.fileCount} source file(s) (mtime fallback)\n`;
}

export default function setup(): void {
  process.stdout.write(assertDistFresh(process.cwd()));
}
