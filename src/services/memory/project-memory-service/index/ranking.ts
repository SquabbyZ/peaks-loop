// ---------------------------------------------------------------------------
// Index generation + hot/warm kind dispatch.
//
// The memory index is the always-available summary of every memory in
// `.peaks/memory/`. This module owns its write path:
//
//   - `HOT_KINDS` — the kinds whose full body is kept in the index
//     (`feedback`, `decision`, `rule`, `convention`, `module`, `lesson`).
//     Anything not in `HOT_KINDS` lands in `warm` with the same shape.
//   - `readMemoryFileMtime` / `readStoredMemoryNames` — small stat /
//     filename helpers used by the index generator and by the slug-
//     collision idempotency check.
//   - `generateMemoryIndexFile` — rebuild `index.json` from the current
//     directory contents. Called on every `--apply` extraction.
//   - `shouldRegenerateIndex` — mtime-based guard: rebuild only when at
//     least one memory.md has an mtime strictly newer than index.json.
//   - `readExistingIndex` — best-effort read; returns null on any parse
//     failure (caller will treat as "no index").
//   - `readMemoryIndex` — top-level entry point. Decides whether to
//     regenerate, falls back to whatever is on disk, and bootstraps the
//     directory + index on first read of a stock project.
// ---------------------------------------------------------------------------

import { closeSync, constants, existsSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import type { MemoryIndex, MemoryIndexEntry, ProjectMemoryKind } from '../types.js';
import { parseStoredMemoryFile } from '../parsers/frontmatter.js';
import { summarizeMemoryBody } from '../parsers/markdown-pure.js';
import { assertSafeProjectMemoryDir, normalizeRoot } from '../store/paths.js';
import { ensureMemoryBootstrap, listMarkdownFiles, readProjectMemories } from './search.js';

// Hot kinds: full body kept in index for always-available context
const HOT_KINDS = new Set<ProjectMemoryKind>(['feedback', 'decision', 'rule', 'convention', 'module', 'lesson']);

export function readMemoryFileMtime(filePath: string): string {
  try {
    return statSync(filePath).mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function readStoredMemoryNames(memoryDir: string): Set<string> {
  // Two source-of-truth fallbacks for the slug-collision check:
  //   1. Parse frontmatter (the canonical form rendered by
  //      renderMemoryFile / written by both extract paths).
  //   2. Fall back to the bare filename stem, so user-dropped files
  //      without frontmatter (e.g. hand-written memories, legacy
  //      content) still count as a collision and are not overwritten
  //      by an idempotent re-extract.
  const names = new Set<string>();
  for (const filePath of listMarkdownFiles(memoryDir)) {
    const stem = basename(filePath, '.md');
    if (stem.length > 0 && stem !== 'index') names.add(stem);
    try {
      const parsed = parseStoredMemoryFile(readFileSync(filePath, 'utf8'), filePath);
      if (parsed) names.add(parsed.name);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // ignore unreadable files
    }
  }
  return names;
}

export function generateMemoryIndexFile(projectRoot: string, memoryDir: string, indexPath: string): void {
  const memories = readProjectMemories(projectRoot);

  const hot: Record<string, MemoryIndexEntry[]> = {
    feedback: [], decision: [], rule: [], convention: [], module: [], lesson: []
  };
  const warm: Record<string, MemoryIndexEntry[]> = {
    project: [], reference: []
  };

  for (const memory of memories.memories) {
    const entry: MemoryIndexEntry = {
      name: memory.name,
      kind: memory.kind,
      description: memory.body ? summarizeMemoryBody(memory.body) : memory.title,
      sourcePath: memory.filePath,
      sourceArtifact: memory.sourceArtifact,
      updatedAt: readMemoryFileMtime(memory.filePath)
    };

    if (HOT_KINDS.has(memory.kind)) {
      hot[memory.kind]!.push(entry);
    } else {
      warm[memory.kind]!.push(entry);
    }
  }

  for (const kind of [...Object.keys(hot), ...Object.keys(warm)]) {
    const arr = hot[kind as keyof typeof hot] ?? warm[kind as keyof typeof warm];
    if (arr) arr.sort((a, b) => a.name.localeCompare(b.name));
  }

  const index: MemoryIndex = {
    version: 1,
    updatedAt: new Date().toISOString(),
    hot: hot as Record<ProjectMemoryKind, MemoryIndexEntry[]>,
    warm: warm as Record<ProjectMemoryKind, MemoryIndexEntry[]>
  };

  const fd = openSync(indexPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o644);
  try {
    writeFileSync(fd, JSON.stringify(index, null, 2), 'utf8');
  } finally {
    closeSync(fd);
  }
}

export function readExistingIndex(indexPath: string): MemoryIndex | null {
  if (!existsSync(indexPath)) return null;
  try {
    const raw = readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as MemoryIndex;
    if (parsed.version === 1) return parsed;
    return null;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

// Decide whether readMemoryIndex should rebuild the on-disk index.json.
// The rule is: rebuild iff index.json is missing OR any memory.md has an
// mtime strictly greater than index.json's mtime. Any statSync failure
// falls back to "rebuild" — a safe default that matches the prior
// always-rebuild behaviour and avoids serving a stale index from a
// partially-corrupt dir.
function shouldRegenerateIndex(indexPath: string, memoryFiles: string[]): boolean {
  let indexMtimeMs = 0;
  try {
    indexMtimeMs = statSync(indexPath).mtimeMs;
  } catch {
    return true; // no index → must regenerate
  }
  for (const memoryPath of memoryFiles) {
    try {
      const memoryMtimeMs = statSync(memoryPath).mtimeMs;
      if (memoryMtimeMs > indexMtimeMs) return true;
    } catch {
      return true; // unreadable file → safe default is regenerate
    }
  }
  return false;
}

export function readMemoryIndex(projectRoot: string): MemoryIndex | null {
  const normalizedRoot = normalizeRoot(projectRoot);
  const memoryDir = assertSafeProjectMemoryDir(normalizedRoot);
  const indexPath = join(memoryDir, 'index.json');

  // Read-side bootstrap: if the memory dir is missing entirely, build it and
  // return whatever index is on disk (likely null on a fresh project). We
  // deliberately do NOT pre-write an empty index here: the mtime-based
  // regeneration guard below is the sole authority on whether index.json
  // gets materialised, and pre-writing an empty index would race the guard
  // (giving it a current-time mtime that defeats "memory older than index"
  // detection on the first read).
  if (!existsSync(memoryDir)) {
    ensureMemoryBootstrap(normalizedRoot);
    return readExistingIndex(indexPath);
  }

  const files = listMarkdownFiles(memoryDir);
  if (files.length > 0 && shouldRegenerateIndex(indexPath, files)) {
    try {
      generateMemoryIndexFile(normalizedRoot, memoryDir, indexPath);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // fall through to read existing
    }
  }

  return readExistingIndex(indexPath);
}