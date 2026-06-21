/**
 * Per spec §4.1 Step 1 — Collector.
 *
 * Hard constraints H1 (CLI enforces reads, not LLM), H2 (locked version).
 * All inputs validated via Zod; all reads via Node fs (no shell-out).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { z } from 'zod';
import type {
  CollectedFile, CollectorOutput, DepInfo, FileKind, GitStatus, MemoryEntry,
} from './types.js';

const CollectInputSchema = z.object({
  goal: z.string().min(1),
  project: z.string().min(1),
  depsMode: z.enum(['locked', 'latest']),
  out: z.string().optional(),
});

export type CollectInput = z.infer<typeof CollectInputSchema>;

interface PackageJson {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

function classifyKind(path: string): FileKind {
  if (path.includes('/__tests__/') || path.endsWith('.test.ts') || path.endsWith('.test.tsx')) {
    return 'test';
  }
  if (path.startsWith('config') || path.endsWith('.config.ts') || path.endsWith('.config.js')) {
    return 'config';
  }
  if (path.endsWith('.md') || path.endsWith('.mdx')) {
    return 'doc';
  }
  return 'source';
}

async function scanFiles(root: string, exclude?: string): Promise<ReadonlyArray<CollectedFile>> {
  const out: CollectedFile[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const rel = relative(root, full).replaceAll('\\', '/');
      if (exclude !== undefined && rel === exclude) {
        continue;
      }
      const s = await stat(full);
      out.push({
        path: rel,
        kind: classifyKind(relative(root, full)),
        lines: 0, // computed lazily; full line count is expensive
        hash: '',  // computed lazily via content-hash-cache-pattern
      });
    }
  }
  await walk(root);
  return out;
}

async function readGitStatus(project: string): Promise<GitStatus> {
  // Minimal git info via Node — for now delegate to `git` CLI in a future slice.
  // Returning a placeholder keeps the collector testable; full git integration
  // arrives in Task 4 (RD integration) when git is actually needed downstream.
  return {
    branch: 'main',
    lastCommit: 'unknown',
    dirty: false,
  };
}

async function readMemoryEntries(project: string): Promise<ReadonlyArray<MemoryEntry>> {
  // Read .peaks/memory/*.md frontmatter; for v1 store only hash + path
  // (per H8 — never leak full memory text into LLM context).
  const memDir = join(project, '.peaks', 'memory');
  try {
    const entries = await readdir(memDir);
    return entries
      .filter((n) => n.endsWith('.md'))
      .map((n) => ({
        path: join('.peaks/memory', n),
        title: n,
        relevanceScore: 0,
        excerptHash: '',
      }));
  } catch {
    return [];
  }
}

async function readDeps(
  project: string,
  depsMode: 'locked' | 'latest',
): Promise<Record<string, DepInfo>> {
  if (depsMode === 'latest') {
    throw new Error(
      'BLOCKED: --deps-mode latest is forbidden by spec §4.1 (H2: locked only). ' +
      'Configure the project lockfile to enable locked mode.'
    );
  }
  const pkgPath = join(project, 'package.json');
  let raw: string;
  try {
    raw = await readFile(pkgPath, 'utf8');
  } catch {
    throw new Error(`BLOCKED: no package.json at ${project}`);
  }
  const pkg = JSON.parse(raw) as PackageJson;
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (Object.keys(deps).length === 0) {
    throw new Error(
      `BLOCKED: no locked version found in ${pkgPath}. ` +
      'spec §4.1 forbids running with empty dependencies (H2).'
    );
  }
  const result: Record<string, DepInfo> = {};
  for (const [name, version] of Object.entries(deps)) {
    if (typeof version !== 'string' || version === '') {
      throw new Error(`BLOCKED: dep ${name} has no locked version`);
    }
    result[name] = {
      version,
      source: 'package.json',
      resolved: '', // filled by lockfile parser in a later slice
    };
  }
  return result;
}

export async function collectContext(rawInput: unknown): Promise<{ readonly goal: string; readonly collector: CollectorOutput }> {
  const input = CollectInputSchema.parse(rawInput);
  const exclude = input.out !== undefined
    ? relative(input.project, input.out).replaceAll('\\', '/')
    : undefined;
  const [files, gitStatus, memoryEntries, deps] = await Promise.all([
    scanFiles(input.project, exclude),
    readGitStatus(input.project),
    readMemoryEntries(input.project),
    readDeps(input.project, input.depsMode),
  ]);
  return {
    goal: input.goal,
    collector: { files, gitStatus, memoryEntries, deps },
  };
}
