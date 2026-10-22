/**
 * The ONE spelling-independent form of a target path, and the roots a
 * verdict is taken against.
 *
 * The deny families are project-relative prefixes (`src/`, `tests/unit/`, …),
 * so how the incoming path happens to be SPELLED must not decide the verdict:
 * `src/x.ts`, `./src/x.ts` and the absolute spelling of that same file are one
 * file and must get one verdict. Without this, the same edit is denied in one
 * spelling and allowed in another — and the allow is the one that happens.
 *
 * A RELATIVE path is read against the directory the tool call RUNS IN, not
 * against the project root: the file the call writes is the one that
 * directory names, and the two differ whenever the call runs in a
 * subdirectory. The file it lands in is then judged by where it sits inside
 * the project, so the families still name this project's directories.
 *
 * Two readings of one file are offered: the LEXICAL one (`normalizeGatePath`)
 * and the CANONICAL one (`canonicalGatePath`). One directory can be named
 * two ways, and the caller takes the STRICTEST of the two — a wrongly
 * allowed edit is a hole in the gate, a wrongly refused one is only an
 * inconvenience.
 *
 * The arithmetic lives apart from the decision on purpose: the decision is
 * the gate's rule, and this is the path arithmetic it rests on. The file the
 * decision sits in was at its size cap, and the arithmetic needs room.
 */

import { isAbsolute, relative, resolve } from 'node:path';

import { normalizePath, stablePath } from '../../shared/path-utils.js';

/**
 * The roots a verdict is taken against: the project the caller named, and
 * the directory the tool call runs in. A bare string is the project root
 * alone — the shape every earlier call used.
 */
export interface GateRootPair {
  readonly projectRoot?: string | null;
  readonly toolCwd?: string | null;
}

/** The roots, in either of the two spellings. */
export type GateRoots = string | null | GateRootPair;

/** The directory a path is resolved against, or `null` when there is none. */
function resolvedDirectory(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.length > 0 ? resolve(value) : null;
}

/** Drop every leading `./` segment: `./src/x.ts` and `src/x.ts` are one path. */
function stripLeadingDotSegments(path: string): string {
  let out = path;
  while (out.startsWith('./')) out = out.slice(2);
  return out;
}

/**
 * Collapse the `.` and `..` segments of a RELATIVE path, lexically.
 *
 * The base directory does not enter the answer for a path that stays inside
 * it: a `..` cancels the segment before it, for every base. A `..` that would
 * leave the base is KEPT, so the result still reads as "outside", and a path
 * outside the project belongs to no family.
 */
function collapseRelativeDotSegments(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      const last = out.length > 0 ? out[out.length - 1] : null;
      if (last !== null && last !== '..') out.pop();
      else out.push('..');
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

/**
 * The path of `target` relative to `root`, compared LEXICALLY: `null` when
 * `target` is not inside `root` — it is outside the root, or it is the root.
 */
function relativizeLexically(target: string, root: string): string | null {
  const relativePath = normalizePath(relative(root, target));
  if (relativePath.length === 0) return null;
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  return stripLeadingDotSegments(relativePath);
}

/**
 * The path of `target` relative to `root`, when `target` is INSIDE `root`;
 * `null` when it is not — the target is outside the root, or it is the root.
 *
 * The answer is LEXICAL first: the two sides are compared as they are
 * written, so the common case costs no syscall. When the lexical answer is
 * "outside", the question is asked again with the CANONICAL spelling of both
 * sides, because one directory can be named two ways — a symlink, a junction,
 * macOS's `/var` → `/private/var` — and then the lexical answer is a
 * statement about the SPELLING, not about the directory the file is in. The
 * retry can only turn "outside" into "inside", so it can only tighten the
 * gate; whenever the lexical answer says "inside", that answer stands.
 *
 * The canonical answer is relativized against the CANONICAL root, because
 * the project-relative spelling it produces is what the deny families are
 * matched against.
 */
function relativizeInsideRoot(target: string, root: string): string | null {
  const lexical = relativizeLexically(target, root);
  if (lexical !== null) return lexical;
  return relativizeLexically(stablePath(target), stablePath(root));
}

/**
 * The one form of a target path the families are written in.
 *
 *   - separators fold to `/` (a Windows payload spells `src\x.ts`)
 *   - a leading `./` is dropped
 *   - a `..` segment is resolved
 *   - an ABSOLUTE path inside `projectRoot` becomes project-relative
 *   - an absolute path OUTSIDE `projectRoot` stays absolute: the families name
 *     THIS project's directories, and a path in another repository is another
 *     project's business. That is also what the gate already did with every
 *     absolute path, so it is not a widening.
 *   - with no `projectRoot` an absolute path cannot be made relative and is
 *     left as it is
 *
 * A RELATIVE path is read against `toolCwd` — the directory the tool call
 * runs in — and the file it lands in is judged by where it sits inside the
 * project. A path that lands OUTSIDE the project keeps the older reading,
 * the spelling read against the project root, which never widens the gate:
 * it refuses a spelled family the file itself never reached.
 *
 * "Inside" and "outside" are asked LEXICALLY first and CANONICALLY second
 * (see `relativizeInsideRoot`), so two spellings of one directory reach one
 * verdict.
 *
 * This is the LEXICAL reading. The CANONICAL reading — the file named by the
 * directory it really sits in — is a separate question, asked by
 * `canonicalGatePath`.
 */
export function normalizeGatePath(
  filePath: string,
  projectRoot?: string | null,
  toolCwd?: string | null
): string {
  if (filePath.length === 0) return '';
  const slashed = normalizePath(filePath);
  const root = resolvedDirectory(projectRoot);

  if (root === null) {
    return isAbsolute(slashed)
      ? slashed
      : collapseRelativeDotSegments(stripLeadingDotSegments(slashed));
  }
  if (isAbsolute(slashed)) {
    return relativizeInsideRoot(resolve(slashed), root) ?? slashed;
  }

  // The file the call will really touch: the relative path read against the
  // tool call's own directory, then judged by where it lands in the project.
  const base = resolvedDirectory(toolCwd) ?? root;
  const inside = relativizeInsideRoot(resolve(base, slashed), root);
  if (inside !== null) return inside;
  // The file is outside the project: the project reads the spelling instead.
  const spelled = resolve(root, slashed);
  return relativizeInsideRoot(spelled, root) ?? normalizePath(spelled);
}

/** The roots, whichever of the two spellings the caller used. */
export function rootPair(roots: GateRoots | undefined): GateRootPair {
  if (roots === null || roots === undefined) return { projectRoot: null };
  if (typeof roots === 'string') return { projectRoot: roots };
  return roots;
}

/**
 * The CANONICAL project-relative form of a target path: the file the call
 * really touches, named by the directory it REALLY sits in.
 *
 * The lexical form says how the path is WRITTEN; this one says where the
 * file IS. The two differ whenever a directory is named two ways — a
 * symlink, a junction, macOS's `/var` → `/private/var` — and the difference
 * is what a symlinked BASE inside the project looks like: the call runs in
 * `link/`, the file is in `src/`, and the lexical form says `link/x.ts`
 * (no family) while this one says `src/x.ts` (a family).
 *
 * The two sides are compared as they are CANONICALLY spelled, so the answer
 * is the directory the file is in and not the spelling the caller used to
 * reach it. The LEXICAL-first-then-canonical retry belongs to the other
 * reading (`relativizeInsideRoot`), which needs it because a lexical answer
 * can be a statement about the SPELLING rather than about the directory.
 *
 * `null` when the file is outside the project: the project has no name for
 * it, and the spelling-anchored reading the caller already holds is the one
 * that applies. `null` also when there is no project root at all, for the
 * same reason — a path cannot be made relative to nothing.
 */
export function canonicalGatePath(
  filePath: string,
  projectRoot?: string | null,
  toolCwd?: string | null
): string | null {
  if (filePath.length === 0) return null;
  const slashed = normalizePath(filePath);
  const root = resolvedDirectory(projectRoot);
  if (root === null) return null;

  const base = resolvedDirectory(toolCwd) ?? root;
  const target = isAbsolute(slashed) ? resolve(slashed) : resolve(base, slashed);
  return relativizeLexically(stablePath(target), stablePath(root));
}
