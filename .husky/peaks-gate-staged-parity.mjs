#!/usr/bin/env node
/**
 * peaks-gate-staged-parity — the FIXED-POINT leg of the pre-commit gate.
 *
 * WHY THIS EXISTS. `git commit` ships the INDEX. Every verification in this repo
 * — the tests, the gates, the reviewer reading `git diff` — reads the WORKING
 * TREE. When the two diverge, what was verified and what is committed are not the
 * same bytes, and nothing says so. It fired for real TWICE in session
 * 2026-10-12-session-74bd69, both times the same shape: a repair round edited a
 * tracked file and never re-ran `git add`, so the staged artifact was the
 * PRE-REPAIR version — `race-lane-phase-gate.test.ts` staged at 16004 B / 22 cases
 * while the worktree held 24168 B / 28, and the staged scan module lacked
 * `SHIM_REQUIRE_OBJECTS`. Committing as-staged would have shipped the WEAKER
 * guard while every reviewer had read the worktree. A human-run byte loop caught
 * it; no gate did.
 *
 * WHAT IT MEASURES. For every path `git diff --cached --name-only` reports, the object
 * id of the STAGED BLOB against `git hash-object` of the WORKTREE FILE — i.e. against
 * the id `git add` would store for what is on disk now, so the two sides are compared
 * as git compares them. Content, never mtime: `.husky/peaks-gate-baseline.mjs`
 * regenerates files and lint-staged stashes and restores, so a timestamp is not
 * evidence. A refusal names every divergent path with the byte size AND a short sha256
 * of each side, sorted by path, so two runs are diffable and a size-equal divergence is
 * still visible.
 *
 * THE COMPARISON GOES THROUGH GIT'S OWN FILTER, AND THAT IS THE WHOLE POINT. The
 * staged side is the index blob; the worktree side is `git hash-object` of the file,
 * i.e. the object id `git add` itself would store — so the two are compared as git
 * sees them, never as raw bytes. `core.autocrlf=true` is set in git's system config
 * here and `.gitattributes` pins `* text=auto eol=lf`, so a CRLF file an editor wrote
 * is STORED as LF: its raw bytes differ from its staged blob by construction while
 * `git diff --quiet` exits 0, and a byte comparison refused exactly that file and
 * printed `git add` as the remedy, which cannot change the outcome (measured
 * 2026-10-12: 10 B on disk, 8 B staged, same object id). A gate that refuses a tree git
 * calls clean teaches `--no-verify`, which turns every leg off. Sizes and short hashes
 * are still printed, so a size-equal divergence stays visible; the disk side, its one
 * git call and its fail-closed rules live in `.husky/staged-parity/worktree-side.mjs`.
 *
 * THE EDGES — a path staged then deleted, one added to the index and absent from
 * disk, a rename, one staged as deleted while still on disk, an intent-to-add
 * entry, and the ways a side can be uncomparable — are written down in
 * `.husky/staged-parity/decide.mjs` and `.husky/staged-parity/worktree-side.mjs`,
 * beside the branches that decide them.
 *
 * WHAT IT DELIBERATELY DOES NOT COVER.
 *   - `git commit --no-verify` bypasses it, as it bypasses every other leg. Git
 *     owns that semantics; this leg does not fight it.
 *   - An intent-to-add (`git add -N`) entry, which git itself keeps out of the
 *     staged set and out of the commit — see the sibling's header for the
 *     measurement behind that.
 *   - A file edited in the worktree and NOT staged is not reported. That is what
 *     "unstaged changes" means; reporting it would refuse the normal state of a
 *     working tree.
 *   - It says nothing about whether the staged content is CORRECT, only that git holds
 *     no difference between the index and what was on disk when the leg ran. A file
 *     edited between this leg finishing and the commit completing is not caught.
 *
 * THE EXEMPTION IS LOUD, AND IT IS NARROW. `PEAKS_ALLOW_STAGED_DIVERGENCE=1` — that
 * value and no other: `false`, `no`, `off`, `0` and the empty string all leave the gate
 * ON, because someone who writes `=false` believes they turned the exemption off — and
 * it exempts a DIVERGENCE only. It passes and then NAMES EVERY PATH it allowed, with the
 * same sizes and hashes a refusal would print, and says plainly that DELIBERATE PARTIAL
 * STAGING is the one legitimate reason for it (stage some of a file's hunks now, commit,
 * stage the rest). It does NOT cover a path that could not be compared: the token's
 * premise is that the check ran and saw a difference it was asked to allow, and a
 * detector that cannot run is a gate FAILURE, not a zero. That is why there is a token
 * at all rather than no check — divergence is not always a mistake, but it is never
 * silent. KNOWN COST, as in the sibling leg: an environment token leaves no trace in git
 * history.
 *
 * COST. FIVE git spawns (`rev-parse`, `diff --cached`, `ls-files -s`, one
 * `cat-file --batch` for every staged blob, and one `hash-object --stdin-paths` for
 * every worktree file — that last one is skipped when the staged set is empty), one read
 * per path, no tsx boot. Measured 2026-10-12, MEDIAN of 9
 * whole-process runs: 247 ms with nothing staged, 339 ms for one path, 335 ms for eight
 * — still FLAT in the number of paths, because process spawn dominates and a single run
 * on this box spreads ±60 ms (the eight-path run: 314–490 ms). A bare node boot with one
 * git spawn is ~136 ms and the sibling `peaks-gate-pipeline.mjs` is ~580 ms for the same
 * kind of commit, which is why this leg is appended BEFORE it.
 *
 * THE DECISIONS ARE IN A SIBLING: `compareStagedPath` and `decideStagedParity` in
 * `.husky/staged-parity/decide.mjs`, split out for the 300-line hooks cap as
 * `.husky/pipeline/contract-verdict.mjs` is split out of `peaks-gate-pipeline.mjs`,
 * and so every branch is testable without a repository
 * (`tests/unit/hooks/staged-parity-gate.test.ts`).
 *
 * Exit codes: 0 pass, 1 refused (a divergence, or a path that could not be
 * compared). Nothing else.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// `../.husky/…`, not `./…`: a gate COPY has to be able to load (see the same
// note in `.husky/peaks-gate.mjs` — a scratch copy runs one level under the repo
// root, so `<copy dir>/..` must be the repo root).
import {
  EXEMPT_ENV,
  compareStagedPath,
  decideStagedParity
} from '../.husky/staged-parity/decide.mjs';
// The disk half of the comparison: lstat + read + git's identity for a worktree file,
// split out for the 300-line hooks cap. See its header for why the identity comes from
// `git hash-object` rather than from the bytes just read.
import { readWorktreeSides } from '../.husky/staged-parity/worktree-side.mjs';

/** `git -C <root>` as a callable, so tests can drive the leg without a repo. */
export function makeGit(projectRoot) {
  return (args, input) =>
    execFileSync('git', args, {
      cwd: projectRoot,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      // CAPTURE stderr. Left at the default, git inherits this process's stderr,
      // so a failing git call dumps its own usage text onto the commit line and
      // buries this leg's refusal under it (measured: `git diff --cached` outside
      // a repository prints the whole `git diff --no-index` usage). Captured, it
      // arrives on the error and the refusal can quote its first line.
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(input === undefined ? {} : { input })
    });
}

/** The first non-empty line of anything, for a refusal that stays one line long. */
function firstLine(text) {
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trim() !== '') return line.trim();
  }
  return 'no reason was reported';
}

/** `-z` output: NUL-separated, never quoted. The trailing NUL leaves one empty field. */
function splitZ(buffer) {
  const parts = buffer.toString('utf8').split('\0');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Every index entry, keyed by path — an unmerged path arrives as several entries. */
function readIndexEntries(run) {
  const byPath = new Map();
  for (const line of splitZ(run(['ls-files', '-s', '-z']))) {
    const tab = line.indexOf('\t');
    if (tab === -1) continue;
    const [mode, sha, stage] = line.slice(0, tab).split(' ');
    const path = line.slice(tab + 1);
    const entries = byPath.get(path);
    const entry = { mode, sha, stage: Number(stage) };
    if (entries === undefined) byPath.set(path, [entry]);
    else entries.push(entry);
  }
  return byPath;
}

/**
 * The staged bytes of every sha asked for, in ONE `cat-file --batch`. The reply is
 * a binary stream — `<sha> <type> <size>\n<content>\n` per object — so it is
 * walked by SIZE, not by lines: blob content may contain newlines. This is the
 * leg's only binary parse, and it buys the difference between one spawn for a
 * 30-file commit and 30.
 */
function readBlobs(run, shas) {
  const wanted = [...new Set(shas)];
  const blobs = new Map();
  if (wanted.length === 0) return blobs;
  const reply = run(['cat-file', '--batch'], Buffer.from(wanted.join('\n') + '\n', 'utf8'));
  let pos = 0;
  while (pos < reply.length) {
    const eol = reply.indexOf(10, pos);
    if (eol === -1) break;
    const [sha, type, size] = reply.toString('utf8', pos, eol).split(' ');
    pos = eol + 1;
    if (type === 'missing') {
      blobs.set(sha, { type });
      continue;
    }
    const length = Number(size);
    blobs.set(sha, { type, bytes: reply.subarray(pos, pos + length) });
    pos += length + 1;
  }
  return blobs;
}

/** Why this index entry cannot be compared, or null when it can be. */
function uncomparableReason(entries, blob) {
  if (entries.length > 1) {
    return `${entries.length} unmerged index entries (a conflict): there is no single staged blob`;
  }
  const { mode, sha } = entries[0];
  if (mode === '160000')
    return 'a gitlink (mode 160000): the staged object is a commit, not a blob';
  if (mode === '120000') {
    return 'a symlink (mode 120000): the staged blob is the link TARGET while a worktree read would follow it';
  }
  if (blob === undefined)
    return `the staged blob ${sha.slice(0, 7)} was not returned by cat-file --batch`;
  if (blob.type === 'missing')
    return `the staged blob ${sha.slice(0, 7)} is missing from the object database`;
  if (blob.type !== 'blob')
    return `the staged object ${sha.slice(0, 7)} is a ${blob.type}, not a blob`;
  return null;
}

/** The index side of one staged path, or the reason it cannot be compared. */
function stagedSide(path, entriesByPath, blobs) {
  const entries = entriesByPath.get(path);
  if (entries === undefined) return { kind: 'missing' };
  const blob = blobs.get(entries[0].sha);
  const reason = uncomparableReason(entries, blob);
  if (reason !== null) return { kind: 'uncomparable', reason };
  return { kind: 'bytes', oid: entries[0].sha, bytes: blob.bytes };
}

/**
 * Enumerate the staged set, read both sides of every path, and compare them.
 *
 * EVERY GIT CALL RUNS AT THE REPO ROOT, and the root is asked of git rather than
 * read off `process.cwd()`. The reason is that this leg's commands do not share
 * one convention, and the difference is silent: `git diff --cached --name-only`
 * answers REPO-ROOT paths for the whole tree whatever the caller's directory is,
 * while `git ls-files` is BOTH cwd-relative AND cwd-SCOPED — from `sub/` it
 * answers `sub/inner.txt` and says nothing about `root.txt`, and `--full-name`
 * corrects the spelling WITHOUT lifting that scope (measured 2026-10-12, in a
 * fixture built for exactly this). A HAND RUN FROM A SUBDIRECTORY is the case
 * this exists for: get it wrong and every path outside the subtree reads as "no
 * index entry" and the leg refuses a commit that is perfectly in sync — the worst
 * way for a gate to fail, because the fix a reader reaches for is the token. So
 * one call at the caller's directory discovers the root and every later one runs
 * there. On the commit path git already runs `pre-commit` at the root, so this
 * costs one spawn and changes no answer.
 */
export function collectOutcomes({ projectRoot }) {
  const at = makeGit(projectRoot);
  const reported = at(['rev-parse', '--show-toplevel']).toString('utf8').trim();
  const root = reported === '' ? projectRoot : reported;
  const run = makeGit(root);
  const paths = splitZ(run(['diff', '--cached', '--no-renames', '--name-only', '-z']));
  const entriesByPath = readIndexEntries(run);
  const shas = paths.map((path) => entriesByPath.get(path)?.[0]?.sha).filter(Boolean);
  const blobs = readBlobs(run, shas);
  const disk = readWorktreeSides(run, root, paths);
  return paths.map((path) =>
    compareStagedPath(path, stagedSide(path, entriesByPath, blobs), disk.get(path))
  );
}

/**
 * Print the verdict and set the exit code. Nothing else decides anything.
 *
 * A THROW HERE IS NOT SWALLOWED. If the git state cannot be read at all, no path
 * was compared, and that is the "detector did not run" case: it is turned into an
 * uncomparable outcome, so it refuses — the exemption token does not cover it, because
 * the token exempts a divergence, never a path that could not be compared.
 */
export function main(projectRoot = process.cwd(), env = process.env) {
  let verdict;
  try {
    verdict = decideStagedParity({
      outcomes: collectOutcomes({ projectRoot }),
      allowToken: env[EXEMPT_ENV],
      scopeNote: projectRoot
    });
  } catch (err) {
    verdict = decideStagedParity({
      outcomes: [
        {
          path: '<the git state>',
          status: 'uncomparable',
          detail: `the staged set could not be read, so nothing was compared (${firstLine(err.stderr ?? err.message)})`
        }
      ],
      allowToken: env[EXEMPT_ENV],
      scopeNote: projectRoot
    });
  }
  for (const line of verdict.lines) console.error(line);
  process.exitCode = verdict.exitCode;
}

/** Only a direct `node <this file>` run acts; importing it for tests does not. */
function invokedDirectly() {
  const entry = process.argv[1];
  if (typeof entry !== 'string') return false;
  const self = fileURLToPath(import.meta.url);
  const asked = resolve(entry);
  return process.platform === 'win32' ? asked.toLowerCase() === self.toLowerCase() : asked === self;
}

if (invokedDirectly()) main();
