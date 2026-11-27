/**
 * Pure helpers for `peaks sub-agent verify-files`.
 *
 * The fast lane (`--lane fast` on `--from-dag`) proves its declared `files[]`
 * sets are pairwise disjoint BEFORE dispatch. That static check cannot prove
 * where the writes actually landed, so this module reduces a `git status
 * --porcelain` capture to the file set that changed and compares it with the
 * DAG's declared union. The comparison is the merge gate: a file outside the
 * union is an escaped write and the caller refuses the merge.
 *
 * Pure and I/O-free by design — the CLI runs git and hands the raw output in,
 * so the parsing and the set math are unit-testable without a repository.
 */
import type { SliceDag } from './slice-dag.js';

/** Normalize a repo path so declared and changed entries compare identically. */
export function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** `git status --porcelain` entry: two status chars + a space, then the path (`XY path`). */
const PORCELAIN_PATH_OFFSET = 3;
/** Shortest valid entry: `XY p` — the status pair, the space, and one path character. */
const PORCELAIN_ENTRY_MIN_LENGTH = 4;

/**
 * Extract the changed paths from `git status --porcelain -z` output.
 *
 * With `-z` each entry is `XY <path>\0`; a rename/copy entry is followed by a
 * second token holding the source path, which is not a separate change and is
 * skipped. Paths are never quoted in `-z` mode, so no unquoting is needed.
 */
export function parsePorcelainZ(stdout: string): string[] {
  const tokens = stdout.split('\0');
  const paths: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const entry = tokens[i];
    if (entry === undefined || entry.length < PORCELAIN_ENTRY_MIN_LENGTH) continue;
    const status = entry.slice(0, 2);
    paths.push(normalizeRepoPath(entry.slice(PORCELAIN_PATH_OFFSET)));
    if (status.includes('R') || status.includes('C')) i += 1;
  }
  return paths;
}

/** The sorted, de-duplicated union of every node's declared `files[]`. */
export function declaredFilesFromDag(dag: SliceDag): string[] {
  const declared = new Set<string>();
  for (const node of dag.nodes) {
    for (const file of node.files ?? []) {
      if (typeof file === 'string' && file.length > 0) declared.add(normalizeRepoPath(file));
    }
  }
  return [...declared].sort();
}

/** What the working tree changed, and which of it escaped the declared union. */
export interface FileEscapeReport {
  readonly declared: readonly string[];
  readonly changed: readonly string[];
  readonly outside: readonly string[];
}

/** Compare the declared union with the changed set; `outside` is the escape. */
export function computeFileEscape(
  declared: readonly string[],
  changed: readonly string[]
): FileEscapeReport {
  const declaredSet = new Set(declared.map((file) => normalizeRepoPath(file)));
  const changedSet = new Set(changed.map((file) => normalizeRepoPath(file)));
  const outside = [...changedSet].filter((file) => !declaredSet.has(file)).sort();
  return {
    declared: [...declaredSet].sort(),
    changed: [...changedSet].sort(),
    outside
  };
}
