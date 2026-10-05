/**
 * Comment-only views of a source file, and whether a citation it makes holds.
 *
 * The shape and candidate rules live in `citation-rules.ts`, shared with the
 * repository's citation guard; this module holds the two things that rule needs in
 * order to be applied: the comment lines of a file, and the probes that answer
 * "does this path resolve here".
 *
 * Deliberately NOT `ts.getLeadingCommentRanges`:
 * `src/services/qa/bdd-test-style-verifier.ts` records that the API returns zero
 * ranges for comment-only blocks, which would silently read a header comment as no
 * comment at all. The spans come from `comment-spans.ts` instead, which keeps both
 * order and line numbers — what the worklist and the prune both need — and knows
 * what character it is inside, which a per-line rule cannot.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  LINE_SUFFIX,
  PATH_SHAPED,
  REPO_ANCHORS,
  SESSION_WORKSPACE_DIRS,
  SYNTHETIC_SEGMENT,
  type Citation
} from './citation-rules.js';
import { commentSpans } from './comment-spans.js';

/** One source line, with its 1-based number, as the classifier sees it. */
export type CommentLine = {
  readonly line: number;
  readonly text: string;
};

/** Repo-relative paths are POSIX even on a Windows host, or every lookup below
 *  compares a `src\a.ts` against the forward-slash keys and the answer is always "no". */
function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * The comment lines of a file: full-line comments, plus the trailing comment of a
 * code line. Non-comment lines are omitted but their numbers survive, so a report
 * can point at the code a comment is attached to.
 *
 * Derived from `commentSpans`, which reads the text as a stream. The previous version
 * decided per line and was wrong in both directions at once: a `//` inside a template
 * literal became a comment (and then a deletion that cut the literal open), while a
 * block comment's interior line that does not start with `*` was missed.
 */
export function commentLines(source: string): CommentLine[] {
  const out: CommentLine[] = [];
  const rows = source.split(/\r?\n/);
  for (const span of commentSpans(source)) {
    for (let line = span.line; line <= span.endLine; line += 1) {
      const row = rows[line - 1];
      if (row === undefined) continue;
      // The first line of a block comment that opens mid-code keeps only its own tail,
      // so a caller never reads the code before `/*` as part of the comment.
      const from = line === span.line ? span.start - lineStart(source, line) : 0;
      out.push({ line, text: row.slice(Math.max(0, from)) });
    }
  }
  return out;
}

/** The offset `source` has advanced by the start of 1-based `line`. */
function lineStart(source: string, line: number): number {
  let at = 0;
  for (let n = 1; n < line; n += 1) {
    const next = source.indexOf('\n', at);
    if (next < 0) return source.length;
    at = next + 1;
  }
  return at;
}

/**
 * The path-shaped backtick spans in a line, in order, with their bounds kept.
 *
 * The bounds are not decoration: two of the candidate rules read the text OUTSIDE
 * the span — an illustration cue sits immediately before it, a `<…>` fill-in wraps
 * it — so a caller that discards positions cannot apply them.
 */
export function citations(text: string): Citation[] {
  const found: Citation[] = [];
  for (const match of text.matchAll(/`([^`\s]+)`/g)) {
    const span = match[1] ?? '';
    const from = match.index ?? 0;
    if (PATH_SHAPED.test(span)) {
      found.push({ span, from, to: from + span.length + 2 });
    }
  }
  return found;
}

/** Every path-shaped span in a line, without its bounds. */
export function citedPaths(text: string): string[] {
  return citations(text).map((citation) => citation.span);
}

/**
 * Is this span a module specifier rather than a repo path? `peaks-loop-shared/result`
 * in prose names an import, and no rule about files applies to it. Decided through
 * the dependency tree instead of an allowlist: the first segment is checked against
 * installed packages, so a new dependency needs no edit here. An allowlist of
 * today's package names would turn every future one into a false finding — and a
 * rule that is wrong the moment the repository grows is a rule that gets widened
 * until it stops meaning anything.
 */
function isInstalledPackageName(
  head: string,
  second: string | undefined,
  installed: (rel: string) => boolean
): boolean {
  const name = head.startsWith('@') && second !== undefined ? `${head}/${second}` : head;
  return installed(`node_modules/${name}`);
}

/**
 * The two shapes a citation may clear without touching the tree: an installed
 * package's module specifier, and a session-runtime dir abbreviated in prose.
 */
function resolvesOutsideTheTree(
  stripped: string,
  exists: (relPath: string) => boolean,
  installed: (relPath: string) => boolean
): boolean {
  const [head, second] = stripped.split('/');
  if (head === undefined) return false;
  if (isInstalledPackageName(head, second, installed)) return true;
  return SESSION_WORKSPACE_DIRS.has(head) && !REPO_ANCHORS.test(stripped);
}

/**
 * The workspace package a citing file belongs to, or null at the repository root.
 *
 * In a pnpm workspace, `src/x.ts` written inside `packages/<name>/src/` names that
 * package's own file, not a repository-root one: three comments in this repository cite
 * `packages/peaks-loop-internal-runtime/src/status-protocol.ts` and
 * `packages/peaks-loop-shared-channel/src/index.ts` by their package-relative spelling,
 * and both files exist. Treating those as dead references would seed a ratchet with
 * findings that refuse the next honest package-internal citation, so the package root is
 * an origin — for a citing file that is itself inside a package, and never for a
 * top-level one.
 */
export function packageRootOf(citingFileRel: string): string | null {
  const segments = citingFileRel.split('/');
  if (segments[0] !== 'packages' || segments[1] === undefined) return null;
  return `packages/${segments[1]}`;
}

/**
 * Does the citation point at a file inside the citing file's OWN workspace package?
 *
 * `join` is POSIX-normalised on the way through, because a `packages\alpha/src/x.ts`
 * key matches nothing on the host this repository is developed on.
 */
function resolvesInOwnPackage(
  stripped: string,
  citingFileRel: string,
  exists: (relPath: string) => boolean
): boolean {
  const pkg = packageRootOf(citingFileRel);
  return pkg !== null && exists(toPosix(join(pkg, stripped)));
}

/**
 * The two origins a repo-anchored citation may be satisfied at: the repository root,
 * or the workspace package the citing file itself lives in.
 *
 * Extracted because `citationResolves` is at the complexity ceiling the shipped rule
 * sets, and an inlined `||` there would have been the second branch this file cannot
 * afford — a limit that forces a helper out is the limit working, not the limit being
 * in the way.
 */
function resolvesAtARootOrigin(
  stripped: string,
  citingFileRel: string,
  exists: (relPath: string) => boolean
): boolean {
  return exists(stripped) || resolvesInOwnPackage(stripped, citingFileRel, exists);
}

/**
 * Does this path-shaped citation resolve anywhere it is allowed to resolve?
 *
 * `installed` must be a filesystem-only probe, not the ignore-widened one:
 * `node_modules` is itself in `.gitignore`, so an ignore-aware answer here is
 * "yes, installed" for every first segment, and the whole dead-reference count
 * collapses to zero while looking perfectly healthy. Measured, not theorised.
 */
export function citationResolves(
  citation: string,
  citingFileRel: string,
  exists: (relPath: string) => boolean,
  installed: (relPath: string) => boolean = exists
): boolean {
  const stripped = citation.replace(LINE_SUFFIX, '');
  if (stripped.length === 0 || SYNTHETIC_SEGMENT.test(stripped)) return true;
  if (resolvesOutsideTheTree(stripped, exists, installed)) return true;
  if (resolvesAtARootOrigin(stripped, citingFileRel, exists)) return true;
  // An anchored citation claims the repo root and nowhere else; anything that did
  // not resolve above is dead.
  if (REPO_ANCHORS.test(stripped)) return false;
  // No repo anchor: read from the citing file's own directory and each ancestor
  // below the repo root, which is where a sibling reference (a subdirectory path
  // written by the file sitting next to it) actually points.
  for (let dir = dirname(citingFileRel); dir.length > 0 && dir !== dirname(dir);) {
    if (exists(toPosix(join(dir, stripped)))) return true;
    dir = dirname(dir);
    if (dir === '.') return false;
  }
  return false;
}

/** The default existence probe, against a real working tree. */
export function treeExists(repoRoot: string): (relPath: string) => boolean {
  return (relPath: string): boolean => existsSync(join(repoRoot, relPath));
}
