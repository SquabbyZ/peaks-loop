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

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { isInsidePath, resolveInputPath, stablePath, stableRealPath } from '../../../../shared/path-utils.js';
import type {
  BackupPlanOptions,
  ExtractPlanOptions,
  ExtractSessionMemoriesOptions,
  ExtractSessionMemoriesResult,
  ProjectMemoryBackupPlan,
  ProjectMemoryBackupResult,
  ProjectMemoryBackupSummary,
  ProjectMemoryExtractPlan,
  ProjectMemoryExtractResult,
  ProjectMemoryExtractSummary
} from '../types.js';
import { renderMemoryFile, slugify } from '../parsers/frontmatter.js';
import { extractStableProjectMemories, summarizeBackupResult, summarizeExtractResult } from '../parsers/markdown-pure.js';
import {
  assertInsideProject,
  assertSafeProjectMemoryDir,
  assertSafeSessionDir,
  normalizeRoot,
  realPathOrThrow
} from '../store/paths.js';
import { assertSafeMemoryFileContent, writeNewFile } from '../store/atomic-write.js';
import { generateMemoryIndexFile, readStoredMemoryNames } from './ranking.js';
import { listMarkdownFiles } from './search.js';

export function createProjectMemoryExtractPlan(options: ExtractPlanOptions): ProjectMemoryExtractPlan {
  const projectRoot = normalizeRoot(options.projectRoot);
  const primaryMemoryDir = assertSafeProjectMemoryDir(projectRoot);
  const extractedMemories = options.artifactPaths.flatMap((artifactPath) => {
    const safeArtifactPath = assertInsideProject(artifactPath, projectRoot);
    const relativeArtifactPath = relative(projectRoot, safeArtifactPath).replaceAll('\\', '/');
    return extractStableProjectMemories(readFileSync(safeArtifactPath, 'utf8'), relativeArtifactPath);
  }).sort((left, right) => slugify(left.title).localeCompare(slugify(right.title)));

  const slugCounts = new Map<string, number>();
  for (const memory of extractedMemories) {
    const slug = slugify(memory.title);
    slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
  }
  const duplicateTitles = [...slugCounts.entries()].filter(([, count]) => count > 1).map(([slug]) => slug);
  if (duplicateTitles.length > 0) {
    throw new Error(`Duplicate memory titles are not allowed: ${duplicateTitles.join(', ')}`);
  }

  const plannedWrites = extractedMemories.map((memory) => ({
    memory,
    filePath: join(primaryMemoryDir, `${slugify(memory.title)}.md`),
    content: renderMemoryFile(memory)
  }));

  return {
    apply: options.apply ?? false,
    projectRoot,
    primaryMemoryDir,
    backupPolicy: 'project-memory-primary-artifact-backup',
    extractedMemories,
    plannedWrites
  };
}

export function executeProjectMemoryExtract(options: ExtractPlanOptions): ProjectMemoryExtractResult {
  const plan = createProjectMemoryExtractPlan(options);
  const writtenFiles: string[] = [];

  if (plan.apply) {
    mkdirSync(plan.primaryMemoryDir, { recursive: true });
    const safeMemoryDir = assertSafeProjectMemoryDir(plan.projectRoot);
    // Idempotency: skip writes for memories whose slug already lives in
    // .peaks/memory/. Re-running `peaks memory extract --apply` on the
    // same handoff is a normal peaks-code / peaks-txt retry pattern (the
    // skill prompt may invoke extract more than once when a handoff is
    // edited and re-extracted). Without this, writeNewFile's O_EXCL
    // throws EEXIST and aborts the whole batch. Symmetric with
    // extractSessionMemories (line ~614) which does the same skip.
    const existingNames = readStoredMemoryNames(plan.primaryMemoryDir);
    for (const write of plan.plannedWrites) {
      const slug = slugify(write.memory.title);
      if (existingNames.has(slug)) continue;

      const targetPath = resolveInputPath(write.filePath);
      const stableTargetPath = stablePath(targetPath);
      if (!isInsidePath(stableTargetPath, stableRealPath(safeMemoryDir))) {
        throw new Error('Project memory write target must stay inside the project memory directory');
      }
      writeNewFile(targetPath, write.content);
      writtenFiles.push(targetPath);
    }

    // After writing any markdown, regenerate the index so downstream
    // readers (peaks project memory-index, peaks-txt re-runs, the next
    // session's presence-set bootstrap) see the new memory. Without
    // this, `peaks memory extract --apply` would leave the index stale
    // and `readMemoryIndex` would either return the empty bootstrap or
    // — pre-bootstrap-fix — return null. Symmetric with
    // extractSessionMemories, which already regenerates the index on
    // apply (see line ~626). We regen whenever --apply is set, even
    // if every write was skipped by idempotency, so the index is
    // always rebuilt against the current .peaks/memory/ directory.
    const indexPath = join(plan.primaryMemoryDir, 'index.json');
    generateMemoryIndexFile(plan.projectRoot, plan.primaryMemoryDir, indexPath);
  }

  return { ...plan, writtenFiles };
}

export function createProjectMemoryBackupPlan(options: BackupPlanOptions): ProjectMemoryBackupPlan {
  const projectRoot = normalizeRoot(options.projectRoot);
  const artifactWorkspacePath = normalizeRoot(options.artifactWorkspacePath);
  if (isInsidePath(artifactWorkspacePath, projectRoot)) {
    throw new Error('Artifact workspace must be outside the project root');
  }

  const primaryMemoryDir = assertSafeProjectMemoryDir(projectRoot);
  const backupMemoryDir = join(artifactWorkspacePath, '.peaks', 'memory-backups', 'project-memory-primary');
  const plannedCopies = listMarkdownFiles(primaryMemoryDir).map((sourcePath) => {
    assertSafeMemoryFileContent(readFileSync(sourcePath, 'utf8'));
    const relativeMemoryPath = relative(primaryMemoryDir, sourcePath);
    return {
      sourcePath,
      targetPath: join(backupMemoryDir, relativeMemoryPath)
    };
  });

  return {
    apply: options.apply ?? false,
    projectRoot,
    artifactWorkspacePath,
    primaryMemoryDir,
    backupMemoryDir,
    plannedCopies
  };
}

export function executeProjectMemoryBackup(options: BackupPlanOptions): ProjectMemoryBackupResult {
  const plan = createProjectMemoryBackupPlan(options);
  const copiedFiles: string[] = [];

  if (plan.apply) {
    const safeMemoryDir = assertSafeProjectMemoryDir(plan.projectRoot);
    mkdirSync(plan.backupMemoryDir, { recursive: true });
    for (const copy of plan.plannedCopies) {
      const sourcePath = realPathOrThrow(copy.sourcePath, 'Project memory source must stay inside the project memory directory');
      if (!isInsidePath(sourcePath, stableRealPath(safeMemoryDir))) {
        throw new Error('Project memory source must stay inside the project memory directory');
      }
      mkdirSync(dirname(copy.targetPath), { recursive: true });
      copyFileSync(sourcePath, copy.targetPath);
      copiedFiles.push(copy.targetPath);
    }
  }

  return { ...plan, copiedFiles };
}

export function summarizeProjectMemoryExtractResult(result: ProjectMemoryExtractResult): ProjectMemoryExtractSummary {
  return summarizeExtractResult(result);
}

export function summarizeProjectMemoryBackupResult(result: ProjectMemoryBackupResult): ProjectMemoryBackupSummary {
  return summarizeBackupResult(result);
}

export function extractSessionMemories(options: ExtractSessionMemoriesOptions): ExtractSessionMemoriesResult {
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
        updatedIndex: false
      };
    }
    throw error;
  }
  const scannedFiles = listMarkdownFiles(sessionDir, { maxDepth: 6, skipDotfiles: true });

  const allExtracted: import('../types.js').ExtractedProjectMemory[] = [];
  for (const filePath of scannedFiles) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const relativePath = relative(projectRoot, filePath).replaceAll('\\', '/');
      const extracted = extractStableProjectMemories(content, relativePath);
      allExtracted.push(...extracted);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // skip unreadable files
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
      updatedIndex: false
    };
  }

  const slugCounts = new Map<string, number>();
  for (const memory of allExtracted) {
    const slug = slugify(memory.title);
    slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
  }
  const duplicateTitles = [...slugCounts.entries()].filter(([, count]) => count > 1).map(([slug]) => slug);
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
        throw new Error('Project memory write target must stay inside the project memory directory');
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
    updatedIndex: apply && writtenFiles.length > 0
  };
}