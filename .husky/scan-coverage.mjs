/**
 * `.husky/scan-coverage.mjs` — THE one editable spelling of WHICH locations in this
 * repository hold executable code and WHAT looks at each (backlog 9.11 and 9.15).
 *
 * THE DEFECT IT CLOSES. A guard's scope was decided by OMISSION, so a directory
 * outside every list was outside every scan and nothing said so. Measured: a new
 * `.husky/` hook sat outside the `src/**`-scoped path-safety scan, and `.husky/` only
 * got a measured row of its own one slice earlier. Adding the missing name to one more
 * list is the fifth narrowing, not a closure; this module makes the set DECLARED, so
 * the next executable directory is a decision someone writes down — and the check
 * below refuses a directory nobody wrote down.
 *
 * NOT A COPY OF `.husky/lint-scope.mjs`, AND NOT A RIVAL OF IT. That module answers
 * "is this path in the ENFORCED lint scope", a pattern over root `src` plus
 * `packages/<name>/src`; this one answers "does the repository have a scan at all for
 * code at this location", which is true of `tests/`, `scripts/` and `.husky/` too, and
 * false on purpose for four others. `scan` and `uncovered` are the two verdicts, every
 * entry carries exactly one, and a single verdict is not a third state: the declaration
 * is not a place to leave a location undecided.
 *
 * THE UNIT IS THE TOP-LEVEL LOCATION, and `packages` is ONE location rather than one
 * per package — a new package joins the lint scope by existing, which is a decision
 * the scope rule deliberately already made (see `tests/unit/lint/lint-file-list-parity.test.ts`).
 * Four limits, stated rather than left to be found:
 *   - a code file directly at the repository root has no location at all and is outside
 *     this check. Seven exist today (the vitest and stryker configs) and a new one is
 *     not caught. This check is about DIRECTORIES.
 *   - a declared location that no longer holds code is not reported, so a stale entry
 *     can sit here. A stale entry over-claims coverage for a directory with no code in
 *     it; it cannot hide code, which is the direction this check exists for.
 *   - **A `scan` CLAIM IS PROSE THIS CHECK DOES NOT READ.** It verifies WHICH locations
 *     are named, and — for an `uncovered` entry — that the location has not GROWN. It
 *     does not open the legs the `scan` string names, so a location wrongly declared as
 *     scanned would pass here. Verifying a claim against the thing it claims would mean
 *     restating every scan's scope in this module, which is the second-spelling defect
 *     the rest of `.husky/` exists to avoid. Recorded, not fixed.
 *   - `.husky/**` is in no prettier glob (`package.json#scripts['format:check']` covers
 *     `src`, `tests`, `packages`, `scripts`), so this file's formatting is not checked by
 *     the format ratchet. Its own file-size row (`fileSizeHooksOverCap`) does apply.
 *
 * LOADABLE UNDER BARE `node`, LIKE EVERY SIBLING HERE: `.mjs`, no `src/**` import, so a
 * scratch copy of the gate still loads (the reason `.husky/pipeline/contract-verdict.mjs`
 * gives in its header). The one import is the extension list, from the module that owns
 * it, so this file has no second spelling of what "executable code" means.
 */
import { hasLintExtension } from '../scripts/lint/lint-file-list.mjs';

/**
 * Every top-level location holding executable code, and what sees it.
 *
 * `scan` names the leg(s) that measure this location today, in the words a reader of a
 * gate run will meet. `uncovered` names why nothing does — a reason, not an apology:
 * an unmeasured location is a scope decision, and this field is where the decision is
 * readable. An `uncovered` entry MUST also carry `files`, the number of code files it
 * holds: with no scan watching the location, `judgeScanCoverage` refuses a population
 * that has grown past that number, so the row is a ratchet rather than a permission. A
 * regeneration does NOT maintain this list; a location absent from it is refused, so the
 * list moves only when someone means it to.
 */
export const SCAN_COVERAGE = Object.freeze([
  {
    at: 'src',
    scan: 'the lint scope (src/**), the file-size census, the silent-warning and comment-hygiene legs, and the format-check ratchet'
  },
  {
    at: 'packages',
    scan: 'the lint scope (packages/*/src/**), the file-size census, and the format-check ratchet'
  },
  {
    at: 'tests',
    scan: 'the file-size census (measured, and reported as shadow rows rather than as ceilings) and the format-check ratchet (CI job `format-check`)'
  },
  {
    at: 'scripts',
    scan: 'the same two legs as tests/: the file-size census and the format-check ratchet'
  },
  {
    at: '.husky',
    scan: 'the file-size hooks rows (fileSizeHooksOverCap / fileSizeHooksExcessLines), measured from the same census run as the main rows'
  },
  {
    at: 'benchmarks',
    files: 2,
    uncovered:
      'benchmarks/runtime-detached/ is a two-file detached-process bench outside the pnpm workspace (pnpm-workspace.yaml lists . and ./packages/*). Run it by hand; nothing lints, formats or counts it'
  },
  {
    at: 'bin',
    files: 4,
    uncovered:
      'the npm entry shims (node bin/peaks.js). They boot the built CLI and are measured by nothing'
  },
  {
    at: 'config',
    files: 1,
    uncovered:
      'config/eslint/ holds the lint leg its own inputs: .peaks-rules.cjs is the rule set the leg executes and tsconfig.lint.json is the project it resolves. Measuring them with the leg they configure would be the leg judging itself'
  },
  {
    at: 'examples',
    files: 14,
    uncovered:
      'examples/video-demo/ is a standalone Remotion project with its own package.json and lockfile, outside this pnpm workspace'
  }
]);

/** A path as `/`-separated, so a Windows-native one names the same location as a POSIX one. */
function posix(file) {
  return file.split('\\').join('/');
}

/** The top-level location a path lives in, or `null` when the path is a root file. */
export function codeLocation(file) {
  const path = posix(file);
  const slash = path.indexOf('/');
  return slash < 0 ? null : path.slice(0, slash);
}

/**
 * Locations that are not THIS repository's code: dependency and build output. The same
 * three names `tests/unit/standards/_file-size-cap-scan.ts` skips when it walks, because
 * it answers the same question — "is this file the repository's own source?".
 *
 * `.gitignore` keeps these out of the untracked enumeration already, so this is normally
 * redundant; it is spelled because the enumeration is `--exclude-standard` and a
 * repository WITHOUT a `.gitignore` therefore surfaces them. Measured 2026-10-13: the
 * gate's own fixture repositories are exactly that, and `node_modules/eslint/bin/eslint.js`
 * arrived as an undeclared location in three of their arms.
 */
const NOT_REPOSITORY_CODE = new Set(['node_modules', 'dist', 'coverage']);

/**
 * Every location holding executable code, from BOTH enumerations: the tracked list and
 * the working tree's untracked files. The second half is the point — a directory
 * created this minute must become a decision before it is committed, not after, which
 * is the same ordering the census's own leg refuses one level down.
 *
 * Returns `location -> { files, example }`: how many code files the location holds, and
 * the one the refusal prints. The COUNT is not decoration — an entry whose only verdict
 * is `uncovered` has no scan watching it, so this number is the only measurement that
 * location has, and `judgeScanCoverage` ratchets it.
 */
export function codeLocations({ tracked, worktree }) {
  const found = new Map();
  for (const file of [...tracked, ...worktree]) {
    if (!hasLintExtension(file)) continue;
    const at = codeLocation(file);
    if (at === null || NOT_REPOSITORY_CODE.has(at)) continue;
    const seen = found.get(at);
    if (seen === undefined) found.set(at, { files: 1, example: file });
    else seen.files++;
  }
  return found;
}

/**
 * An entry's ONE verdict, or `null` when it carries none — or BOTH.
 *
 * The two-fields case is folded into `null` deliberately: counting an entry under both
 * headings made the three numbers in the printed line sum to more than the number of
 * entries, which is the same defect as reporting a total from one bucket of a two-way
 * split. `null` is also the honest reading — an entry that says two different things
 * has decided nothing.
 */
function verdictOf(entry) {
  const hasScan = typeof entry.scan === 'string';
  const hasUncovered = typeof entry.uncovered === 'string';
  if (hasScan === hasUncovered) return null;
  return hasScan ? 'scanned' : 'uncovered';
}

/** One verdict per entry, so the three counts cannot exceed the entry count. */
function tally(declaration) {
  const counts = { scanned: 0, uncovered: 0, undecided: 0 };
  for (const entry of declaration) {
    const verdict = verdictOf(entry);
    if (verdict === null) counts.undecided++;
    else counts[verdict]++;
  }
  return counts;
}

/**
 * The check. A location holding code and absent from the declaration is a FAILURE,
 * named, with a file from inside it — the input this leg exists to reject is exactly
 * "a directory nobody declared", so that is the input its red arm is built from.
 *
 * AN `uncovered` ENTRY IS ITS OWN RATCHET, AND IT HAS TO BE. A location declared with
 * the reason nothing scans it has no scan to notice new code arriving in it, so without
 * a second condition any future file would be absorbed by a declaration someone wrote
 * about a different tree. The row therefore carries `files`, and this check refuses when
 * the location holds MORE than the row names — the same direction and the same shape as
 * every ceiling in `.peaks/lint/gate-baseline.json`: it may go down on its own, and only
 * a deliberate edit moves it up or hands the location to a scan.
 *
 * `declaration` is a parameter so a control arm can hand in its own weakened copy
 * without editing this file, the way `filterScopeFiles` is exported for the same
 * reason in `scripts/lint/lint-file-list.mjs`.
 *
 * FAIL CLOSED ON A HALF-WRITTEN ENTRY. An entry carrying neither `scan` nor
 * `uncovered` — a mistyped field, say — would otherwise read as "declared, and the
 * reader is told nothing", which is the state this whole module exists to end.
 */
export function judgeScanCoverage({ tracked, worktree, declaration = SCAN_COVERAGE }) {
  const declared = new Map(declaration.map((entry) => [entry.at, entry]));
  const found = codeLocations({ tracked, worktree });
  const failures = [];
  const undeclared = [];
  for (const [at, seen] of found) {
    const entry = declared.get(at);
    if (entry === undefined) {
      undeclared.push(at);
      failures.push(
        `${at}/ holds executable code (${seen.example}) and SCAN_COVERAGE names no scan for it. ` +
          'Add it to .husky/scan-coverage.mjs with the scan that covers it, or with the reason ' +
          'nothing does — an undeclared location is a scope decision made by omission.'
      );
      continue;
    }
    if (verdictOf(entry) !== 'uncovered' || !Number.isInteger(entry.files)) continue;
    if (seen.files > entry.files) {
      failures.push(
        `${at}/ holds ${seen.files} code file(s) and SCAN_COVERAGE names ${entry.files} for a ` +
          `location no scan covers — so nothing measures the ${seen.files - entry.files} that ` +
          `arrived (first: ${seen.example}). A row like this may only shrink: cover the location ` +
          'with a scan, or raise its number if the arrival is meant.'
      );
    }
  }
  const counts = tally(declaration);
  if (counts.undecided > 0) {
    failures.push(
      `SCAN_COVERAGE has ${counts.undecided} entry(ies) carrying neither a \`scan\` nor an ` +
        '`uncovered` reason, or carrying both, so this declaration decides nothing for them.'
    );
  }
  return {
    failures,
    undeclared,
    counts,
    locations: found.size,
    line:
      `scan coverage: ${found.size} code-bearing location(s) — ${counts.scanned} declared with ` +
      `the scan that covers them, ${counts.uncovered} declared with no scan, ` +
      `${undeclared.length} undeclared.`
  };
}
