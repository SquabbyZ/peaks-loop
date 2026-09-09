// ---------------------------------------------------------------------------
// `peaks memory ingest` — pull memories written by the IDE-side agent into
// the peaks-owned store.
//
// Slice 2026-09-09-memory-system-overhaul (A). Before this, "沉淀记忆" in a
// peaks-code workflow landed in Claude Code's own per-project memory dir
// (`~/.claude/projects/<hash>/memory/`) and never reached `.peaks/memory/`
// — a split-brain write path with no single authority.
//
// Authority contract:
//   - `.peaks/memory/` is the authoritative, peaks-owned store.
//   - `~/.claude/**` is READ-ONLY. This module never writes there (same
//     rule the project already applies to `~/.claude/agents/`). The only
//     write targets are inside the project's `.peaks/memory/`.
//   - The IDE-side memory dir is a session note, not the authority.
//
// Idempotency: identity is the filename stem. Re-running skips destination
// files that are byte-identical; when the destination exists but differs it
// is reported as a conflict and BOTH copies are left untouched (never
// overwrite user content).
//
// Classification: a memory is imported only when its kind resolves through
// the shared `resolveMemoryKind` rule (`metadata.type` → `kind:` → `type:`).
// Files with no resolvable kind are reported as needing classification —
// no type is invented silently.
// ---------------------------------------------------------------------------

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { isInsidePath, resolveInputPath, stablePath, stableRealPath } from '../../shared/path-utils.js';
import type { ProjectMemoryKind } from './project-memory-service/types.js';
import { parseMemoryFrontmatter } from './project-memory-service/parsers/frontmatter.js';
import { summarizeMemoryBody } from './project-memory-service/parsers/markdown-pure.js';
import { assertSafeProjectMemoryDir, normalizeRoot } from './project-memory-service/store/paths.js';
import { assertSafeMemoryFileContent, writeNewFile } from './project-memory-service/store/atomic-write.js';
import { listMarkdownFiles } from './project-memory-service/index/search.js';

/** `MEMORY.md` is the IDE's own generated index, not a memory source. */
const IDE_INDEX_FILENAME = 'MEMORY.md';

const RESERVED_TOP_LEVEL_KEYS = new Set(['name', 'description', 'metadata', 'type', 'kind']);
const RESERVED_METADATA_KEYS = new Set(['type', 'kind', 'description']);

export interface MemoryIngestOptions {
  projectRoot: string;
  /** Override the IDE-side source dir (defaults to `~/.claude/projects/<encoded>/memory`). */
  sourceDir?: string;
  /** Injectable home dir (tests); defaults to `os.homedir()`. */
  homeDir?: string;
  apply?: boolean;
}

export interface MemoryIngestImported {
  name: string;
  kind: ProjectMemoryKind;
  sourcePath: string;
  targetPath: string;
}

export interface MemoryIngestSkipped {
  name: string;
  sourcePath: string;
  targetPath: string;
}

export interface MemoryIngestConflict {
  name: string;
  sourcePath: string;
  targetPath: string;
  reason: string;
}

export interface MemoryIngestNeedsClassification {
  name: string;
  sourcePath: string;
  rawKind: string | null;
  reason: string;
}

export interface MemoryIngestRefused {
  name: string;
  sourcePath: string;
  reason: string;
}

export interface MemoryIngestReport {
  apply: boolean;
  projectRoot: string;
  sourceDir: string;
  sourceExists: boolean;
  memoryDir: string;
  scannedFiles: number;
  imported: MemoryIngestImported[];
  skippedIdentical: MemoryIngestSkipped[];
  conflicts: MemoryIngestConflict[];
  needsClassification: MemoryIngestNeedsClassification[];
  refused: MemoryIngestRefused[];
  writtenFiles: string[];
  warnings: string[];
}

/**
 * Claude Code encodes a project cwd into its `~/.claude/projects/<name>/`
 * directory by replacing every non-alphanumeric character with `-`
 * (`D:\peaks-loop` → `D--peaks-loop`). Separator-agnostic, so the same
 * encoding holds for POSIX paths.
 */
export function encodeIdeProjectDir(projectRoot: string): string {
  return projectRoot.replace(/[^A-Za-z0-9]/g, '-');
}

/** Default IDE-side memory dir for a project: `~/.claude/projects/<encoded>/memory`. */
export function defaultIdeMemoryDir(projectRoot: string, homeDir?: string): string {
  return join(homeDir ?? homedir(), '.claude', 'projects', encodeIdeProjectDir(projectRoot), 'memory');
}

interface FrontmatterDoc {
  top: Array<[string, string]>;
  metadata: Array<[string, string]>;
}

function parseFrontmatterDoc(frontmatter: string): FrontmatterDoc {
  const top: Array<[string, string]> = [];
  const metadata: Array<[string, string]> = [];
  let inMetadata = false;
  for (const rawLine of frontmatter.split('\n')) {
    if (rawLine.trim() === '') continue;
    const indented = /^\s/.test(rawLine);
    const line = rawLine.trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (indented) {
      if (inMetadata) metadata.push([key, value]);
      continue;
    }
    inMetadata = key === 'metadata';
    if (!inMetadata) top.push([key, value]);
  }
  return { top, metadata };
}

/**
 * Rewrite a source file's frontmatter to the peaks contract: `name` pinned to
 * the destination filename stem, and `metadata.type` set to the resolved
 * kind. Non-contract keys (e.g. `originSessionId`, `modified`, `node_type`)
 * are preserved verbatim so provenance survives the import; `type` / `kind`
 * are consumed by the normalization and not duplicated.
 */
export function renderNormalizedMemory(input: {
  stem: string;
  kind: ProjectMemoryKind;
  frontmatter: string;
  body: string;
}): string {
  const doc = parseFrontmatterDoc(input.frontmatter);
  const topMap = new Map(doc.top);
  const metaMap = new Map(doc.metadata);
  const description = topMap.get('description')
    ?? metaMap.get('description')
    ?? summarizeMemoryBody(input.body);

  const lines: string[] = ['---', `name: ${input.stem}`, `description: ${description}`];
  for (const [key, value] of doc.top) {
    if (RESERVED_TOP_LEVEL_KEYS.has(key)) continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push('metadata:');
  lines.push(`  type: ${input.kind}`);
  for (const [key, value] of doc.metadata) {
    if (RESERVED_METADATA_KEYS.has(key)) continue;
    lines.push(`  ${key}: ${value}`);
  }
  lines.push('---', '', input.body, '');
  return lines.join('\n');
}

function emptyReport(overrides: Partial<MemoryIngestReport> & Pick<MemoryIngestReport, 'projectRoot' | 'sourceDir' | 'memoryDir'>): MemoryIngestReport {
  return {
    apply: false,
    sourceExists: false,
    scannedFiles: 0,
    imported: [],
    skippedIdentical: [],
    conflicts: [],
    needsClassification: [],
    refused: [],
    writtenFiles: [],
    warnings: [],
    ...overrides
  };
}

/**
 * Import IDE-side memories into `.peaks/memory/`. Always returns the full
 * envelope; `apply` only controls whether files are actually written.
 */
export function executeMemoryIngest(options: MemoryIngestOptions): MemoryIngestReport {
  const projectRoot = normalizeRoot(options.projectRoot);
  const memoryDir = assertSafeProjectMemoryDir(projectRoot);
  const apply = options.apply ?? false;
  const sourceDir = options.sourceDir !== undefined
    ? resolveInputPath(options.sourceDir)
    : defaultIdeMemoryDir(projectRoot, options.homeDir);

  if (!existsSync(sourceDir)) {
    return emptyReport({
      apply,
      projectRoot,
      sourceDir,
      memoryDir,
      warnings: [`No IDE-side memory directory at ${sourceDir}; nothing to ingest.`]
    });
  }

  const report = emptyReport({ apply, projectRoot, sourceDir, memoryDir, sourceExists: true });

  const sourceFiles = listMarkdownFiles(sourceDir);
  const indexFiles = sourceFiles.filter((filePath) => basename(filePath) === IDE_INDEX_FILENAME);
  if (indexFiles.length > 0) {
    report.warnings.push(`Skipped ${indexFiles.length} IDE-side index file(s) named ${IDE_INDEX_FILENAME} (generated by the IDE, not a memory).`);
  }
  const memoryFiles = sourceFiles.filter((filePath) => basename(filePath) !== IDE_INDEX_FILENAME);
  report.scannedFiles = memoryFiles.length;

  // Only materialise the destination directory once we know there is at
  // least one candidate and we are actually applying.
  if (apply && memoryFiles.length > 0) {
    mkdirSync(memoryDir, { recursive: true });
  }
  const stableMemoryDir = existsSync(memoryDir) ? stableRealPath(memoryDir) : null;

  for (const sourcePath of memoryFiles) {
    const stem = basename(sourcePath, '.md');
    let content: string;
    try {
      content = readFileSync(sourcePath, 'utf8');
    } catch {
      report.refused.push({ name: stem, sourcePath, reason: 'source file could not be read' });
      continue;
    }

    const parsed = parseMemoryFrontmatter(content);
    const kind = parsed.kind.kind;
    if (kind === null) {
      report.needsClassification.push({
        name: parsed.name ?? stem,
        sourcePath,
        rawKind: parsed.kind.rawKind,
        reason: parsed.kind.rawKind === null
          ? 'no metadata.type / kind / type field in frontmatter'
          : `unrecognized kind value: ${parsed.kind.rawKind}`
      });
      continue;
    }

    const normalized = renderNormalizedMemory({ stem, kind, frontmatter: parsed.frontmatter, body: parsed.body });

    // Never import secrets into the peaks store. Fail-soft: report, skip.
    try {
      assertSafeMemoryFileContent(normalized);
    } catch {
      report.refused.push({ name: stem, sourcePath, reason: 'refused: sensitive content pattern' });
      continue;
    }

    const targetPath = join(memoryDir, `${stem}.md`);
    const entry: MemoryIngestImported = { name: stem, kind, sourcePath, targetPath };

    if (existsSync(targetPath)) {
      let existing: string;
      try {
        existing = readFileSync(targetPath, 'utf8');
      } catch {
        report.conflicts.push({ name: stem, sourcePath, targetPath, reason: 'destination exists but could not be read' });
        continue;
      }
      if (existing === normalized) {
        report.skippedIdentical.push({ name: stem, sourcePath, targetPath });
      } else {
        report.conflicts.push({ name: stem, sourcePath, targetPath, reason: 'destination exists with different content; both copies left untouched' });
      }
      continue;
    }

    if (!apply) {
      report.imported.push(entry);
      continue;
    }

    // Defence in depth: the write target must resolve inside the project's
    // `.peaks/memory/`. This is the guard that makes "never write to
    // ~/.claude/**" structural rather than a convention.
    const stableTargetPath = stablePath(resolveInputPath(targetPath));
    if (stableMemoryDir === null || !isInsidePath(stableTargetPath, stableMemoryDir)) {
      report.refused.push({ name: stem, sourcePath, reason: 'refused: target path escapes the project memory directory' });
      continue;
    }
    writeNewFile(targetPath, normalized);
    report.imported.push(entry);
    report.writtenFiles.push(targetPath);
  }

  return report;
}
