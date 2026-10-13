// .husky/gate/worktree-census.mjs
//
// The census's other half: an in-scope source file that is PRESENT in the working tree
// and in no baseline row (backlog 9.21).
//
// THE DEFECT. `repo` mode's file list is `git ls-files` — the INDEX. A source file that
// is not staged is not in it, so the run cannot mention it, and the per-file leg it is
// compared against (`staged <file>`) judges a file that IS in the working tree. The two
// legs therefore judge different trees, and nothing said so. Measured: a module landed
// with both local legs green and left the whole-repo gate red from that commit onward,
// because the baseline was regenerated BEFORE the file was staged — the generator walks
// the same index, so the new module got no `files[]` row and the next slice's read of
// HEAD found a red it then had to prove was pre-existing.
//
// THE RULE IS THE CENSUS'S OWN, NOT A SECOND ONE. The visible-but-unmeasured set is
// `git ls-files --others --exclude-standard` (untracked, not ignored) filtered by
// `inScope` — the same predicate `lintFileList` applies to the index, imported from
// `.husky/gate/context.mjs` rather than spelled here, so the two cannot disagree about
// what "source" means. Of those, the ones this leg refuses are the ones
// `.peaks/lint/gate-baseline.json` names no row for: a file the baseline already
// tolerates was seen by a generation run, which is the state this leg exists to produce.
//
// IT IS STILL A RATCHET. The leg does not ask for a clean repository and does not ask
// for a regeneration: it asks for one row per in-scope file the index cannot carry, and
// an untracked file that already has a row is silent. A commit that merely touches a
// tolerated file never reaches here.

/**
 * `{ failures, named }` for the in-scope working-tree files the table does not name.
 *
 * `scoped` is the untracked-and-not-ignored list already filtered to the lint scope by
 * the caller, which owns that filter (one spelling, in `context.mjs`); `table` is
 * `baseline.files`, the per-file row map the per-file legs read.
 */
export function judgeWorktreeCensus({ scoped, table }) {
  const named = [];
  const failures = [];
  for (const file of scoped) {
    if (table[file] !== undefined) continue;
    named.push(file);
    failures.push(
      `${file}: in the lint scope, present in the working tree, and the baseline names no ` +
        'row for it. The census reads `git ls-files`, so it cannot see an unstaged file, and ' +
        'the generator walks the same index — regenerating before staging would omit it too. ' +
        'Stage it first, then regenerate: `git add <file> && node .husky/peaks-gate-baseline.mjs`.'
    );
  }
  return { failures, named };
}
