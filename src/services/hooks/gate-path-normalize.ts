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
 * The arithmetic lives apart from the decision on purpose: the decision is
 * the gate's rule, and this is the path arithmetic it rests on. The file the
 * decision sits in was at its size cap, and the arithmetic needs room.
 */

import { isAbsolute, relative, resolve } from 'node:path';

import { normalizePath } from '../../shared/path-utils.js';

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
 * The path of `target` relative to `root`, when `target` is INSIDE `root`;
 * `null` when it is not — the target is outside the root, or it is the root.
 */
function relativizeInsideRoot(target: string, root: string): string | null {
  const relativePath = normalizePath(relative(root, target));
  if (relativePath.length === 0) return null;
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  return stripLeadingDotSegments(relativePath);
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
