import { relative, resolve, sep } from 'node:path';

export type GitWorktreeRecord = {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly prunable: boolean;
};

type MutableRecord = {
  path: string;
  head: string | null;
  branch: string | null;
  prunable: boolean;
};

export function parseGitWorktreePorcelain(raw: string): ReadonlyArray<GitWorktreeRecord> {
  const records: GitWorktreeRecord[] = [];
  let current: MutableRecord | null = null;
  const flush = (): void => {
    if (current !== null) {
      records.push({
        path: current.path,
        head: current.head,
        branch: current.branch,
        prunable: current.prunable,
      });
    }
    current = null;
  };
  for (const line of raw.split(/\r?\n/)) {
    if (line.length === 0) {
      flush();
      continue;
    }
    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);
    if (key === 'worktree') {
      flush();
      const next: MutableRecord = { path: value, head: null, branch: null, prunable: false };
      current = next;
    } else if (current !== null && key === 'HEAD') {
      current = { path: current.path, head: value, branch: current.branch, prunable: current.prunable };
    } else if (current !== null && key === 'branch') {
      current = { path: current.path, head: current.head, branch: value.replace(/^refs\/heads\//, ''), prunable: current.prunable };
    } else if (current !== null && key === 'prunable') {
      current = { path: current.path, head: current.head, branch: current.branch, prunable: true };
    }
  }
  flush();
  return records;
}

export function isPathInside(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}
