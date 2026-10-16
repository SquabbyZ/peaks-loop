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
  JUDGED_HEADING,
  parseJudgedDeclaration,
  sha256OfFile,
  type JudgedDeclaration
} from './judged-declaration.js';

export type JudgedRefusal = {
  readonly code: string;
  readonly artifact: string;
  readonly path: string;
};

/**
 * What a refusal means, partitioned by THE ONE QUESTION its codes answer:
 * **did this check complete the observation its sentence would assert?** One
 * sentence for all 17 told a producer to satisfy a declaration a `declared-path-*`
 * refusal had already read — "name the requirement that is unmet" broken one level
 * in, and the reason the arm has been split four times since. The partition below
 * is stated so a reviewer checks it, rather than hunting members:
 *
 *   A. `declaration-*` — **11 codes** (`missing`, `unfenced`, `unterminated`,
 *      `empty`, `schema`, `path`, `hash`, `duplicate`, `bare-root`, `escaped`,
 *      `unparsable`). No declaration was read at all, so the sentence is about the
 *      BLOCK and claims nothing about the tree.
 *   B. `artifact-unreadable` — **1**. The artifact was not read; nothing about its
 *      declaration is known.
 *   C. `declared-path-unreadable` — **1**. The path was reached and could not be
 *      read, so its hash is **UNKNOWN**, not mismatched. Its own arm because the
 *      remedy differs and "re-run the producer" cannot work: a re-run hashes the
 *      same unreadable path and refuses identically.
 *   D. `root-listing-failed` — **1**. A root was declared and could NOT be listed,
 *      so no file under it was compared. Its answer is "no observation", not
 *      "mismatch".
 *   E. `declared-path-gone`, `declared-path-modified`,
 *      `undeclared-path-under-root` — **3**. All three COMPLETED their observation:
 *      a declared path is absent or edited, or the listing succeeded and found a
 *      file under a declared root that the declaration does not name. Together they
 *      are the only codes that may say the tree and the declaration disagree — which
 *      is why they are a LIST and not the `else` arm.
 *   F. **0 codes today** — the fail-safe. Anything unrecognised gets a sentence that
 *      asserts only what is certain (it parsed and was read). Codes A–E are
 *      exhaustive over the 17 the two modules emit, so this arm is unreachable now;
 *      it exists so a NEW code cannot inherit an observation it did not make, which
 *      is the failure this comment records four times.
 *
 * A producer reads this in a refusal, so the classes are the ACTIONS, not the codes:
 * write the block, make the path readable, or re-run the producer.
 */

/** The codes that completed a tree observation, and so may say the tree disagrees. */
const OBSERVED_DISAGREEMENT = new Set([
  'declared-path-gone',
  'declared-path-modified',
  'undeclared-path-under-root'
]);

export function describeJudgedRefusal(refusal: JudgedRefusal): string {
  const where = `Judged declaration ${refusal.code} at ${refusal.path}`;
  if (refusal.code === 'artifact-unreadable') {
    return `${where}: the artifact is present but could not be read, so its \`${JUDGED_HEADING}\` declaration is unverified`;
  }
  if (refusal.code === 'declared-path-unreadable') {
    return `${where}: the declaration is present and parses, but a path it names is present and unreadable, so its hash is unknown — make that path readable; re-running the producer hashes the same path and refuses identically`;
  }
  if (refusal.code === 'root-listing-failed') {
    return `${where}: the declaration is present and parses and names this as a root, but the root could not be listed, so no file under it was compared — re-run the producer, which declares no roots`;
  }
  if (refusal.code.startsWith('declaration-')) {
    return `${where}: the artifact is present; what is unmet is its \`${JUDGED_HEADING}\` block, absent or not one this check can accept`;
  }
  if (OBSERVED_DISAGREEMENT.has(refusal.code)) {
    return `${where}: the declaration was read and the tree compared against it, and the two do not agree — re-run the producer`;
  }
  return `${where}: the declaration is present and parses; this code records no comparison this check completed, so treat the tree as unverified and re-run the producer`;
}

export type JudgedCheckResult = {
  readonly refusals: readonly JudgedRefusal[];
  readonly checked: number;
};

/** Where the security audit artifact may live, newest tier first. */
export function securityArtifactTiers(rid: string): readonly string[] {
  return [
    `audit/security-${rid}.md`,
    'audit/security.md',
    `rd/security-review-${rid}.md`,
    'rd/security-review.md'
  ];
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
