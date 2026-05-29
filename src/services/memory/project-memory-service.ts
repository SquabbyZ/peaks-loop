import { closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isInsidePath, isWindowsAbsolutePath, normalizePath, resolveInputPath, stablePath, stableRealPath } from '../../shared/path-utils.js';
import { containsSensitiveConfigValue, isSensitiveConfigPath } from '../config/config-service.js';

export type ProjectMemoryKind = 'project' | 'rule' | 'decision' | 'reference' | 'feedback' | 'convention' | 'module';

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

const START_MARKER = '<!-- peaks-memory:start -->';
const END_MARKER = '<!-- peaks-memory:end -->';
const VALID_MEMORY_KINDS = new Set<ProjectMemoryKind>(['project', 'rule', 'decision', 'reference', 'feedback', 'convention', 'module']);

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

function listMarkdownFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];

  const files: string[] = [];
  const stack: string[] = [dirPath];

  while (stack.length > 0) {
    const currentDir = stack.pop() as string;
    for (const entry of readdirSync(currentDir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(entryPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

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
    for (const write of plan.plannedWrites) {
      const targetPath = resolveInputPath(write.filePath);
      const stableTargetPath = stablePath(targetPath);
      if (!isInsidePath(stableTargetPath, stableRealPath(safeMemoryDir))) {
        throw new Error('Project memory write target must stay inside the project memory directory');
      }
      writeNewFile(targetPath, write.content);
      writtenFiles.push(targetPath);
    }
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
    module: []
  };
}

export function readProjectMemories(projectRoot: string): ProjectMemoryReadResult {
  const normalizedRoot = normalizeRoot(projectRoot);
  const memoryDir = assertSafeProjectMemoryDir(normalizedRoot);

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
