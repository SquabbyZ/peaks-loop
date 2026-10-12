/**
 * `.husky/staged-parity/worktree-side.mjs` — the DISK half of the staged-parity leg.
 *
 * WHY THIS IS A SECOND FILE. `decide.mjs` is pure and `.husky/peaks-gate-staged-parity.mjs`
 * is at 296 of the 300-line hooks cap, so the half that reads the disk lives here
 * rather than pushing the entry over — the same reason `decide.mjs` itself was split
 * out. Nothing decides anything here: this module answers "what is this path on disk,
 * as git sees it", and `decide.mjs` judges the answer.
 *
 * WHY THE DISK SIDE GOES THROUGH `git hash-object`. `git commit` ships the INDEX, i.e.
 * what `git add` stored — the file's bytes AFTER git's clean filter. A raw
 * `readFileSync` compares that filtered blob against UNFILTERED worktree bytes, and
 * this repo has `core.autocrlf=true` in git's own system config, so a file an editor
 * (Notepad, a PowerShell redirect, generated output) wrote with CRLF is stored as LF:
 * the two sides differ by construction while `git diff --quiet` exits 0. The refusal
 * then printed `git add` as the remedy, which cannot change that outcome — it was
 * already a no-op when it was printed — so the committer's only ways past the gate
 * were rewriting the file or the exemption token. A gate that refuses a tree git calls
 * clean is the one outcome a commit gate must never have: it teaches `--no-verify`,
 * and that turns every leg off.
 *
 * `git hash-object` is the filter-aware identity, MEASURED rather than assumed
 * (2026-10-12, git 2.56.0.windows.2, `core.autocrlf=true` + `.gitattributes`
 * `* text=auto eol=lf`): a CRLF worktree file of 10 B and its staged blob of 8 B carry
 * the SAME object id; `git hash-object <file>` and `git hash-object --stdin-paths`
 * agree with `git rev-parse :<file>` on that file and on the same file edited to
 * genuinely different content, which is a different id from `git rev-parse :<file>`;
 * the reply holds one object id per input line, in input order.
 *
 * ONE SPAWN, NOT ONE PER PATH. `--stdin-paths` takes every path at once, so the cost
 * stays FLAT in the number of paths — the same reason the entry batches ONE
 * `cat-file` for every staged blob instead of one per blob.
 *
 * FAIL CLOSED. A path whose NAME cannot survive that interface (a line break, or a
 * leading double quote, both of which `--stdin-paths` reparses), a hash-object that
 * fails, and a reply whose line count does not match the inputs are all UNCOMPARABLE,
 * and an uncomparable side is a refusal in `decide.mjs`, never a pass.
 */

import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The first non-empty line of anything, for a reason that stays one line long. */
function firstLine(text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim() !== '') return line.trim();
  }
  return 'no reason was reported';
}

/** Why this path cannot be handed to `git hash-object --stdin-paths`, or null. */
function unhandable(path) {
  if (path.includes('\n') || path.includes('\r')) {
    return 'the path contains a line break, which `git hash-object --stdin-paths` reads as the start of another path';
  }
  if (path.startsWith('"')) {
    return 'the path begins with a double quote, which `git hash-object --stdin-paths` would reparse as a C-quoted name';
  }
  return null;
}

/**
 * One worktree path as the FILESYSTEM reports it — the entry's three shapes, minus
 * git's identity, which is added below. `{kind:'bytes', bytes}` here is only a
 * candidate: it becomes a comparable side when git gives it an object id.
 */
function readWorktreeFile(root, path) {
  const abs = join(root, path);
  let stats;
  try {
    stats = lstatSync(abs);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return { kind: 'missing' };
    return { kind: 'uncomparable', reason: `lstat failed (${err.code ?? err.message})` };
  }
  if (stats.isSymbolicLink()) {
    return {
      kind: 'uncomparable',
      reason:
        'the worktree path is a symbolic link, so a byte read would follow it rather than measure it'
    };
  }
  if (!stats.isFile()) {
    return { kind: 'uncomparable', reason: 'the worktree path exists but is not a regular file' };
  }
  try {
    return { kind: 'bytes', bytes: readFileSync(abs) };
  } catch (err) {
    return { kind: 'uncomparable', reason: `unreadable (${err.code ?? err.message})` };
  }
}

/**
 * Git's identity for every path handed in, or the ONE reason none of them could be
 * given one. A failure is shared rather than per-path on purpose: it is one call, so
 * there is no honest way to say which path broke it.
 */
function readOids(run, paths) {
  const oids = new Map();
  if (paths.length === 0) return { oids, failure: null };
  let reply;
  try {
    reply = run(['hash-object', '--stdin-paths'], Buffer.from(paths.join('\n') + '\n', 'utf8'));
  } catch (err) {
    return {
      oids,
      failure: `git hash-object --stdin-paths failed (${firstLine(err.stderr ?? err.message)})`
    };
  }
  const lines = reply.toString('utf8').split('\n').filter((line) => line !== '');
  if (lines.length !== paths.length) {
    return {
      oids,
      failure: `git hash-object --stdin-paths answered ${lines.length} object id(s) for ${paths.length} path(s), so no answer can be attributed to a path`
    };
  }
  paths.forEach((path, index) => oids.set(path, lines[index]));
  return { oids, failure: null };
}

/**
 * The worktree side of every staged path: `{kind:'bytes', oid, bytes}` when git can
 * give the file an identity, and the side it cannot be otherwise. Exactly one entry
 * per path, and a path that cannot be identified is UNCOMPARABLE, never parity.
 */
export function readWorktreeSides(run, root, paths) {
  const sides = new Map();
  const bytes = new Map();
  for (const path of paths) {
    const side = readWorktreeFile(root, path);
    if (side.kind !== 'bytes') {
      sides.set(path, side);
      continue;
    }
    const blocked = unhandable(path);
    if (blocked !== null) {
      sides.set(path, { kind: 'uncomparable', reason: blocked });
      continue;
    }
    bytes.set(path, side.bytes);
  }
  const { oids, failure } = readOids(run, [...bytes.keys()]);
  for (const [path, raw] of bytes) {
    sides.set(
      path,
      failure === null
        ? { kind: 'bytes', oid: oids.get(path), bytes: raw }
        : { kind: 'uncomparable', reason: failure }
    );
  }
  return sides;
}
