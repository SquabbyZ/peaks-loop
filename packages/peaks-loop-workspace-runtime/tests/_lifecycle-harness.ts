import { leaseFilePath } from '../src/lease/store.js';
import type { LeaseEffects, LeaseFs } from '../src/lease/lifecycle.js';
import type { WorktreeLease } from '../src/lease/types.js';
import type { GitResult, RunGit } from '../src/worktree/git.js';

/** The fixtures the two lifecycle test files share: injected effects and a fake store. */

export const NOW = 1_700_000_000_000;
export const THIRTY_MINUTES = 1_800_000;
export const PROJECT_ROOT = '/work/project';
export const SCOPE = { stateRoot: '/state', sessionId: 'sid-1', projectRoot: PROJECT_ROOT };
export const RUNTIME_DIR = '/state/sid-1';
export const LEASE_ID = '0f0f0f0f0f0f0f0f';
export const OTHER_ID = 'ffffffffffffffff';
export const WORKTREE = `${RUNTIME_DIR}/worktrees/${LEASE_ID}`;
export const OTHER_WORKTREE = `${RUNTIME_DIR}/worktrees/${OTHER_ID}`;
export const LEASE_FILE = leaseFilePath(RUNTIME_DIR, LEASE_ID);
export const OTHER_FILE = leaseFilePath(RUNTIME_DIR, OTHER_ID);

export type Recorded = { readonly argv: readonly string[]; readonly cwd: string };

export function recordingRunGit(result: GitResult = { ok: true, stdout: '' }): {
  calls: Recorded[];
  runGit: RunGit;
} {
  const calls: Recorded[] = [];
  const runGit: RunGit = (argv, opts) => {
    calls.push({ argv, cwd: opts.cwd });
    return result;
  };
  return { calls, runGit };
}

export type MemoryIo = { files: Map<string, string>; writes: string[]; fs: LeaseFs };

export function memoryFs(seed: Record<string, string> = {}): MemoryIo {
  const files = new Map(Object.entries(seed));
  const writes: string[] = [];
  const fs: LeaseFs = {
    readFile: (file) => {
      const value = files.get(file);
      if (value === undefined) throw new Error(`ENOENT: ${file}`);
      return value;
    },
    writeFile: (file, contents) => {
      files.set(file, contents);
      writes.push(file);
    },
    // A directory exists while any file sits beneath it, which is how the real
    // `existsSync` answers for a lease store directory.
    existsSync: (file) =>
      files.has(file) || [...files.keys()].some((key) => key.startsWith(`${file}/`)),
    readdir: (dir) =>
      [...files.keys()]
        .filter((file) => file.startsWith(`${dir}/`) && !file.slice(dir.length + 1).includes('/'))
        .map((file) => file.slice(dir.length + 1))
  };
  return { files, writes, fs };
}

export function effectsOver(io: MemoryIo, runGit: RunGit = recordingRunGit().runGit): LeaseEffects {
  return {
    fs: io.fs,
    runGit,
    now: NOW,
    randomBytes: (size) => Buffer.alloc(size, 0x0f)
  };
}

export function lease(overrides: Partial<WorktreeLease> = {}): WorktreeLease {
  return {
    leaseId: LEASE_ID,
    rid: 'req-001',
    role: 'rd',
    path: WORKTREE,
    branch: 'req-001',
    createdAt: NOW - 1_000,
    expiresAt: NOW + 60_000,
    purpose: 'test lease',
    status: 'active',
    consumedBySubAgents: [],
    ...overrides
  };
}
