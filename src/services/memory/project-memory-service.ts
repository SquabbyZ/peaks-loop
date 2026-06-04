import { closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, basename, isAbsolute, join, relative, resolve } from 'node:path';
import { isInsidePath, isWindowsAbsolutePath, normalizePath, resolveInputPath, stablePath, stableRealPath } from '../../shared/path-utils.js';
import { containsSensitiveConfigValue, isSensitiveConfigPath } from '../config/config-service.js';

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
// New types for hot/warm分层 index
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

// Hot kinds: full body kept in index for always-available context
const HOT_KINDS = new Set<ProjectMemoryKind>(['feedback', 'decision', 'rule', 'convention', 'module', 'lesson']);

type ExtractPlanOptions = {
  projectRoot: string;
  artifactPaths: string[];
  apply?: boolean;
};

type BackupPlanOptions = {
  projectRoot: string;
  artifactWorkspacePath: string;
  apply?: boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers (kept from original, sorted by dependency order)
// ---------------------------------------------------------------------------

const START_MARKER = '<!-- peaks-memory:start -->';
const END_MARKER = '<!-- peaks-memory:end -->';
const VALID_MEMORY_KINDS = new Set<ProjectMemoryKind>(['project', 'rule', 'decision', 'reference', 'feedback', 'convention', 'module', 'lesson']);

// Length bounds for index entry descriptions. The numbers were chosen when
// summarizeMemoryBody was first introduced; locking them in as named
// constants is a doc-as-code move so the truncation rule is no longer
// "magic". Bump MAX_DESCRIPTION_LENGTH deliberately if downstream UIs grow.
const MIN_BODY_SENTENCE_LENGTH = 20;   // skip fragments shorter than this when picking a leading sentence
const MAX_DESCRIPTION_LENGTH = 120;    // hard cap on description length in the memory index entry
const ELLIPSIS_RESERVE = 3;             // length of the trailing "..." when truncating with an ellipsis

function normalizeRoot(path: string): string {
  return resolveInputPath(path);
}

function normalizeRealRoot(path: string): string {
  return stableRealPath(path);
}

function realPathOrThrow(path: string, errorMessage: string): string {
  if (!existsSync(path)) {
    throw new Error(errorMessage);
  }
  const stats = lstatSync(path);
  if (stats.isSymbolicLink()) {
    throw new Error(errorMessage);
  }
  return realpathSync(path);
}

function resolveProjectPath(path: string, projectRoot: string): string {
  if (isWindowsAbsolutePath(path)) return normalizePath(path);
  if (isAbsolute(path)) return resolve(path);
  const resolvedPath = join(projectRoot, path);
  return isWindowsAbsolutePath(projectRoot) ? normalizePath(resolvedPath) : resolve(resolvedPath);
}

function assertInsideProject(path: string, projectRoot: string): string {
  const resolvedRoot = normalizeRoot(projectRoot);
  const resolvedPath = resolveProjectPath(path, resolvedRoot);
  const realProjectRoot = realPathOrThrow(resolvedRoot, 'Project root is not accessible');
  const realArtifactPath = realPathOrThrow(resolvedPath, 'Artifact path must stay inside the project root');
  if (!isInsidePath(realArtifactPath, realProjectRoot)) {
    throw new Error('Artifact path must stay inside the project root');
  }
  return resolvedPath;
}

function assertSafeProjectMemoryDir(projectRoot: string): string {
  const resolvedRoot = normalizeRoot(projectRoot);
  const realRoot = normalizeRealRoot(projectRoot);
  const peaksDir = join(resolvedRoot, '.peaks');
  if (existsSync(peaksDir) && lstatSync(peaksDir).isSymbolicLink()) {
    throw new Error('Project memory directory must stay inside the project root');
  }

  const memoryDir = join(peaksDir, 'memory');
  if (existsSync(memoryDir)) {
    if (lstatSync(memoryDir).isSymbolicLink()) {
      throw new Error('Project memory directory must stay inside the project root');
    }
    const realMemoryDir = realpathSync(memoryDir);
    if (!isInsidePath(realMemoryDir, realRoot)) {
      throw new Error('Project memory directory must stay inside the project root');
    }
    return memoryDir;
  }

  return memoryDir;
}

function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'project-memory';
}

function parseBlock(block: string, sourceArtifact: string): ExtractedProjectMemory | null {
  const normalizedBlock = block.replace(/\r\n/g, '\n');
  const separatorIndex = normalizedBlock.indexOf('\n---\n');
  if (separatorIndex < 0) return null;

  const header = normalizedBlock.slice(0, separatorIndex).trim();
  const body = normalizedBlock.slice(separatorIndex + '\n---\n'.length).trim();
  const fields = new Map<string, string>();

  for (const line of header.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    const normalizedKey = key?.trim();
    const value = valueParts.join(':').trim();
    if (normalizedKey && value) {
      fields.set(normalizedKey, value);
    }
  }

  const title = fields.get('title')?.trim();
  const kind = fields.get('kind')?.trim() as ProjectMemoryKind | undefined;
  if (!title || !kind || !VALID_MEMORY_KINDS.has(kind) || body.length === 0) return null;

  return { title, kind, body, sourceArtifact };
}

function hasSensitiveMemoryContent(content: string): boolean {
  return /(?:api[_-]?key|token|secret|password|credential|bearer)\s*[:=]/i.test(content)
    || /\bauthorization\s*:\s*bearer\s+\S+/i.test(content)
    || /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i.test(content)
    || /\bsk-[A-Za-z0-9_-]{6,}\b/.test(content)
    || /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/.test(content)
    || /\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(content)
    || /\bglpat-[A-Za-z0-9_-]{20,}\b/.test(content)
    || /\bAKIA[0-9A-Z]{16}\b/.test(content)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content)
    || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(content);
}

function assertSafeMemory(memory: ExtractedProjectMemory): void {
  const content = `${memory.title}\n${memory.kind}\n${memory.body}`;
  const metadata = { title: memory.title, kind: memory.kind, body: memory.body };
  if (containsSensitiveConfigValue(metadata) || hasSensitiveMemoryContent(content)) {
    throw new Error('Refusing to store sensitive memory content');
  }
  if (isSensitiveConfigPath(memory.title)) {
    throw new Error('Refusing to store sensitive memory content');
  }
}

function assertSafeMemoryFileContent(content: string): void {
  if (hasSensitiveMemoryContent(content)) {
    throw new Error('Refusing to back up sensitive memory content');
  }
}

function writeNewFile(path: string, content: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeFileSync(fd, content, 'utf8');
  } finally {
    closeSync(fd);
  }
}

function renderMemoryFile(memory: ExtractedProjectMemory): string {
  const name = slugify(memory.title);
  return [
    '---',
    `name: ${name}`,
    `description: ${memory.title}`,
    'metadata:',
    `  type: ${memory.kind}`,
    `  sourceArtifact: ${memory.sourceArtifact}`,
    '---',
    '',
    memory.body,
    ''
  ].join('\n');
}

function parseStoredMemoryFile(content: string, filePath: string): StoredProjectMemory | null {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return null;
  const endIndex = normalized.indexOf('\n---\n', 4);
  if (endIndex < 0) return null;

  const frontmatter = normalized.slice(4, endIndex);
  const body = normalized.slice(endIndex + '\n---\n'.length).trim();

  let name: string | undefined;
  let description: string | undefined;
  let kind: string | undefined;
  let sourceArtifact: string | undefined;

  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('name:')) name = line.slice('name:'.length).trim();
    else if (line.startsWith('description:')) description = line.slice('description:'.length).trim();
    else if (line.startsWith('type:')) kind = line.slice('type:'.length).trim();
    else if (line.startsWith('sourceArtifact:')) sourceArtifact = line.slice('sourceArtifact:'.length).trim();
  }

  if (!name || !kind || !VALID_MEMORY_KINDS.has(kind as ProjectMemoryKind) || body.length === 0) return null;

  return {
    name,
    title: description ?? name,
    kind: kind as ProjectMemoryKind,
    sourceArtifact: sourceArtifact && sourceArtifact !== 'undefined' ? sourceArtifact : null,
    body,
    filePath
  };
}

function listMarkdownFiles(dirPath: string, options: { maxDepth?: number; skipDotfiles?: boolean } = {}): string[] {
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

// ---------------------------------------------------------------------------
// Description summarization (deterministic, no LLM call)
// ---------------------------------------------------------------------------

function summarizeMemoryBody(body: string): string {
  const cleaned = body
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\n+/g, ' ')
    .trim();

  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(
    (s) => s.length > MIN_BODY_SENTENCE_LENGTH && !/^\[.+\]$/.test(s)
  );
  if (sentences.length === 0) {
    return cleaned.slice(0, MAX_DESCRIPTION_LENGTH) || 'Project memory';
  }

  const first = sentences[0]!;
  if (first.length <= MAX_DESCRIPTION_LENGTH) {
    return first;
  }
  return first.slice(0, MAX_DESCRIPTION_LENGTH - ELLIPSIS_RESERVE) + '...';
}

// ---------------------------------------------------------------------------
// Session memory extraction (new extract path)
// ---------------------------------------------------------------------------

function assertSafeSessionDir(projectRoot: string, sessionId: string): string {
  const normalizedRoot = normalizeRoot(projectRoot);
  const realRoot = normalizeRealRoot(projectRoot);
  const sessionDir = join(normalizedRoot, '.peaks', sessionId);
  if (!existsSync(sessionDir)) {
    // Distinguish "not found" (caller will treat as no-op) from "escapes project
    // root" (caller must surface a hard error). We probe by checking whether the
    // joined path, after realpath, would still be inside the project root.
    if (isAbsolute(join(normalizedRoot, '.peaks', sessionId))) {
      const realJoined = safeRealpath(join(normalizedRoot, '.peaks', sessionId));
      if (realJoined && !isInsidePath(realJoined, realRoot)) {
        throw new Error('Session directory must stay inside the project root');
      }
    }
    throw new Error('SESSION_DIR_NOT_FOUND');
  }
  const stats = lstatSync(sessionDir);
  if (stats.isSymbolicLink()) {
    throw new Error('Session directory must stay inside the project root');
  }
  const realSessionDir = realpathSync(sessionDir);
  if (!isInsidePath(realSessionDir, realRoot)) {
    throw new Error('Session directory must stay inside the project root');
  }
  return sessionDir;
}

function safeRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function readMemoryFileMtime(filePath: string): string {
  try {
    return statSync(filePath).mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function readStoredMemoryNames(memoryDir: string): Set<string> {
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
    } catch {
      // ignore unreadable files
    }
  }
  return names;
}

function generateMemoryIndexFile(projectRoot: string, memoryDir: string, indexPath: string): void {
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

function readExistingIndex(indexPath: string): MemoryIndex | null {
  if (!existsSync(indexPath)) return null;
  try {
    const raw = readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw) as MemoryIndex;
    if (parsed.version === 1) return parsed;
    return null;
  } catch {
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
    } catch {
      // fall through to read existing
    }
  }

  return readExistingIndex(indexPath);
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

  const allExtracted: ExtractedProjectMemory[] = [];
  for (const filePath of scannedFiles) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const relativePath = relative(projectRoot, filePath).replaceAll('\\', '/');
      const extracted = extractStableProjectMemories(content, relativePath);
      allExtracted.push(...extracted);
    } catch {
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

// ---------------------------------------------------------------------------
// Old extract path (kept for core-artifact-commands.ts)
// ---------------------------------------------------------------------------

export function extractStableProjectMemories(content: string, sourceArtifact: string): ExtractedProjectMemory[] {
  const memories: ExtractedProjectMemory[] = [];
  let searchStart = 0;

  while (searchStart < content.length) {
    const start = content.indexOf(START_MARKER, searchStart);
    if (start < 0) break;
    const bodyStart = start + START_MARKER.length;
    const end = content.indexOf(END_MARKER, bodyStart);
    if (end < 0) break;

    const memory = parseBlock(content.slice(bodyStart, end).trim(), sourceArtifact);
    if (memory) {
      assertSafeMemory(memory);
      memories.push(memory);
    }
    searchStart = end + END_MARKER.length;
  }

  return memories.sort((left, right) => slugify(left.title).localeCompare(slugify(right.title)));
}

function summarizeExtractResult(result: ProjectMemoryExtractResult): ProjectMemoryExtractSummary {
  return {
    apply: result.apply,
    projectRoot: result.projectRoot,
    primaryMemoryDir: result.primaryMemoryDir,
    backupPolicy: result.backupPolicy,
    extractedCount: result.extractedMemories.length,
    plannedWrites: result.plannedWrites.map((write) => ({
      filePath: write.filePath,
      title: write.memory.title,
      kind: write.memory.kind,
      sourceArtifact: write.memory.sourceArtifact
    })),
    writtenFiles: result.writtenFiles
  };
}

function summarizeBackupResult(result: ProjectMemoryBackupResult): ProjectMemoryBackupSummary {
  return {
    apply: result.apply,
    projectRoot: result.projectRoot,
    artifactWorkspacePath: result.artifactWorkspacePath,
    primaryMemoryDir: result.primaryMemoryDir,
    backupMemoryDir: result.backupMemoryDir,
    plannedCopies: result.plannedCopies,
    copiedFiles: result.copiedFiles
  };
}

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
    // same handoff is a normal peaks-solo / peaks-txt retry pattern (the
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

function emptyByKind(): Record<ProjectMemoryKind, StoredProjectMemory[]> {
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

function emptyIndex(): MemoryIndex {
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

function renderEmptyIndex(): string {
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
