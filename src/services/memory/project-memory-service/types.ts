// ---------------------------------------------------------------------------
// Shared type definitions for the project-memory-service split.
//
// This module is the single home of every public type / interface that the
// parsers/, store/, and index/ submodules exchange. Each submodule imports
// from here, and the top-level `index.ts` re-exports them for back-compat
// with downstream callers (CLI commands, audit writers, presence service).
// ---------------------------------------------------------------------------

import type { ProjectMemoryKind } from './memory-kinds.js';

export {
  HOT_MEMORY_KINDS,
  MEMORY_KIND_TIER,
  PROJECT_MEMORY_KINDS,
  WARM_MEMORY_KINDS
} from './memory-kinds.js';
export type { MemoryKindTier, ProjectMemoryKind } from './memory-kinds.js';

export type ExtractedProjectMemory = {
  title: string;
  kind: ProjectMemoryKind;
  body: string;
  sourceArtifact: string;
};

/**
 * Why a `<!-- peaks-memory:start -->` block that was FOUND was not extracted.
 *
 * One value per precondition in `parseBlockResult` (the extract path's block
 * parser), in evaluation order. Before this existed, every one of these
 * conditions collapsed into a bare `null` and the caller reported nothing, so
 * `extractedCount: N` was indistinguishable from "the block was never there".
 * Naming the cause is the whole point: a memory block that disappears must say
 * why it disappeared.
 *
 * Diagnostics only — this type does not change WHICH blocks are accepted.
 */
export type MemoryBlockDropReason =
  | 'missing-separator'
  | 'missing-title'
  | 'missing-kind'
  | 'unknown-kind'
  | 'empty-body'
  /**
   * NOT a `parseBlockResult` precondition — this one comes from the scanner.
   * A marker-shaped comment that is not the exact literal the locator searches
   * for. The block it opens is therefore never found: it is not "rejected",
   * it is invisible. Reporting it is the whole point, because nothing else in
   * the pipeline can see it.
   */
  | 'unrecognized-marker';

/** A found-but-not-extracted memory block, with the precondition that failed. */
export type MemoryBlockDrop = {
  /** Artifact path the block was found in (project-relative when extracted). */
  sourceArtifact: string;
  reason: MemoryBlockDropReason;
  /** Human-readable explanation of the failed precondition. */
  detail: string;
};

/**
 * Result of parsing one memory block, as a discriminated union.
 *
 * `parseBlock` is the `null`-on-failure projection of this; both are produced
 * by the same single implementation so they cannot disagree about which blocks
 * are accepted.
 */
export type MemoryBlockParse =
  | { ok: true; memory: ExtractedProjectMemory }
  | { ok: false; reason: MemoryBlockDropReason; detail: string };

export type ProjectMemoryWrite = {
  memory: ExtractedProjectMemory;
  filePath: string;
  content: string;
};

export type ProjectMemoryExtractPlan = {
  apply: boolean;
  projectRoot: string;
  primaryMemoryDir: string;
  backupPolicy: 'project-memory-primary-artifact-backup';
  extractedMemories: ExtractedProjectMemory[];
  plannedWrites: ProjectMemoryWrite[];
  /**
   * Blocks that were found between the markers but rejected by the parser.
   * Reported to the user through the CLI envelope's `warnings` channel.
   * Purely informational — this array does not influence extraction.
   */
  droppedBlocks: MemoryBlockDrop[];
};

export type ProjectMemoryExtractResult = ProjectMemoryExtractPlan & {
  writtenFiles: string[];
};

export type ProjectMemoryExtractSummary = {
  apply: boolean;
  projectRoot: string;
  primaryMemoryDir: string;
  backupPolicy: 'project-memory-primary-artifact-backup';
  extractedCount: number;
  plannedWrites: Array<{
    filePath: string;
    title: string;
    kind: ProjectMemoryKind;
    sourceArtifact: string;
  }>;
  writtenFiles: string[];
};

export type ProjectMemoryBackupSummary = {
  apply: boolean;
  projectRoot: string;
  artifactWorkspacePath: string;
  primaryMemoryDir: string;
  backupMemoryDir: string;
  plannedCopies: ProjectMemoryCopy[];
  copiedFiles: string[];
};

export type ProjectMemoryCopy = {
  sourcePath: string;
  targetPath: string;
};

export type ProjectMemoryBackupPlan = {
  apply: boolean;
  projectRoot: string;
  artifactWorkspacePath: string;
  primaryMemoryDir: string;
  backupMemoryDir: string;
  plannedCopies: ProjectMemoryCopy[];
};

export type ProjectMemoryBackupResult = ProjectMemoryBackupPlan & {
  copiedFiles: string[];
};

export type StoredProjectMemory = {
  name: string;
  title: string;
  kind: ProjectMemoryKind;
  sourceArtifact: string | null;
  body: string;
  filePath: string;
};

export type ProjectMemoryReadResult = {
  projectRoot: string;
  memoryDir: string;
  total: number;
  byKind: Record<ProjectMemoryKind, StoredProjectMemory[]>;
  memories: StoredProjectMemory[];
};

// ---------------------------------------------------------------------------
// Hot/warm分层 index
// ---------------------------------------------------------------------------

export type MemoryIndexEntry = {
  name: string;
  kind: ProjectMemoryKind;
  description: string;
  sourcePath: string;
  sourceArtifact: string | null;
  updatedAt: string;
};

export type MemoryIndex = {
  version: 1;
  updatedAt: string;
  hot: Record<ProjectMemoryKind, MemoryIndexEntry[]>;
  warm: Record<ProjectMemoryKind, MemoryIndexEntry[]>;
};

export type ExtractSessionMemoriesOptions = {
  projectRoot: string;
  sessionId: string;
  apply?: boolean;
};

/**
 * A session artifact that could not be read at all, so its blocks were never
 * even candidates.
 *
 * Distinct from `MemoryBlockDrop`: that one describes a BLOCK that was found and
 * rejected, and needs the artifact to have been readable in the first place.
 * Folding a whole-file read failure into it would make `sourceArtifact` mean two
 * different things, so this rides its own field and is rendered by its own
 * `describeSessionScanFailures`.
 */
export type SessionScanFailure = {
  /** Project-relative path of the artifact that could not be read. */
  file: string;
  /** The underlying error message. Never invented; taken from the throw. */
  detail: string;
};

export type ExtractSessionMemoriesResult = {
  apply: boolean;
  projectRoot: string;
  sessionId: string;
  primaryMemoryDir: string;
  memoryIndexPath: string;
  scannedFiles: number;
  extractedCount: number;
  writtenFiles: string[];
  updatedIndex: boolean;
  /**
   * Blocks that were FOUND between the markers in this session's artifacts but
   * rejected by the parser. Same diagnostic contract as
   * `ProjectMemoryExtractPlan.droppedBlocks` — the sibling `peaks memory
   * extract` path has carried this since M2, and this one silently dropped
   * them, so `extractedCount: 1` out of three blocks was indistinguishable
   * from "there was one block".
   *
   * Purely informational: this array does not influence which blocks are
   * extracted, and it adds no field to the CLI's `data` payload — the reasons
   * ride the existing envelope `warnings` channel.
   */
  droppedBlocks: MemoryBlockDrop[];
  /**
   * Session artifacts that could not be read, so their blocks were never
   * candidates. Previously swallowed by a bare `catch {}`; reported now through
   * the same CLI `warnings` channel. Diagnostic only — an unreadable artifact
   * is still not an error, and the scan is otherwise unchanged.
   */
  scanFailures: SessionScanFailure[];
};

export type ProjectMemoryShowResult = {
  projectRoot: string;
  memoryDir: string;
  name: string;
  body: string;
  filePath: string;
  updatedAt: string | null;
  kind: ProjectMemoryKind | null;
  title: string;
  /** Whether the on-disk body bytes are returned (true) or a compact form (false). */
  pretty: boolean;
};

// Internal option shapes (not re-exported externally but used by the
// dispatch layer).
export type ExtractPlanOptions = {
  projectRoot: string;
  artifactPaths: string[];
  apply?: boolean;
};

export type BackupPlanOptions = {
  projectRoot: string;
  artifactWorkspacePath: string;
  apply?: boolean;
};
