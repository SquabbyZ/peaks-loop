/**
 * Project-wide comment scan: what the classifier finds across the enforced scope.
 *
 * Scope follows the repository's existing lint boundary — `src` plus each
 * workspace package's `src`, as `.husky/lint-scope.mjs` defines it — rather than
 * a second definition of "product code" written here. Two names for one rule is
 * the failure the parity test in `tests/unit/comments/citation-parity.test.ts`
 * exists to prevent.
 *
 * This is the read side only. Nothing here writes a file: the counts it produces
 * are the numbers a ratchet would start from, and a ratchet seeded from a scan
 * nobody has spot-checked is a gate that will be trained away the first time it
 * refuses a legitimate change.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import {
  scanComments,
  summarize,
  type CommentFileSummary,
  type CommentFinding,
  type CommentFindingKind
} from './comment-hygiene.js';
import { createFsProbe, createRepoProbe } from './repo-path-probe.js';

/** Product-code directories, in report order. */
export const COMMENT_SCAN_SCOPE = ['src', join('packages', 'peaks-loop-mut', 'src')];

const SOURCE_SUFFIXES = ['.ts', '.tsx', '.mts', '.cts'] as const;

function isSourceFile(name: string): boolean {
  return (SOURCE_SUFFIXES as readonly string[]).some((suffix) => name.endsWith(suffix));
}

/**
 * Every source file under one scope dir, repo-relative, sorted.
 *
 * The relative form is not cosmetic: `citationResolves` tries a citation with no
 * repo anchor against the citing file's own directory and its ancestors, so an
 * absolute path here turns every sibling reference into a false "missing file".
 * `relative()` + separator normalisation is what keeps that resolution honest on
 * a Windows host.
 */
export function scopeFiles(projectRoot: string, scopeDir: string): string[] {
  const root = resolve(projectRoot, scopeDir);
  const base = resolve(projectRoot);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (absDir: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (isSourceFile(entry.name)) {
        out.push(relative(base, abs).replace(/\\/g, '/'));
      }
    }
  };
  walk(root);
  return out.sort();
}

export type CommentAuditResult = {
  readonly scannedFiles: number;
  readonly commentLines: number;
  readonly deadReferences: number;
  readonly narrative: number;
  readonly files: readonly CommentFileSummary[];
  readonly findings: readonly CommentFinding[];
};

export type CommentAuditOptions = {
  readonly projectRoot: string;
  /** Narrow to one category, the way the prune will be able to. */
  readonly kind?: CommentFindingKind;
  /** Cap the finding list; totals are never capped. */
  readonly limit?: number;
};

function totalOf(
  files: readonly CommentFileSummary[],
  key: 'deadReferences' | 'narrative'
): number {
  return files.reduce((sum, file) => sum + file[key], 0);
}

/** Scan the enforced scope. Synchronous by design: it is a CLI read path. */
export function auditComments(options: CommentAuditOptions): CommentAuditResult {
  const { projectRoot } = options;
  const exists = createRepoProbe(projectRoot);
  const installed = createFsProbe(projectRoot);
  const kinds = options.kind === undefined ? undefined : [options.kind];
  const findings: CommentFinding[] = [];
  const summaries: CommentFileSummary[] = [];

  for (const scopeDir of COMMENT_SCAN_SCOPE) {
    for (const file of scopeFiles(projectRoot, scopeDir)) {
      const source = readFileSync(resolve(projectRoot, file), 'utf8');
      const input = { file, source };
      const found = scanComments(input, {
        exists,
        installed,
        ...(kinds === undefined ? {} : { kinds })
      });
      if (found.length === 0) continue;
      summaries.push(summarize(input, found));
      findings.push(...found);
    }
  }

  const capped = options.limit === undefined ? findings : findings.slice(0, options.limit);
  return {
    scannedFiles: COMMENT_SCAN_SCOPE.reduce((n, dir) => n + scopeFiles(projectRoot, dir).length, 0),
    commentLines: summaries.reduce((n, file) => n + file.commentLines, 0),
    deadReferences: totalOf(summaries, 'deadReferences'),
    narrative: totalOf(summaries, 'narrative'),
    files: summaries.sort(
      (a, b) => b.deadReferences + b.narrative - (a.deadReferences + a.narrative)
    ),
    findings: capped
  };
}
