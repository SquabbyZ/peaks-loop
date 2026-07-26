// ---------------------------------------------------------------------------
// Shared type definitions for the project-memory-service split.
//
// This module is the single home of every public type / interface that the
// parsers/, store/, and index/ submodules exchange. Each submodule imports
// from here, and the top-level `index.ts` re-exports them for back-compat
// with downstream callers (CLI commands, audit writers, presence service).
// ---------------------------------------------------------------------------

export type ProjectMemoryKind = 'project' | 'rule' | 'decision' | 'reference' | 'feedback' | 'convention' | 'module' | 'lesson';

export type ExtractedProjectMemory = {
  title: string;
  kind: ProjectMemoryKind;
  body: string;
  sourceArtifact: string;
};

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