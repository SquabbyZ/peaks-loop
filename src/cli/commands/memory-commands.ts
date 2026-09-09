import { findProjectRoot } from '../../services/config/config-safety.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { loadMemoryIndex, searchMemory, type MemoryIndexEntry, type MemoryIndexSnapshot, type ProjectMemoryKind } from '../../services/memory/memory-search-service.js';
import { executeMemoryReindex, VALID_PROJECT_MEMORY_KINDS, type MemoryReindexReport } from '../../services/memory/project-memory-service.js';
import { boundedNames, fitSummaryToBytes } from '../../services/context/summary-view.js';
import { executeMemoryIngest } from '../../services/memory/memory-ingest-service.js';
import { executeMemoryRotate } from '../../services/memory/memory-rotate-service.js';
import { pickFromList } from '../../services/fuzzy-matching/fzf-pick-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { join } from 'node:path';

const VALID_KINDS: ReadonlyArray<ProjectMemoryKind> = VALID_PROJECT_MEMORY_KINDS;

export interface MemorySearchCommandOptions {
  query: string;
  kind?: string;
  limit?: number;
  project?: string;
  json?: boolean;
}

export interface MemoryListCommandOptions {
  kind?: string;
  pick?: boolean;
  fzfBin?: string;
  project?: string;
  json?: boolean;
  /** Slice B: emit counts + names-of-first-N instead of the full entry array. */
  summary?: boolean;
}

export interface MemoryReindexCommandOptions {
  project?: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
  /** Slice B: emit counts + names-of-first-N instead of the full arrays. */
  summary?: boolean;
}

/**
 * Slice 2026-09-10-context-audit-and-discipline (Slice B): bounded view of
 * `memory reindex`. The full report's arrays stay on disk / in the default
 * envelope; this replaces them with `{count, names}` views (≤ 2 KB).
 */
export function buildMemoryReindexSummary(report: MemoryReindexReport): Record<string, unknown> {
  const view = {
    view: 'summary',
    apply: report.apply,
    projectRoot: report.projectRoot,
    memoryDir: report.memoryDir,
    indexPath: report.indexPath,
    memoryMdPath: report.memoryMdPath,
    scannedFiles: report.scannedFiles,
    indexed: report.indexed,
    indexedByKind: report.indexedByKind,
    unclassified: boundedNames(report.unclassified.map((u) => `${u.name}${u.rawKind === null ? '' : ` (${u.rawKind})`}`)),
    nameConflicts: boundedNames(report.nameConflicts.map((c) => c.name)),
    orphanIndex: boundedNames(report.orphanIndex.map((o) => o.name)),
    orphanDisk: boundedNames(report.orphanDisk.map((p) => p.split(/[\\/]/).pop() ?? p)),
    memoryMd: report.memoryMd,
    writtenFiles: boundedNames(report.writtenFiles.map((p) => p.split(/[\\/]/).pop() ?? p)),
  };
  return fitSummaryToBytes(view);
}

/**
 * Slice B: bounded view of `memory list`. `count` is the true total; `names`
 * carries `name (kind)` labels for the first N entries.
 */
export function buildMemoryListSummary(data: {
  snapshot: MemoryIndexSnapshot;
  entries: readonly MemoryIndexEntry[];
  kindFilter: ProjectMemoryKind | undefined;
  pickedEntries: readonly MemoryIndexEntry[];
  pickedOutputPath: string | null;
  fzfVersion: string | null;
}): Record<string, unknown> {
  const label = (e: MemoryIndexEntry): string => `${e.name} (${e.kind})`;
  const view: Record<string, unknown> = {
    view: 'summary',
    indexPath: data.snapshot.indexPath,
    version: data.snapshot.version,
    updatedAt: data.snapshot.updatedAt,
    total: data.entries.length,
    kindFilter: data.kindFilter ?? null,
    entries: boundedNames(data.entries.map(label)),
  };
  if (data.pickedOutputPath !== null) {
    view.picked = boundedNames(data.pickedEntries.map(label));
    view.pickedOutputPath = data.pickedOutputPath;
    view.fzfVersion = data.fzfVersion;
  }
  return fitSummaryToBytes(view);
}

export interface MemoryIngestCommandOptions {
  project?: string;
  sourceDir?: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
}

export interface MemoryRotateCommandOptions {
  project?: string;
  dryRun?: boolean;
  apply?: boolean;
  json?: boolean;
}

function resolveMemoryProjectRoot(project?: string): string {
  return project !== undefined
    ? resolveCanonicalProjectRoot(project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());
}

export async function runMemoryList(io: ProgramIO, options: MemoryListCommandOptions): Promise<void> {
  const projectRoot = options.project !== undefined
    ? resolveCanonicalProjectRoot(options.project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());

  try {
    const snapshot = loadMemoryIndex(projectRoot);
    const kindFilter = options.kind !== undefined && VALID_KINDS.includes(options.kind as ProjectMemoryKind)
      ? (options.kind as ProjectMemoryKind)
      : undefined;
    const entries = kindFilter === undefined
      ? snapshot.entries
      : snapshot.entries.filter((e) => e.kind === kindFilter);

    const warnings: string[] = [];
    let pickedEntries: MemoryIndexEntry[] = entries;
    let pickedOutputPath: string | null = null;
    let fzfVersion: string | null = null;

    if (options.pick === true) {
      const outputPath = join(projectRoot, '.peaks', 'memory', 'picked.json');
      const byName = new Map(entries.map((e) => [e.name, e] as const));
      const result = await pickFromList<MemoryIndexEntry>({
        items: entries,
        formatLine: (entry) => `${entry.name} | ${entry.kind} | ${entry.description.slice(0, 60)}`,
        parseLine: (line) => {
          const parts = line.split('|').map((p) => p.trim());
          if (parts.length < 1) return null;
          const name = parts[0];
          if (name === undefined || name.length === 0) return null;
          return byName.get(name) ?? null;
        },
        outputPath,
        meta: { kindFilter: kindFilter ?? null, totalCandidates: entries.length },
        ...(options.fzfBin !== undefined ? { fzfBin: options.fzfBin } : {}),
        projectRoot,
        multi: true,
        prompt: 'memory> '
      });
      pickedEntries = [...result.picked];
      pickedOutputPath = result.outputPath;
      fzfVersion = result.fzfVersion;
    }

    const nextActions: string[] = [];
    if (pickedOutputPath !== null) {
      nextActions.push(`Picked ${pickedEntries.length} entr(ies); written to ${pickedOutputPath}`);
    }
    if (entries.length === 0) {
      nextActions.push('No entries match; run `peaks memory extract` to build the index from memory/*.md files.');
    }

    // Slice B: `--summary` swaps the full entry array for a bounded
    // `{count, names}` view. The default (no flag) envelope is byte-identical
    // to before — the flag is strictly opt-in.
    const data: Record<string, unknown> = options.summary === true
      ? buildMemoryListSummary({
          snapshot,
          entries,
          kindFilter,
          pickedEntries,
          pickedOutputPath,
          fzfVersion,
        })
      : {
          indexPath: snapshot.indexPath,
          version: snapshot.version,
          updatedAt: snapshot.updatedAt,
          total: entries.length,
          kindFilter: kindFilter ?? null,
          entries,
          ...(options.pick === true ? { picked: pickedEntries, pickedOutputPath, fzfVersion } : {})
        };

    printResult(io, ok('memory.list', data, warnings, nextActions), options.json);
  } catch (error) {
    const message = getErrorMessage(error);
    const code = (error as { code?: string }).code ?? 'MEMORY_LIST_FAILED';
    const suggestions: string[] = [];
    if (code === 'INDEX_MISSING') {
      suggestions.push('Run `peaks memory extract` to build the index from memory/*.md files');
    }
    printResult(
      io,
      fail('memory.list', code, message, { projectRoot }, suggestions),
      options.json
    );
    process.exitCode = 1;
  }
}

/**
 * Run the memory search subcommand. Extracted so unit tests can
 * exercise the full envelope without spawning a subprocess.
 */
export async function runMemorySearch(io: ProgramIO, options: MemorySearchCommandOptions): Promise<void> {
  const projectRoot = options.project !== undefined
    ? resolveCanonicalProjectRoot(options.project)
    : (findProjectRoot(process.cwd()) ?? process.cwd());

  const kindFilter = options.kind !== undefined && VALID_KINDS.includes(options.kind as ProjectMemoryKind)
    ? (options.kind as ProjectMemoryKind)
    : undefined;

  try {
    const matches = searchMemory({
      query: options.query,
      projectRoot,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(kindFilter !== undefined ? { kind: kindFilter } : {}),
    });

    printResult(
      io,
      ok(
        'memory.search',
        {
          query: options.query,
          total: matches.length,
          matches,
          warnings: [],
        },
        []
      ),
      options.json
    );
  } catch (error) {
    const message = getErrorMessage(error);
    const code = (error as { code?: string }).code ?? 'MEMORY_SEARCH_FAILED';
    const suggestions: string[] = [];
    if (code === 'INDEX_MISSING') {
      suggestions.push('Run `peaks memory extract --apply` to build the index from memory/*.md files');
    }
    if (code === 'EMPTY_QUERY') {
      suggestions.push('Use `peaks memory index` to list all entries');
    }
    printResult(
      io,
      fail('memory.search', code, message, { projectRoot, query: options.query }, suggestions),
      options.json
    );
    process.exitCode = 1;
  }
}

/**
 * `peaks memory reindex` — rebuild `.peaks/memory/index.json` from disk and
 * regenerate `MEMORY.md`. Dry-run by default; `--apply` writes.
 */
export async function runMemoryReindex(io: ProgramIO, options: MemoryReindexCommandOptions): Promise<void> {
  const projectRoot = resolveMemoryProjectRoot(options.project);

  if (options.dryRun === true && options.apply === true) {
    printResult(io, fail('memory.reindex', 'INVALID_MEMORY_REINDEX_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview the drift report, or pass --apply to rebuild']), options.json);
    process.exitCode = 1;
    return;
  }

  try {
    const report = executeMemoryReindex({ projectRoot, apply: options.apply === true });
    const nextActions: string[] = [];
    if (options.apply !== true) {
      nextActions.push('Preview only — re-run with --apply to rebuild index.json and regenerate MEMORY.md.');
    }
    if (report.unclassified.length > 0) {
      nextActions.push(`${report.unclassified.length} file(s) have no resolvable kind; add \`metadata.type\` (or \`kind:\`) to index them.`);
    }
    if (report.orphanIndex.length > 0) {
      nextActions.push(`${report.orphanIndex.length} previous index entry(ies) point at missing files; they are dropped from the rebuilt index.`);
    }
    if (report.nameConflicts.length > 0) {
      nextActions.push(`${report.nameConflicts.length} name collision(s) across files; both entries are kept — rename one file to disambiguate.`);
    }
    // Slice B: `--summary` keeps the scalar drift counts + names-of-first-N;
    // the full report (with every unclassified/orphan path) stays available
    // by omitting the flag. Default shape is unchanged.
    const data = options.summary === true
      ? buildMemoryReindexSummary(report)
      : report;
    printResult(io, ok('memory.reindex', data, [], nextActions), options.json);
  } catch (error) {
    const message = getErrorMessage(error);
    const code = (error as { code?: string }).code ?? 'MEMORY_REINDEX_FAILED';
    printResult(
      io,
      fail('memory.reindex', code, message, { projectRoot }, ['Check that the project has a readable .peaks/memory directory']),
      options.json
    );
    process.exitCode = 1;
  }
}

/**
 * `peaks memory rotate` — tier-driven retention for `.peaks/memory/`.
 * Implements the sediment pruning policy (tier 1: archive, never delete).
 * Dry-run by default; `--apply` moves tier-C candidates into `archived/`.
 */
export async function runMemoryRotate(io: ProgramIO, options: MemoryRotateCommandOptions): Promise<void> {
  const projectRoot = resolveMemoryProjectRoot(options.project);

  if (options.dryRun === true && options.apply === true) {
    printResult(io, fail('memory.rotate', 'INVALID_MEMORY_ROTATE_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview the rotation plan, or pass --apply to archive tier-C candidates']), options.json);
    process.exitCode = 1;
    return;
  }

  try {
    const report = executeMemoryRotate({ projectRoot, apply: options.apply === true });
    const nextActions: string[] = [];
    if (report.refused) {
      nextActions.push(`Refused to apply: ${report.refusalReasons.join('; ')}`);
    } else if (options.apply !== true) {
      nextActions.push('Preview only — re-run with --apply to move the tier-C candidates into archived/.');
    }
    if (report.excluded.length > 0) {
      nextActions.push(`${report.excluded.length} candidate(s) excluded by a safety gate (see \`excluded\`).`);
    }
    const deleteCandidates = report.candidates.filter((candidate) => candidate.action === 'delete-candidate');
    if (deleteCandidates.length > 0) {
      nextActions.push(`${deleteCandidates.length} tier-D file(s) are delete-candidates only; peaks never deletes them — remove by hand if you are sure.`);
    }
    printResult(io, ok('memory.rotate', report, report.warnings, nextActions), options.json);
    if (report.refused) process.exitCode = 1;
  } catch (error) {
    const message = getErrorMessage(error);
    const code = (error as { code?: string }).code ?? 'MEMORY_ROTATE_FAILED';
    printResult(
      io,
      fail('memory.rotate', code, message, { projectRoot }, ['Check that the project has a readable .peaks/memory directory']),
      options.json
    );
    process.exitCode = 1;
  }
}

/**
 * `peaks memory ingest` — import memories written by the IDE-side agent into
 * `.peaks/memory/`. The IDE-side source is read-only; dry-run by default.
 */
export async function runMemoryIngest(io: ProgramIO, options: MemoryIngestCommandOptions): Promise<void> {
  const projectRoot = resolveMemoryProjectRoot(options.project);

  if (options.dryRun === true && options.apply === true) {
    printResult(io, fail('memory.ingest', 'INVALID_MEMORY_INGEST_FLAGS', 'Use either --dry-run or --apply, not both', {}, ['Run without --apply to preview imports, or pass --apply to write them into .peaks/memory']), options.json);
    process.exitCode = 1;
    return;
  }

  try {
    const report = executeMemoryIngest({
      projectRoot,
      ...(options.sourceDir !== undefined ? { sourceDir: options.sourceDir } : {}),
      apply: options.apply === true
    });
    const nextActions: string[] = [];
    if (options.apply !== true && report.imported.length > 0) {
      nextActions.push('Preview only — re-run with --apply to write these memories into .peaks/memory.');
    }
    if (report.conflicts.length > 0) {
      nextActions.push(`${report.conflicts.length} conflict(s) left both copies in place; resolve them by hand.`);
    }
    if (report.needsClassification.length > 0) {
      nextActions.push(`${report.needsClassification.length} file(s) could not be classified; add \`metadata.type\` to the source before re-running.`);
    }
    printResult(io, ok('memory.ingest', report, report.warnings, nextActions), options.json);
  } catch (error) {
    const message = getErrorMessage(error);
    const code = (error as { code?: string }).code ?? 'MEMORY_INGEST_FAILED';
    printResult(
      io,
      fail('memory.ingest', code, message, { projectRoot }, ['Check the --source-dir path and that .peaks/memory is writable']),
      options.json
    );
    process.exitCode = 1;
  }
}
