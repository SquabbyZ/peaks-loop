/**
 * The tool call's own directory, read from a hook payload.
 *
 * A relative target path belongs to the directory the tool call RUNS in: the
 * file a call writes is the one that directory names, not the one the project
 * root would name. The gate needs that directory to say which file a payload
 * really points at, and the payload is where a harness states it.
 *
 * The read is deliberately narrow — one key, at the top level, holding a
 * string. A `cwd` nested inside the tool's own arguments is an ARGUMENT the
 * tool was handed, not the directory the call runs in, so only the top-level
 * key counts.
 *
 * The absence of the key is not an error: the caller then uses the process's
 * own working directory, which is the same directory whenever the harness runs
 * the hook where the tool call runs.
 */

import { statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { normalizePath, stablePath } from '../../shared/path-utils.js';

export function readToolCallCwd(payload: Readonly<Record<string, unknown>>): string | null {
  const cwd = payload['cwd'];
  if (typeof cwd !== 'string') return null;
  const trimmed = cwd.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Does `dir` name a directory that exists?
 *
 * A path that is not there, or that names a file, is not a directory a tool
 * call can run in, and the gate cannot resolve a relative path against it.
 * The read fails CLOSED on a path it cannot stat: an unreadable directory is
 * not a usable base.
 */
function isExistingDirectory(dir: string): boolean {
  try {
    return statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
  } catch {
    return false;
  }
}

/**
 * Is `dir` the project root itself, or a directory inside it? Compared
 * LEXICALLY: the two are compared as they are written.
 */
function isInsideLexically(root: string, dir: string): boolean {
  const rel = normalizePath(relative(resolve(root), resolve(dir)));
  if (rel.length === 0) return true;
  if (rel === '..' || rel.startsWith('../')) return false;
  return !isAbsolute(rel);
}

/**
 * Is `dir` the project root itself, or a directory inside it?
 *
 * The check is LEXICAL first, like the path arithmetic it feeds: a symlink
 * inside the project that points outside it passes here. A base outside the
 * project resolves the path against a tree the families do not name, so the
 * file it lands in cannot be judged by where it sits in the project — which
 * is the invariant the gate is built on.
 *
 * When the lexical answer says "outside", the question is asked again with the
 * CANONICAL spelling of both sides, because one directory can be named two
 * ways — a symlink, a junction, macOS's `/var` → `/private/var` — and then
 * the lexical answer is a statement about the SPELLING, not about the
 * directory. The retry can only turn "outside" into "inside", so the base it
 * accepts is one that really is inside the project.
 */
function isInsideProject(root: string, dir: string): boolean {
  if (isInsideLexically(root, dir)) return true;
  return isInsideLexically(stablePath(root), stablePath(dir));
}

/**
 * The directory a relative target path is read against.
 *
 * The payload's own `cwd` is the base only when it is a USABLE one: an
 * absolute path naming an existing directory inside the project the caller
 * named. A `cwd` that is missing, relative, names a file, names a directory
 * that is not there, or names a directory outside the project is not a
 * directory this project can judge the file against — and a base that is not
 * the call's own directory resolves the path against the wrong tree, which is
 * how an edit into a hard-blocked family slipped through.
 *
 * The rule ASSUMES the tool call runs inside the named project, which is
 * where the gate is installed. When it does not, the payload `cwd` is
 * rejected and the path is read against the gate's own working directory
 * instead — a different tree — and the error is one-directional: a file that
 * lies outside every family can be denied. It is never the other way round,
 * and that is the trade the gate makes everywhere else: a wrongly allowed
 * edit is a hole, a wrongly refused one is an inconvenience.
 *
 * The fallback is the gate process's own working directory: that is where the
 * hook runs, and in the normal invocation it IS the tool call's directory.
 * The gate does not fail closed here — it uses the best base it has, and a
 * file that lands outside the project is judged by its spelling, which never
 * widens the gate.
 */
export function resolveToolCallBaseDir(
  payload: Readonly<Record<string, unknown>>,
  projectRoot: string,
  fallback: string
): string {
  const cwd = readToolCallCwd(payload);
  if (cwd === null) return fallback;
  if (!isAbsolute(cwd)) return fallback;
  if (!isExistingDirectory(cwd)) return fallback;
  if (!isInsideProject(projectRoot, cwd)) return fallback;
  return cwd;
}
