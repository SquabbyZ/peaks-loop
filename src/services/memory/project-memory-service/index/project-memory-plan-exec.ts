// ---------------------------------------------------------------------------
// Project-memory create-plan / execute / summarize orchestrators.
//
// Split out of `./kind-dispatch.ts` by the `b1-filesplit-campaign` (wave 3,
// leaf `b1w3-c-memory`): the four `peaks memory extract` / `backup` entry
// points and their two projectors. `./kind-dispatch.ts` re-exports them so
// the `index.ts` barrel and `memory-path-missing-vs-escape.test.ts` keep
// resolving them from `./index/kind-dispatch.js` unchanged. The session-dir
// extractor (`extractSessionMemories`) stays in `kind-dispatch.ts`.
// ---------------------------------------------------------------------------

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import {
  isInsidePath,
  resolveInputPath,
  stablePath,
  stableRealPath
} from '../../../../shared/path-utils.js';
import type {
  BackupPlanOptions,
  ExtractedProjectMemory,
  ExtractPlanOptions,
  MemoryBlockDrop,
  ProjectMemoryBackupPlan,
  ProjectMemoryBackupResult,
  ProjectMemoryBackupSummary,
  ProjectMemoryExtractPlan,
  ProjectMemoryExtractResult,
  ProjectMemoryExtractSummary
} from '../types.js';
import { renderMemoryFile, slugify } from '../parsers/frontmatter.js';
import {
  extractStableProjectMemoriesWithDiagnostics,
  summarizeBackupResult,
  summarizeExtractResult
} from '../parsers/markdown-pure.js';
import {
  assertInsideProject,
  assertSafeProjectMemoryDir,
  normalizeRoot,
  realPathOrThrow
} from '../store/paths.js';
import { assertSafeMemoryFileContent, writeNewFile } from '../store/atomic-write.js';
import { generateMemoryIndexFile, readStoredMemoryNames } from './ranking.js';
import { listMarkdownFiles } from './search.js';

export function createProjectMemoryExtractPlan(
  options: ExtractPlanOptions
): ProjectMemoryExtractPlan {
  const projectRoot = normalizeRoot(options.projectRoot);
  const primaryMemoryDir = assertSafeProjectMemoryDir(projectRoot);
  const extractedMemories: ExtractedProjectMemory[] = [];
  const droppedBlocks: MemoryBlockDrop[] = [];
  for (const artifactPath of options.artifactPaths) {
    const safeArtifactPath = assertInsideProject(artifactPath, projectRoot);
    const relativeArtifactPath = relative(projectRoot, safeArtifactPath).replaceAll('\\', '/');
    const extracted = extractStableProjectMemoriesWithDiagnostics(
      readFileSync(safeArtifactPath, 'utf8'),
      relativeArtifactPath
    );
    // Push order + the sort below are the pre-existing ordering contract:
    // artifacts in argument order, memories sorted by slug.
    extractedMemories.push(...extracted.memories);
    droppedBlocks.push(...extracted.dropped);
  }
  extractedMemories.sort((left, right) => slugify(left.title).localeCompare(slugify(right.title)));

  const slugCounts = new Map<string, number>();
  for (const memory of extractedMemories) {
    const slug = slugify(memory.title);
    slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1);
  }
  const duplicateTitles = [...slugCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([slug]) => slug);
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
    plannedWrites,
    droppedBlocks
  };
}

export function executeProjectMemoryExtract(
  options: ExtractPlanOptions
): ProjectMemoryExtractResult {
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
        throw new Error(
          'Project memory write target must stay inside the project memory directory'
        );
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
  const backupMemoryDir = join(
    artifactWorkspacePath,
    '.peaks',
    'memory-backups',
    'project-memory-primary'
  );
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
      const sourcePath = realPathOrThrow(
        copy.sourcePath,
        'Project memory source must stay inside the project memory directory',
        'Project memory source does not exist'
      );
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

export function summarizeProjectMemoryExtractResult(
  result: ProjectMemoryExtractResult
): ProjectMemoryExtractSummary {
  return summarizeExtractResult(result);
}

export function summarizeProjectMemoryBackupResult(
  result: ProjectMemoryBackupResult
): ProjectMemoryBackupSummary {
  return summarizeBackupResult(result);
}
