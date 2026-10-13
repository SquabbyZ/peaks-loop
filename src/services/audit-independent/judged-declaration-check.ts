/**
 * The check that reads a declaration back and refuses when the tree moved.
 *
 * It hashes the bytes of every declared path. A commit does not change bytes,
 * so the check is commitment-invariant by construction rather than by way of a
 * git ref. A rename or a delete removes the path, and a rewrite changes its
 * hash; each is refused by name. A path that appears under a declared root and
 * was not declared is refused too, which is the one arm that needs a tree
 * listing rather than a hash.
 *
 * The listing is `git ls-files -c -o --exclude-standard`, which is invariant
 * under a commit: a commit redistributes tracked and untracked entries, it does
 * not change the set of files on disk.
 *
 * Absence rule, stated where the producer reads it: an artifact that is present
 * but carries no declaration is refused. There is no back-compat window,
 * because this check is reached only from a transition that a slice in flight
 * can re-run.
 */

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import {
  parseJudgedDeclaration,
  sha256OfFile,
  type JudgedDeclaration
} from './judged-declaration.js';

export type JudgedRefusal = {
  readonly code: string;
  readonly artifact: string;
  readonly path: string;
};

export type JudgedCheckResult = {
  readonly refusals: readonly JudgedRefusal[];
  readonly checked: number;
};

/** Where the security audit artifact may live, newest tier first. */
export function securityArtifactTiers(rid: string): readonly string[] {
  return [`audit/security-${rid}.md`, 'audit/security.md', 'rd/security-review.md'];
}

export function resolveSecurityArtifact(
  projectRoot: string,
  sessionId: string,
  rid: string
): { readonly relative: string; readonly absolute: string } | null {
  const root = join(projectRoot, '.peaks', '_runtime', sessionId);
  for (const relative of securityArtifactTiers(rid)) {
    const absolute = join(root, ...relative.split('/'));
    if (existsSync(absolute)) return { relative, absolute };
  }
  return null;
}

type TreeListing =
  | { readonly ok: true; readonly files: readonly string[] }
  | { readonly ok: false; readonly detail: string };

/**
 * List the files git knows about under a prefix. Fail-closed: a git read that
 * did not happen is reported, never returned as an empty list.
 */
export function listTreeFiles(projectRoot: string, prefix: string): TreeListing {
  try {
    const raw = execFileSync(
      'git',
      ['-C', projectRoot, 'ls-files', '-c', '-o', '--exclude-standard', '--', prefix],
      { encoding: 'utf8', windowsHide: true }
    );
    const files = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    return { ok: true, files };
  } catch (error: unknown) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function readArtifact(
  absolute: string
): { ok: true; body: string } | { ok: false; detail: string } {
  try {
    return { ok: true, body: readFileSync(absolute, 'utf8') };
  } catch (error: unknown) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

function fileRefusals(input: {
  readonly projectRoot: string;
  readonly artifact: string;
  readonly files: readonly { path: string; sha256: string }[];
}): JudgedRefusal[] {
  const refusals: JudgedRefusal[] = [];
  for (const file of input.files) {
    const hashed = sha256OfFile(join(input.projectRoot, ...file.path.split('/')));
    if (!hashed.ok) {
      refusals.push({
        code: hashed.code === 'missing' ? 'declared-path-gone' : 'declared-path-unreadable',
        artifact: input.artifact,
        path: file.path
      });
    } else if (hashed.sha256 !== file.sha256) {
      refusals.push({ code: 'declared-path-modified', artifact: input.artifact, path: file.path });
    }
  }
  return refusals;
}

function rootRefusals(input: {
  readonly projectRoot: string;
  readonly artifact: string;
  readonly roots: readonly { path: string }[];
  readonly declared: ReadonlySet<string>;
}): JudgedRefusal[] {
  const refusals: JudgedRefusal[] = [];
  for (const root of input.roots) {
    const listed = listTreeFiles(input.projectRoot, root.path);
    if (!listed.ok) {
      refusals.push({ code: 'root-listing-failed', artifact: input.artifact, path: root.path });
      continue;
    }
    for (const found of listed.files) {
      if (input.declared.has(found)) continue;
      if (found !== root.path && !found.startsWith(`${root.path}/`)) continue;
      refusals.push({ code: 'undeclared-path-under-root', artifact: input.artifact, path: found });
    }
  }
  return refusals;
}

/** Compare the declaration against the tree. Returns refusals, ordered by path. */
export function checkDeclarationAgainstTree(input: {
  readonly projectRoot: string;
  readonly artifact: string;
  readonly declaration: JudgedDeclaration;
}): readonly JudgedRefusal[] {
  const refusals = [
    ...fileRefusals({ ...input, files: input.declaration.files }),
    ...rootRefusals({
      ...input,
      roots: input.declaration.roots,
      declared: new Set(input.declaration.files.map((f) => f.path))
    })
  ];
  return refusals.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Entry point for the transition gate. An artifact that is not there is not
 * this check's business — the artifact-existence prerequisite owns that.
 *
 * LIMIT, measured rather than assumed — the hole that survives is COMPLETENESS,
 * not tampering: the declaration is the producer's own statement, so ten files
 * touched and one declared passes. Nothing here can know what the producer did
 * not say. Rule: a declaration is a claim about the paths it names, never a
 * claim that those are all the paths.
 *
 * Absence rule, stated where the producer reads it, and the reason it is this
 * blunt: a security artifact that IS there must carry a declaration. No section
 * of the artifact turns the check off, because a requirement that any section
 * can switch off is not a requirement — an earlier draft of this file keyed the
 * requirement on a marker line in the coverage block, and deleting that block
 * (while keeping the declaration, and then rewriting a declared path) passed.
 * The cost is stated rather than hidden: an artifact written before this change
 * is refused until the audit is re-run, and the gate only fires on a
 * transition, so nothing already committed is affected.
 */
export function verifyJudgedDeclaration(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly requestId: string;
}): JudgedCheckResult {
  const resolved = resolveSecurityArtifact(input.projectRoot, input.sessionId, input.requestId);
  if (resolved === null) return { refusals: [], checked: 0 };

  const artifact = resolved.relative;
  const read = readArtifact(resolved.absolute);
  if (!read.ok) {
    return { refusals: [{ code: 'artifact-unreadable', artifact, path: artifact }], checked: 0 };
  }

  const parsed = parseJudgedDeclaration(read.body);
  if (!parsed.ok) {
    // The refusal no section can switch off: the declaration is missing, or it
    // does not parse to the grammar.
    return { refusals: [{ code: parsed.code, artifact, path: artifact }], checked: 0 };
  }

  const refusals = checkDeclarationAgainstTree({
    projectRoot: input.projectRoot,
    artifact,
    declaration: parsed.declaration
  });
  return { refusals, checked: parsed.declaration.files.length };
}
