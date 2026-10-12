/**
 * `.husky/staged-parity/decide.mjs` — the pure half of the staged-parity leg.
 *
 * Split out of `.husky/peaks-gate-staged-parity.mjs` for the 300-line hooks cap,
 * exactly as `.husky/pipeline/contract-verdict.mjs` is split out of
 * `.husky/peaks-gate-pipeline.mjs`: what stays in the entry is the git plumbing and the
 * assembling, the disk side's own measurement lives in
 * `.husky/staged-parity/worktree-side.mjs`, and what lands here is every decision, so
 * `tests/unit/hooks/staged-parity-gate.test.ts` can drive each branch without a
 * repository. The design, the cost and the non-coverage live in the entry's header —
 * this file assumes them.
 *
 * A SIDE IS ONE OF THREE TAGGED VALUES, which is what makes the comparison total
 * rather than a pile of special cases:
 *   { kind: 'bytes', oid, bytes }      the index holds this blob / the disk holds these bytes
 *   { kind: 'missing' }                no index entry / no file on disk
 *   { kind: 'uncomparable', reason }   cannot be compared, and therefore cannot be passed
 *
 * PARITY IS DECIDED BY `oid`, NEVER BY `bytes`. `oid` is GIT's identity for that side —
 * the index blob's object id on the staged side, `git hash-object` of the file on the
 * worktree side, i.e. the id `git add` would store — and the two are equal exactly when
 * git holds no difference between them. The bytes are carried for the size and the short
 * hash of a refusal's detail and decide nothing. A raw-byte test compares one side
 * THROUGH git's clean filter against one side without it, which `core.autocrlf=true`
 * (set in this repo's git config) turns into a refusal of a file git itself calls clean
 * — `git diff --quiet` exits 0 while the sizes differ, and the printed remedy `git add`
 * cannot change it. That is measured, with the sizes and the git version it was measured
 * at, in `.husky/staged-parity/worktree-side.mjs`.
 *
 * THE EDGES, AND WHAT IS DECIDED FOR EACH. Both sides are read independently, so
 * the four shapes of a real divergence fall out of ONE rule — "both missing is
 * agreement, exactly one missing is a divergence":
 *   - staged, then deleted from the worktree -> the index holds a blob, the disk
 *     holds nothing -> DIVERGENCE.
 *   - added to the index, absent from disk -> the same shape -> DIVERGENCE.
 *   - staged as deleted while still on disk (`git rm --cached`) -> no index entry,
 *     but bytes on disk -> DIVERGENCE.
 *   - a rename -> compared with `--no-renames`, so it arrives as a deletion of the
 *     old path plus an addition of the new one: the old path is absent on BOTH
 *     sides (parity) and the new one is compared normally. Nothing here knows what
 *     a rename is, and it does not have to.
 *   - intent-to-add (`git add -N`) -> never reaches this module: `git diff --cached
 *     --name-only` does not list such an entry and a plain `git commit` does not
 *     record it either (both measured 2026-10-12, git 2.56.0.windows.2: the path
 *     sat in the index with the empty blob and was absent from the resulting tree).
 *     `git commit -a` does record it, taking the content FROM the worktree, so it
 *     cannot ship divergent bytes. NOT COVERED, DELIBERATELY.
 *   - two sides that cannot be compared -> REFUSAL WITH A REASON, never a pass:
 *     "a detector that cannot run is a gate FAILURE, not a zero". The entry names
 *     these; a side is uncomparable when the index entry is a gitlink (mode
 *     160000, the staged object is a commit, not a blob), when the path is
 *     unmerged (several index entries, so there is no single staged blob), when
 *     it is a symlink (mode 120000, the staged blob is the link TARGET while a
 *     worktree read would follow it), when the worktree path is not a regular
 *     file, or when a read throws. THIS TREE TRACKS NONE OF THE FIRST THREE
 *     (re-measured 2026-10-12 during this repair: `git ls-files -s` reports modes
 *     100644 and 100755 only — no 120000, no 160000 — and `git ls-files -u` is
 *     empty), so those arms are correctness elsewhere, not local policy.
 *     THE EXEMPTION TOKEN DOES NOT COVER THIS ARM — see `decideStagedParity`: the
 *     token exempts a divergence the committer chose, never a detector that did not
 *     run, because "could not compare" is not "compared and equal".
 */

import { createHash } from 'node:crypto';

/** The one exemption token, named where both the leg and its tests can read it. */
export const EXEMPT_ENV = 'PEAKS_ALLOW_STAGED_DIVERGENCE';

/** A short, stable fingerprint of one side's bytes — enough to see the shape. */
export function shortHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

/** `size B (hash)` — the same spelling on both sides, so two runs diff by path. */
function described(side) {
  return `${side.bytes.length} B (${shortHash(side.bytes)})`;
}

/**
 * Compare the two sides of one staged path. Pure: both sides are handed in.
 *
 * "Both sides missing" is parity, and that is how a deletion and a rename's old
 * path are handled: no index entry and no file is agreement, not a gap. One side
 * missing where the other is not is a divergence in both directions.
 */
export function compareStagedPath(path, staged, worktree) {
  if (staged.kind === 'uncomparable') {
    return { path, status: 'uncomparable', detail: `index side: ${staged.reason}` };
  }
  if (worktree.kind === 'uncomparable') {
    return { path, status: 'uncomparable', detail: `worktree side: ${worktree.reason}` };
  }
  if (staged.kind === 'missing' && worktree.kind === 'missing') return { path, status: 'parity' };
  if (staged.kind === 'missing') {
    return {
      path,
      status: 'divergence',
      detail: `staged as deleted, ${described(worktree)} still on disk`
    };
  }
  if (worktree.kind === 'missing') {
    return {
      path,
      status: 'divergence',
      detail: `staged ${described(staged)}, absent from the worktree`
    };
  }
  if (staged.oid === worktree.oid) return { path, status: 'parity' };
  return {
    path,
    status: 'divergence',
    detail: `staged ${described(staged)} vs worktree ${described(worktree)}`
  };
}

/**
 * Turn the per-path outcomes into the lines to print and the exit code. Pure.
 *
 *   something could not be compared -> refuse, ALWAYS, token or no token: a detector
 *     that cannot run is a gate FAILURE, not a zero, and the token's own premise is
 *     that the check RAN and saw a difference it was asked to allow. The refusal says
 *     so, and it names how to get out.
 *   a divergence -> refuse, naming every divergent path and the way out.
 *   the token (=1, the only value that counts) -> pass, but name every divergence it
 *     allowed and the one legitimate reason it exists.
 *   otherwise -> pass, naming how many paths were compared (or that none were).
 */
export function decideStagedParity({ outcomes, allowToken, scopeNote }) {
  const sorted = [...outcomes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const diverged = sorted.filter((outcome) => outcome.status === 'divergence');
  const uncomparable = sorted.filter((outcome) => outcome.status === 'uncomparable');
  // ONLY the documented value. Anything else — `false`, `no`, `off`, `0`, `""`, a typo
  // — is NOT an exemption, so the gate runs: someone who writes =false believes they
  // switched the exemption OFF, and any other reading turns it on for them.
  const exempt = allowToken === '1';
  const lines = [
    `staged-parity: ${sorted.length} staged path(s) compared against the worktree — ${scopeNote}`
  ];
  if (uncomparable.length > 0) {
    lines.push(
      `REFUSED — ${uncomparable.length} staged path(s) COULD NOT BE COMPARED. A detector that cannot run is a gate FAILURE, not a zero.`
    );
    for (const outcome of uncomparable) {
      lines.push(`  NOT COMPARED  ${outcome.path}  ${outcome.detail}`);
    }
    if (exempt) {
      lines.push(
        `  ${EXEMPT_ENV}=${allowToken} does NOT cover this: the token exempts a staged/worktree DIVERGENCE, never a path that could not be compared.`
      );
    }
    lines.push(
      '  Fix: make the path(s) above comparable — resolve the conflict, restore the file, or'
    );
    lines.push('  unstage it — then re-run the commit. No token exempts this refusal.');
    return { exitCode: 1, lines };
  }
  if (exempt) {
    lines.push(
      `EXEMPTION ACTIVE — ${EXEMPT_ENV}=${allowToken}: staged and worktree content need not agree`
    );
    lines.push(
      '  KNOWN COST: an environment token leaves no trace in git history, so the commit that'
    );
    lines.push('  skipped this check is indistinguishable in `git log` from one that passed it.');
    if (diverged.length === 0) {
      lines.push('  allowed path(s): none — nothing diverged, so the exemption allowed nothing.');
      return { exitCode: 0, lines };
    }
    lines.push(`  allowed path(s) (${diverged.length}):`);
    for (const outcome of diverged) {
      lines.push(`    DIFFERS  ${outcome.path}  ${outcome.detail}`);
    }
    lines.push(
      '  DELIBERATE PARTIAL STAGING is the one legitimate reason for this: you staged some of'
    );
    lines.push("  a file's hunks now and will stage the rest later. That is why there is a token.");
    return { exitCode: 0, lines };
  }
  if (diverged.length > 0) {
    lines.push(
      `REFUSED — ${diverged.length} staged path(s) differ from the worktree. \`git commit\` ships the INDEX while every test, gate and reviewer here reads the WORKING TREE, so this commit would ship bytes nothing verified.`
    );
    for (const outcome of diverged) lines.push(`  DIFFERS  ${outcome.path}  ${outcome.detail}`);
    lines.push(
      `  Fix: re-run \`git add\` on the path(s) above, which stages exactly what is on disk now, or set ${EXEMPT_ENV}=1 for deliberate partial staging — that value only, and it exempts a divergence, never a path that could not be compared.`
    );
    return { exitCode: 1, lines };
  }
  lines.push(
    sorted.length === 0
      ? 'OK — the staged set is EMPTY, so nothing was compared (a commit with nothing staged cannot diverge)'
      : "OK — every staged path holds what `git add` would store from the worktree now (compared through git's filters)"
  );
  return { exitCode: 0, lines };
}
