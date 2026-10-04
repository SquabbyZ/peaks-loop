// tests/unit/lint/_file-size-hooks-walk.ts
//
// THE INDEPENDENT READING for the `.husky/` rows (rid `2026-10-02-hooks-size-rows`,
// backlog §2.32), split out of `_file-size-hooks-fixture.ts` because that harness is a
// measured, capped file under `tests/` and this is the one part of the slice that must
// NOT share a file with the machinery it is checking.
//
// WHY IT IS A WALK AND NOT A QUERY. The census enumerates its scope with
// `git ls-files -- <hooks dirs>` on purpose (`scripts/lint/file-size-census-hooks.ts`):
// that is the set a push carries, so an untracked scratch file cannot inflate a row and
// a deleted-but-staged one cannot silently shrink it. A guard that re-ran that same
// command would agree with the census by construction and prove nothing, so this reads
// the DIRECTORY instead — its own recursive `readdirSync`, the policy's own extension
// set, the policy's own line unit, the policy's own hooks cap. It never shells out to
// git, never spawns the census, and never opens the artifact, which is what makes a
// number it agrees with evidence rather than a copy.
//
// ONE UNIT, ONE POLICY, SAME RULE AS THE CENSUS. The cap, the directories and the
// extensions come from `src/services/scan/file-size-policy.ts`; restating 300 or
// `['mjs']` here would recreate the second copy
// `tests/unit/standards/file-size-cap.test.ts` exists to report.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HOOKS_FILE_SIZE_SCOPE_DIRS,
  countRawLines,
  hasPolicyExtension,
  hooksFileSizeCaps
} from '../../../src/services/scan/file-size-policy.js';

/** One hooks-scope file as the census and the walk both report it. */
export type OverCapEntry = { file: string; lines: number; cap: number; excess: number };

/** What the walk answers for a root: the two rows, and both populations behind them. */
export type HooksWalk = {
  overCap: number;
  excessLines: number;
  files: OverCapEntry[];
  scopedFiles: string[];
};

/**
 * Two lists, because the census reports two populations and an arm that confuses them
 * measures nothing:
 *   `files`       — the over-cap entries, census-shaped, so a walk list can be compared
 *                   path-for-path with `envelope.hooks.files`
 *   `scopedFiles` — EVERY file the walk enumerated, tracked or not, which is the
 *                   population `scope.countedFiles` names. The two differ exactly when
 *                   the walk saw something `git ls-files` cannot see (an untracked file)
 *                   or could not see something it can (a staged deletion), and that
 *                   difference is what the cross-measurement arms assert.
 *
 * Paths come back POSIX and root-relative (`.husky/peaks-gate.mjs`), which is both the
 * census's spelling and the one `isHooksMeasuredFile` understands, so a Windows-native
 * `join` never leaks a backslash into a comparison.
 */
export function walkHooksScope(root: string): HooksWalk {
  const cap = hooksFileSizeCaps().hooksCap;
  const paths: string[] = [];
  const scan = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel2 = rel === '' ? entry.name : `${rel}/${entry.name}`;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) scan(abs, rel2);
      else if (entry.isFile() && hasPolicyExtension(rel2)) paths.push(rel2);
    }
  };
  for (const dir of HOOKS_FILE_SIZE_SCOPE_DIRS) {
    const abs = join(root, dir);
    if (existsSync(abs)) scan(abs, dir);
  }
  const files: OverCapEntry[] = [];
  let excessLines = 0;
  for (const file of paths) {
    const lines = countRawLines(readFileSync(join(root, file), 'utf8'));
    if (lines > cap) {
      files.push({ file, lines, cap, excess: lines - cap });
      excessLines += lines - cap;
    }
  }
  return { overCap: files.length, excessLines, files, scopedFiles: paths.sort() };
}

/**
 * The tools the gate spawns through the REAL tsx, in the staging form a scratch
 * repository needs.
 *
 * WHY HERE. `createFixture` in `_file-size-hooks-fixture.ts` forwards its `node_modules/tsx`
 * to the repository's real tsx, so every tool that leg spawns has to exist in the fixture
 * tree. `.husky/baseline/tool-legs.mjs` now spawns two of them (the silent-warning
 * detector and the comment-hygiene detector), and a builder that had not heard about the
 * second died before it could write an artifact — `ERR_MODULE_NOT_FOUND …
 * comment-hygiene-detector.ts` is the same incident that ate 75 arms once already.
 * So this is ONE list, and a builder that forwards tsx stages both tools from it.
 *
 * The counts are fixed at zero: a builder that needs non-zero silent-warning rows to
 * seed a ceiling passes its own stub for that tool and leaves the rest staged.
 */
export const GATE_TOOL_STUBS: ReadonlyArray<readonly [string, string]> = [
  [
    join('scripts', 'lint', 'comment-hygiene-detector.ts'),
    [
      "const p = process.argv.slice(2).filter((a) => !a.startsWith('-'));",
      "console.log(JSON.stringify({ schemaVersion: 1, scopeSource: 'explicit paths (caller-supplied)', ",
      'scannedFiles: p.length, askedFiles: p.length, commentLines: 0, deadReferences: 0, narrative: 0 }));'
    ].join('\n')
  ]
];

/** The census envelope, in the shape `.husky/peaks-gate-file-size.mjs` requires. */
const CENSUS_ENVELOPE = {
  overCap: 1,
  excessLines: 9,
  convention: 'split(String.fromCharCode(10)).length',
  caps: { defaultCap: 300, testsCap: 500 },
  scope: {
    countedFiles: 3,
    source: 'git ls-files <policy dirs>',
    dirs: ['src'],
    extensions: ['ts']
  },
  files: [{ file: 'src/big.ts', lines: 309, cap: 300, excess: 9 }],
  byDir: { src: { files: 3 } },
  // The `.husky/` block the two hooks rows read (§2.32); refused if absent.
  hooks: {
    overCap: 1,
    excessLines: 4,
    caps: { hooksCap: 300 },
    convention: 'split(String.fromCharCode(10)).length',
    scope: {
      countedFiles: 2,
      source: 'git ls-files <hooks dirs>',
      dirs: ['.husky'],
      extensions: ['mjs']
    },
    files: []
  }
};

/** What the comment-hygiene leg is handed for a batch of `files`. */
const COMMENT_DEBT_ENVELOPE = {
  schemaVersion: 1,
  scopeSource: 'explicit paths (caller-supplied)',
  commentLines: 6,
  deadReferences: 1,
  narrative: 2
};

/**
 * The fixture's `node_modules/tsx`, for a builder that stubs tsx instead of forwarding it.
 *
 * DISPATCHED, NOT FIXED, AND THAT IS THE WHOLE POINT. tsx is the one spawn shared by two
 * legs — `.husky/file-size/measure.mjs` asks it for `scripts/lint/file-size-census.ts`,
 * `.husky/peaks-gate-comment-hygiene.mjs` asks it for the comment detector. A stub that
 * answered every spawn with the census envelope was harmless while the census was the
 * only caller, and became a refusal the moment the second row landed: the
 * comment-hygiene leg received census JSON, found no `deadReferences` in it, and would not
 * seed. Measured, this session: the four builders that stub tsx went red in a group (78
 * arms) from exactly that, and the seed run's own sentence named it —
 * `reported deadReferences=undefined, which is not a count`.
 *
 * The census side is byte-compatible with what the four builders used to inline (four
 * copies of one envelope — the second-copy defect this campaign files most often), so a
 * builder that stages this instead of its own string changes nothing about its rows.
 */
export const TSX_TOOL_STUB = [
  'const argv = process.argv.slice(2);',
  "const tool = String(argv[0] ?? '');",
  "const files = argv.slice(1).filter((a) => !a.startsWith('-'));",
  `const CENSUS = ${JSON.stringify(CENSUS_ENVELOPE)};`,
  `const DEBT = ${JSON.stringify(COMMENT_DEBT_ENVELOPE)};`,
  "const envelope = tool.endsWith('comment-hygiene-detector.ts')",
  '  ? { ...DEBT, scannedFiles: files.length, askedFiles: files.length }',
  '  : CENSUS;',
  "process.stdout.write(JSON.stringify(envelope) + '\\n');",
  ''
].join('\n');

/** One file's bytes AS A COMMIT saw them — the only honest way to read an era. */
export function gitBlobAt(ref: string, rel: string, cwd: string): string {
  return execFileSync('git', ['show', `${ref}:${rel}`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  });
}

/**
 * The ceiling rows the canonical list gained between two of its own readings.
 *
 * `baseline-split-equivalence.test.ts` compares the pinned pre-split generator with the
 * split one, and a comparison of two programs that sanction DIFFERENT row sets needs to
 * ignore exactly the rows only one of them can measure. Deriving that set from the two
 * `CEILING_KEYS` literals is the smallest true projection; typing `['comment…', 'comment…']`
 * would read green the day a row lands and red the day one is corrected.
 */
export function rowsGainedBetween(
  older: readonly string[],
  newer: readonly string[]
): readonly string[] {
  const before = new Set(older);
  return newer.filter((key) => !before.has(key));
}
