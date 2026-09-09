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
  MemoryKindTier,
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

// Canonical kind vocabulary + hot/warm tier map (slice E)
export {
  HOT_MEMORY_KINDS,
  MEMORY_KIND_TIER,
  PROJECT_MEMORY_KINDS,
  WARM_MEMORY_KINDS
} from './types.js';

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
  parseMemoryFrontmatter,
  parseStoredMemoryFile,
  renderMemoryFile,
  resolveMemoryKind,
  resolveMemoryName,
  slugify
} from './parsers/frontmatter.js';

export type {
  MemoryKindResolution,
  MemoryKindSource,
  MemoryNameResolution,
  MemoryNameSource,
  ParsedMemoryFrontmatter
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
  buildMemoryIndex,
  generateMemoryIndexFile,
  readExistingIndex,
  readMemoryFileMtime,
  readMemoryIndex,
  readStoredMemoryNames
} from './index/ranking.js';

// Full index rebuild + drift report (`peaks memory reindex`)
export {
  executeMemoryReindex,
  renderMemoryMarkdown,
  KIND_ORDER,
  MEMORY_MD_BANNER,
  MEMORY_MD_FILENAME
} from './index/reindex.js';

export type {
  MemoryReindexOptions,
  MemoryReindexReport,
  ReindexNameConflict,
  ReindexOrphanEntry,
  ReindexUnclassified
} from './index/reindex.js';

export {
  createProjectMemoryBackupPlan,
  createProjectMemoryExtractPlan,
  executeProjectMemoryBackup,
  executeProjectMemoryExtract,
  extractSessionMemories,
  summarizeProjectMemoryBackupResult,
  summarizeProjectMemoryExtractResult
} from './index/kind-dispatch.js';