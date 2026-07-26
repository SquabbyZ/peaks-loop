// ---------------------------------------------------------------------------
// Public facade for the project-memory-service split.
//
// Downstream callers (CLI commands, audit writers, presence service,
// search services) import from `'../memory/project-memory-service.js'`. This
// module re-exports every public function / type / constant from the
// parsers/, store/, and index/ submodules, so the existing import path
// keeps working unchanged.
//
// The 8-kind union, all result / plan types, and the index types live in
// `./types.ts` and are re-exported here.
// ---------------------------------------------------------------------------

export type {
  BackupPlanOptions,
  ExtractedProjectMemory,
  ExtractPlanOptions,
  ExtractSessionMemoriesOptions,
  ExtractSessionMemoriesResult,
  MemoryIndex,
  MemoryIndexEntry,
  ProjectMemoryBackupPlan,
  ProjectMemoryBackupResult,
  ProjectMemoryBackupSummary,
  ProjectMemoryCopy,
  ProjectMemoryExtractPlan,
  ProjectMemoryExtractResult,
  ProjectMemoryExtractSummary,
  ProjectMemoryKind,
  ProjectMemoryReadResult,
  ProjectMemoryShowResult,
  ProjectMemoryWrite,
  StoredProjectMemory
} from './types.js';

export { VALID_PROJECT_MEMORY_KINDS } from './parsers/frontmatter.js';

// Pure markdown helpers
export {
  summarizeBackupResult,
  summarizeExtractResult,
  summarizeMemoryBody,
  extractStableProjectMemories,
  END_MARKER,
  START_MARKER
} from './parsers/markdown-pure.js';

// Frontmatter parser + renderer
export {
  parseBlock,
  parseStoredMemoryFile,
  renderMemoryFile,
  slugify
} from './parsers/frontmatter.js';

// Store: path safety + sensitive content
export {
  assertInsideProject,
  assertSafeProjectMemoryDir,
  assertSafeSessionDir,
  normalizeRealRoot,
  normalizeRoot,
  realPathOrThrow,
  resolveProjectPath,
  safeRealpath
} from './store/paths.js';

export {
  assertSafeMemory,
  assertSafeMemoryFileContent,
  hasSensitiveMemoryContent,
  writeNewFile
} from './store/atomic-write.js';

// Index: search / ranking / dispatch
export {
  ensureMemoryBootstrap,
  emptyByKind,
  emptyIndex,
  listMarkdownFiles,
  readProjectMemories,
  readProjectMemoryBody
} from './index/search.js';

export {
  generateMemoryIndexFile,
  readExistingIndex,
  readMemoryFileMtime,
  readMemoryIndex,
  readStoredMemoryNames
} from './index/ranking.js';

export {
  createProjectMemoryBackupPlan,
  createProjectMemoryExtractPlan,
  executeProjectMemoryBackup,
  executeProjectMemoryExtract,
  extractSessionMemories,
  summarizeProjectMemoryBackupResult,
  summarizeProjectMemoryExtractResult
} from './index/kind-dispatch.js';