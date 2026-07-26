// ---------------------------------------------------------------------------
// Search / read-side surface for project memories.
//
// This module owns the read path: enumerate memory files in
// `.peaks/memory/`, parse each through the frontmatter parser, bucket by
// kind, and surface the result. Bootstrap (creating the directory + a
// full-shape empty index on a stock project) also lives here because the
// read-side is the first caller that observes the absence.
//
// Exported:
//   - `listMarkdownFiles` — bounded DFS of `.md` files, skipping dotfiles
//     and symlinks, returning a sorted, repo-relative path list.
//   - `readProjectMemories` — top-level read. Returns a
//     `ProjectMemoryReadResult` with memories, total, and `byKind`.
//   - `readProjectMemoryBody` — single-memory lookup by name; returns
//     null when the memory does not exist.
//   - `ensureMemoryBootstrap` — fail-open helper that materialises
//     `.peaks/memory/` + `index.json` if they are missing. Used by
//     presence / skill-bootstrap callers and from inside `readMemoryIndex`
//     when the directory is empty.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type {
  MemoryIndex,
  MemoryIndexEntry,
  ProjectMemoryKind,
  ProjectMemoryReadResult,
  ProjectMemoryShowResult,
  StoredProjectMemory
} from '../types.js';
import { parseStoredMemoryFile } from '../parsers/frontmatter.js';
import { assertSafeProjectMemoryDir, normalizeRoot } from '../store/paths.js';

export function listMarkdownFiles(dirPath: string, options: { maxDepth?: number; skipDotfiles?: boolean } = {}): string[] {
  if (!existsSync(dirPath)) return [];

  const { maxDepth = Infinity, skipDotfiles = true } = options;
  const files: string[] = [];
  const stack: Array<{ path: string; depth: number }> = [{ path: dirPath, depth: 0 }];

  while (stack.length > 0) {
    const frame = stack.pop() as { path: string; depth: number };
    if (frame.depth > maxDepth) continue;
    for (const entry of readdirSync(frame.path, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (skipDotfiles && entry.name.startsWith('.')) continue;
      const entryPath = join(frame.path, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push({ path: entryPath, depth: frame.depth + 1 });
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(entryPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export function emptyByKind(): Record<ProjectMemoryKind, StoredProjectMemory[]> {
  return {
    project: [],
    rule: [],
    decision: [],
    reference: [],
    feedback: [],
    convention: [],
    module: [],
    lesson: []
  };
}

export function emptyIndex(): MemoryIndex {
  // Cast through unknown: we *intend* the two halves to together cover the
  // union `ProjectMemoryKind`, but TS does not know that. The `MemoryIndex`
  // type's `hot` / `warm` fields together cover the union; we split the
  // construction so the JSON output mirrors the hot/warm layout the reader
  // expects.
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    hot: {
      feedback: [],
      decision: [],
      rule: [],
      convention: [],
      module: [],
      lesson: []
    } as unknown as Record<ProjectMemoryKind, MemoryIndexEntry[]>,
    warm: {
      project: [],
      reference: []
    } as unknown as Record<ProjectMemoryKind, MemoryIndexEntry[]>
  };
}

export function renderEmptyIndex(): string {
  return JSON.stringify(emptyIndex(), null, 2) + '\n';
}

/**
 * Ensure `.peaks/memory/` and its `index.json` exist for a project, with
 * the same full-shape empty index the generator emits when there are zero
 * memories. Idempotent — safe to call on every skill activation.
 *
 * Why this exists: before this helper, `.peaks/memory/` was only created
 * by `extractSessionMemories` when at least one memory markdown was being
 * written, and `index.json` was only emitted by the generator when at
 * least one markdown was on disk. Stock projects therefore had no
 * `.peaks/memory/` directory and no index, even after `peaks project
 * memories` was read. Bootstrap closes that cold-start gap.
 *
 * This function is fail-open for the same reason the rest of the
 * presence layer is fail-open: a failure here must NOT block skill
 * activation. Any error is swallowed and surfaced only via the returned
 * boolean. Callers that need the truth should check the result.
 */
export function ensureMemoryBootstrap(projectRoot: string): boolean {
  try {
    const normalizedRoot = normalizeRoot(projectRoot);
    const memoryDir = assertSafeProjectMemoryDir(normalizedRoot);
    const indexPath = join(memoryDir, 'index.json');

    mkdirSync(memoryDir, { recursive: true });

    if (!existsSync(indexPath)) {
      writeFileSync(indexPath, renderEmptyIndex(), { mode: 0o644 });
    }
    return true;
  } catch {
    return false;
  }
}

export function readProjectMemories(projectRoot: string): ProjectMemoryReadResult {
  const normalizedRoot = normalizeRoot(projectRoot);
  const memoryDir = assertSafeProjectMemoryDir(normalizedRoot);

  // Read-side bootstrap: on a stock project the directory does not exist
  // yet. Reading must not return an error, but we also want the directory
  // to materialise (along with a full-shape empty index) so subsequent
  // `peaks project memories` invocations, `readMemoryIndex`, and any
  // extraction call find a stable target. The helper is fail-open.
  if (!existsSync(memoryDir)) {
    ensureMemoryBootstrap(normalizedRoot);
  }

  const memories: StoredProjectMemory[] = [];
  for (const filePath of listMarkdownFiles(memoryDir)) {
    const parsed = parseStoredMemoryFile(readFileSync(filePath, 'utf8'), filePath);
    if (parsed) memories.push(parsed);
  }
  memories.sort((left, right) => left.name.localeCompare(right.name));

  const byKind = emptyByKind();
  for (const memory of memories) {
    byKind[memory.kind].push(memory);
  }

  return {
    projectRoot: normalizedRoot,
    memoryDir,
    total: memories.length,
    byKind,
    memories
  };
}

/**
 * Read a single project memory's full body by name. Returns null when
 * the memory does not exist. The on-disk body is returned verbatim
 * (pretty). The CLI layer applies `formatMdCompact` when `format: 'compact'`
 * is requested. Slice 023 (R3).
 */
export function readProjectMemoryBody(projectRoot: string, name: string): ProjectMemoryShowResult | null {
  const normalizedRoot = normalizeRoot(projectRoot);
  const memoryDir = assertSafeProjectMemoryDir(normalizedRoot);
  if (!existsSync(memoryDir)) {
    ensureMemoryBootstrap(normalizedRoot);
  }
  for (const filePath of listMarkdownFiles(memoryDir)) {
    if (basename(filePath, '.md') !== name) continue;
    const parsed = parseStoredMemoryFile(readFileSync(filePath, 'utf8'), filePath);
    if (parsed === null) continue;
    const updatedAt = readMemoryFileMtime(filePath);
    return {
      projectRoot: normalizedRoot,
      memoryDir,
      name: parsed.name,
      body: parsed.body,
      filePath,
      updatedAt,
      kind: parsed.kind,
      title: parsed.title,
      pretty: true
    };
  }
  return null;
}

function readMemoryFileMtime(filePath: string): string {
  try {
    return statSync(filePath).mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}