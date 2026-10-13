/**
 * Building a declaration: hashing the judged paths against the tree, and the
 * detect result the producer substitutes when that build fails. Split from
 * `judged-declaration.ts`, which carries the grammar and the parser.
 */

import { join } from 'node:path';

import {
  JUDGED_SCHEMA_VERSION,
  renderJudgedDeclaration,
  sha256OfFile,
  validateDeclaredPath,
  type JudgedDeclaration,
  type JudgedFile,
  type JudgedParseFailure
} from './judged-declaration.js';
import { resolveHandoffHash } from './handoff-readers.js';

/**
 * Build the declaration for one audit run from the slice's own identifiers.
 * The caller passes its own input object straight through, so the producer
 * needs one call rather than an argument list it would have to grow a branch
 * to guard.
 */
export function buildJudgedDeclarationFor(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly rid: string;
  readonly generatedAt: string;
  readonly judgedPaths: readonly string[];
}): { ok: true; declaration: JudgedDeclaration; handoffHash: string } | JudgedParseFailure {
  const handoffHash = resolveHandoffHash(input.projectRoot, input.sessionId, input.rid);
  const built = buildJudgedDeclaration({
    projectRoot: input.projectRoot,
    judgedAt: input.generatedAt,
    handoffHash,
    paths: input.judgedPaths
  });
  return built.ok ? { ...built, handoffHash } : built;
}

/** Build a declaration from concrete paths, hashing each against the tree.
 *  `roots` is always empty here: no producer in this repo emits a directory
 *  root yet, so the gained-path arm is reachable only through the grammar, not
 *  through a run. The check supports it and tests it; this builder does not
 *  offer it. */
export function buildJudgedDeclaration(input: {
  readonly projectRoot: string;
  readonly judgedAt: string;
  readonly handoffHash: string;
  readonly paths: readonly string[];
}): { ok: true; declaration: JudgedDeclaration } | { ok: false; code: string; detail: string } {
  const files: JudgedFile[] = [];
  const seen = new Set<string>();
  for (const raw of input.paths) {
    const checked = validateDeclaredPath(raw);
    if (!checked.ok) return { ok: false, code: 'declaration-path', detail: checked.detail };
    if (seen.has(checked.path)) continue;
    seen.add(checked.path);
    const hashed = sha256OfFile(join(input.projectRoot, ...checked.path.split('/')));
    if (!hashed.ok)
      return { ok: false, code: `declared-path-${hashed.code}`, detail: checked.path };
    files.push({ path: checked.path, sha256: hashed.sha256 });
  }
  if (files.length === 0)
    return { ok: false, code: 'declaration-empty', detail: 'no judged paths' };
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return {
    ok: true,
    declaration: {
      schemaVersion: JUDGED_SCHEMA_VERSION,
      judgedAt: input.judgedAt,
      handoffHash: input.handoffHash,
      files,
      roots: []
    }
  };
}

/**
 * The rendered section for a set of paths, for a producer that has a project
 * root and a file list but no handoff capsule. Returns an empty string when
 * nothing can be declared — the artifact is then refused by the check, which is
 * the contract's whole point rather than a fallback to fix here.
 */
export function renderJudgedSection(projectRoot: string, paths: readonly string[]): string {
  const built = buildJudgedDeclaration({
    projectRoot,
    judgedAt: new Date(0).toISOString(),
    handoffHash: 'unknown',
    paths
  });
  return built.ok ? `\n${renderJudgedDeclaration(built.declaration)}` : '';
}
