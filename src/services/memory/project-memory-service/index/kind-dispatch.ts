// ---------------------------------------------------------------------------
// Top-level write / dispatch surface for project memory.
//
// This module is the orchestrator. It composes the parsers + store +
// ranking helpers into the four entry points the CLI calls into:
//
//   - `createProjectMemoryExtractPlan` / `executeProjectMemoryExtract` —
//     `peaks memory extract` (artifact → .peaks/memory/<slug>.md).
//   - `createProjectMemoryBackupPlan` / `executeProjectMemoryBackup` —
//     `peaks memory backup` (.peaks/memory/ → backup workspace).
//   - `extractSessionMemories` — session-dir → .peaks/memory/. Used by
//     `peaks-txt` after a session ends.
//   - `summarizeProjectMemoryExtractResult` /
//     `summarizeProjectMemoryBackupResult` — projector to the small
//     JSON-friendly shape the CLI serializes.
//
// Idempotency notes:
//   - Both extract paths skip writes for slugs that already exist in
//     `.peaks/memory/`. The original `peaks memory extract --apply` ran
//     more than once during peaks-code / peaks-txt retries; without this
//     skip the O_EXCL write throws EEXIST and aborts the whole batch.
//   - On `--apply`, the index is regenerated whenever the write phase
//     runs (even if every write was skipped) so the index is always
//     rebuilt against the current directory.
// ---------------------------------------------------------------------------

import { mkdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  isInsidePath,
  resolveInputPath,
  stablePath,
  stableRealPath
} from '../../../../shared/path-utils.js';
import type {
  ExtractSessionMemoriesOptions,
  ExtractSessionMemoriesResult,
  MemoryBlockDrop,
  SessionScanFailure
} from '../types.js';
import { renderMemoryFile, slugify } from '../parsers/frontmatter.js';
import { extractStableProjectMemoriesWithDiagnostics } from '../parsers/markdown-pure.js';
import { assertSafeProjectMemoryDir, assertSafeSessionDir, normalizeRoot } from '../store/paths.js';
import { writeNewFile } from '../store/atomic-write.js';
import { generateMemoryIndexFile, readStoredMemoryNames } from './ranking.js';
import { listMarkdownFiles } from './search.js';

// The `peaks memory extract` / `backup` plan-execute-summarize surface now
// lives in `./project-memory-plan-exec.ts`. Re-exported here so the `index.ts`
// barrel and `memory-path-missing-vs-escape.test.ts` keep resolving it from
// `./index/kind-dispatch.js` unchanged.
export {
  createProjectMemoryBackupPlan,
  createProjectMemoryExtractPlan,
  executeProjectMemoryBackup,
  executeProjectMemoryExtract,
  summarizeProjectMemoryBackupResult,
  summarizeProjectMemoryExtractResult
} from './project-memory-plan-exec.js';

export function extractSessionMemories(
  options: ExtractSessionMemoriesOptions
): ExtractSessionMemoriesResult {
  const projectRoot = normalizeRoot(options.projectRoot);
  const apply = options.apply ?? false;
  const primaryMemoryDir = assertSafeProjectMemoryDir(projectRoot);
  const memoryIndexPath = join(primaryMemoryDir, 'index.json');

  // Resolve sessionDir through realpath + inside-project guard so a hostile
  // sessionId (`..`, abs path, symlink chain) cannot walk the scanner outside
  // the project root. A sentinel "SESSION_DIR_NOT_FOUND" distinguishes a
  // benign miss from an escape attempt.
  let sessionDir: string;
  try {
    sessionDir = assertSafeSessionDir(projectRoot, options.sessionId);
  } catch (error) {
    if (error instanceof Error && error.message === 'SESSION_DIR_NOT_FOUND') {
      return {
        apply,
        projectRoot,
        sessionId: options.sessionId,
        primaryMemoryDir,
        memoryIndexPath,
        scannedFiles: 0,
        extractedCount: 0,
        writtenFiles: [],
        updatedIndex: false,
        droppedBlocks: [],
        scanFailures: []
      };
    }
    throw error;
  }
  const scannedFiles = listMarkdownFiles(sessionDir, { maxDepth: 6, skipDotfiles: true });

  const allExtracted: import('../types.js').ExtractedProjectMemory[] = [];
  // Symmetric with `createProjectMemoryExtractPlan`, which has reported the
  // rejected blocks since M2. This path used to call the diagnostic-free
  // projection, so a session handoff whose blocks were all malformed returned
  // `extractedCount: 0` with nothing anywhere saying a block had been found.
  const droppedBlocks: MemoryBlockDrop[] = [];
  const scanFailures: SessionScanFailure[] = [];
  for (const filePath of scannedFiles) {
    const relativePath = relative(projectRoot, filePath).replaceAll('\\', '/');
    try {
      const content = readFileSync(filePath, 'utf8');
      const extracted = extractStableProjectMemoriesWithDiagnostics(content, relativePath);
      allExtracted.push(...extracted.memories);
      droppedBlocks.push(...extracted.dropped);
    } catch (error) {
      // G2 resolution for this site: this was a bare `catch {}` carrying the
      // repo-wide G2 grace marker that `scripts/lint/silent-warning-detector.mjs`
      // reads (anti-pattern #1, `empty-catch`). The throw is no longer
      // swallowed — the file is named in the same `warnings` channel as the
      // block drops, which is what the grace period was deferring, so the
      // marker is gone from this line. Still non-fatal: one unreadable artifact
      // must not abort the scan of the rest, so the catch keeps its control
      // flow and only gains a channel.
      //
      // `relativePath` is computed above the `try` so the catch can name the
      // file. That is safe rather than convenient: `path.relative` is pure
      // string arithmetic on two already-validated absolute path strings and
      // does not throw for them, so hoisting it cannot turn a path-join problem
      // into a fatal error that the old swallow would have absorbed.
      scanFailures.push({
        file: relativePath,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (allExtracted.length === 0) {
    return {
      apply,
      projectRoot,
      sessionId: options.sessionId,
      primaryMemoryDir,
      memoryIndexPath,
      scannedFiles: scannedFiles.length,
      extractedCount: 0,
      writtenFiles: [],
      updatedIndex: false,
      droppedBlocks,
      scanFailures
    };
  }

  const slugCounts = new Map<string, number>();
  for (const memory of allExtracted) {
    const slug = slugify(memory.title);
    slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
  }
  const duplicateTitles = [...slugCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([slug]) => slug);
  if (duplicateTitles.length > 0) {
    throw new Error(`Duplicate memory titles are not allowed: ${duplicateTitles.join(', ')}`);
  }

  // Idempotency: pre-read existing memory names so a re-run of the same
  // session does not throw EEXIST. `writtenFiles` reports only the new
  // writes so callers can still tell what the run actually produced.
  const existingNames = apply ? readStoredMemoryNames(primaryMemoryDir) : new Set<string>();
  const writtenFiles: string[] = [];
  if (apply) {
    mkdirSync(primaryMemoryDir, { recursive: true });

    for (const memory of allExtracted) {
      const slug = slugify(memory.title);
      if (existingNames.has(slug)) continue;

      const targetPath = join(primaryMemoryDir, `${slug}.md`);
      const safePath = resolveInputPath(targetPath);
      const stableSafePath = stablePath(safePath);
      if (!isInsidePath(stableSafePath, stableRealPath(primaryMemoryDir))) {
        throw new Error(
          'Project memory write target must stay inside the project memory directory'
        );
      }
      writeNewFile(safePath, renderMemoryFile(memory));
      writtenFiles.push(safePath);
    }

    generateMemoryIndexFile(projectRoot, primaryMemoryDir, memoryIndexPath);
  }

  return {
    apply,
    projectRoot,
    sessionId: options.sessionId,
    primaryMemoryDir,
    memoryIndexPath,
    scannedFiles: scannedFiles.length,
    extractedCount: allExtracted.length,
    writtenFiles,
    updatedIndex: apply && writtenFiles.length > 0,
    droppedBlocks,
    scanFailures
  };
}
