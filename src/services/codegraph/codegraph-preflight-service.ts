// src/services/codegraph/codegraph-preflight-service.ts
//
// Slice 2026-09-03-codegraph-preread (Option A) — pre-dispatch codegraph
// preflight for RD planning. peaks-code's RD dispatch path calls
// `buildCodegraphPreflightBlock` BEFORE composing the RD sub-agent prompt
// (src/cli/commands/dispatch-commands.ts) so the RD plans against the real
// module/file topology in the codegraph index, not LLM memory.
//
// The service does three things, all best-effort and fail-soft (it NEVER
// throws — every failure returns `{ available: false, note }` so the caller
// degrades to a "codegraph unavailable — proceeding on project-scan only"
// note and dispatch proceeds):
//
//   1. Ensure the schema exists: when `<projectRoot>/.codegraph/` is
//      absent, run `codegraph init` + `codegraph index` (best-effort).
//   2. Skip-when-fresh: when `.codegraph/` already carries the
//      peaks-loop marker, do NOT re-init / re-index on every dispatch
//      (index is incremental; the sibling rid-2026-09-03-codegraph-autorefresh
//      owns post-slice refresh). A foreign-schema `.codegraph/` is never
//      clobbered — we fail-soft instead.
//   3. Read a BOUNDED project-structure summary from the index
//      (`codegraph files --json`) and render it as a `## Codegraph
//      structure` markdown block.
//
// Bounded-output contract: the rendered block never exceeds a safe prompt
// budget. The pure renderer `renderCodegraphStructureBlock` caps the
// directory histogram at CODEGRAPH_STRUCTURE_MAX_DIRS rows and the root-file
// listing at CODEGRAPH_STRUCTURE_MAX_ROOT_FILES entries; anything beyond
// those caps is summarized with a "… and N more" line and a `truncated: true`
// flag. Documented caps:
//   - CODEGRAPH_STRUCTURE_MAX_DIRS        = 40  directory rows
//   - CODEGRAPH_STRUCTURE_MAX_ROOT_FILES  = 12  bare root files

import { mkdirSync } from 'node:fs';
import {
  CODEGRAPH_DIR_NAME,
  createCodegraphInvocation,
  defaultCodegraphInitGuard,
  executeCodegraphInvocation,
  writeCodegraphMarker,
  type CodegraphProcessRunner,
} from './codegraph-service.js';
import { defaultCodegraphProcessRunner } from './codegraph-process-runner.js';

export type CodegraphPreflightResult =
  | { available: true; block: string; fileCount: number; truncated: boolean }
  | { available: false; note: string };

/** Cap for the directory histogram in the rendered structure block. */
export const CODEGRAPH_STRUCTURE_MAX_DIRS = 40;
/** Cap for bare root files listed in the rendered structure block. */
export const CODEGRAPH_STRUCTURE_MAX_ROOT_FILES = 12;

export interface CodegraphStructureFileEntry {
  readonly path: string;
}

export interface CodegraphStructureRenderOptions {
  readonly maxDirs?: number;
  readonly maxRootFiles?: number;
}

export interface CodegraphStructureSummary {
  /** Full `## Codegraph structure` markdown block, ending on its own paragraph. */
  block: string;
  total: number;
  truncated: boolean;
}

/** Strip a leading `./` (upstream codegraph paths may carry it). */
function normalizeCodegraphPath(path: string): string {
  return path.startsWith('./') ? path.slice(2) : path;
}

/**
 * Pure renderer: turn the codegraph `files --json` payload into a bounded
 * `## Codegraph structure` block. Files are aggregated into a directory
 * histogram (immediate parent dir; bare root files bucket separately),
 * sorted by file count descending then name ascending, and capped at
 * `maxDirs` rows / `maxRootFiles` root entries. Exported separately so the
 * bounded-output contract is unit-testable without a filesystem.
 */
export function renderCodegraphStructureBlock(
  files: readonly CodegraphStructureFileEntry[],
  options: CodegraphStructureRenderOptions = {},
): CodegraphStructureSummary {
  const maxDirs = options.maxDirs ?? CODEGRAPH_STRUCTURE_MAX_DIRS;
  const maxRootFiles = options.maxRootFiles ?? CODEGRAPH_STRUCTURE_MAX_ROOT_FILES;
  const dirCounts = new Map<string, number>();
  const rootFiles: string[] = [];
  let total = 0;

  for (const file of files) {
    const raw = normalizeCodegraphPath(file.path).replace(/\\/g, '/');
    if (raw.length === 0) continue;
    total += 1;
    const slash = raw.lastIndexOf('/');
    if (slash === -1) {
      rootFiles.push(raw);
      continue;
    }
    const dir = raw.slice(0, slash);
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }

  const sortedDirs = [...dirCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shownDirs = sortedDirs.slice(0, maxDirs);
  const truncatedDirs = sortedDirs.length > maxDirs;

  const sortedRoot = [...rootFiles].sort((a, b) => a.localeCompare(b));
  const shownRoot = sortedRoot.slice(0, maxRootFiles);
  const truncatedRoot = sortedRoot.length > maxRootFiles;

  const lines: string[] = ['## Codegraph structure', ''];
  lines.push(
    total === 0
      ? 'No files are indexed yet. Run `peaks codegraph index` before dispatching planning work for symbol-accurate structure.'
      : `${total} file${total === 1 ? '' : 's'} indexed in the codegraph index:`,
  );
  for (const [dir, count] of shownDirs) {
    lines.push(`- \`${dir}/\` — ${count} file${count === 1 ? '' : 's'}`);
  }
  if (truncatedDirs) {
    lines.push(`- … and ${sortedDirs.length - maxDirs} more director${sortedDirs.length - maxDirs === 1 ? 'y' : 'ies'}`);
  }
  if (sortedRoot.length > 0) {
    lines.push(`- (root) — ${shownRoot.map((f) => `\`${f}\``).join(', ')}${truncatedRoot ? ' …' : ''}`);
  }

  const block = lines.join('\n').replace(/\s+$/, '') + '\n\n';
  return { block, total, truncated: truncatedDirs || truncatedRoot };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstMeaningfulLine(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'no upstream output';
  const first = trimmed.split(/\r?\n/)[0];
  return first !== undefined ? first.slice(0, 200) : 'no upstream output';
}

function parseFilesPayload(stdout: string): { ok: boolean; entries: CodegraphStructureFileEntry[] } {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (Array.isArray(parsed)) {
      const entries = parsed
        .filter((entry): entry is { path: unknown } => typeof entry === 'object' && entry !== null && 'path' in entry)
        .map((entry) => ({ path: typeof entry.path === 'string' ? entry.path : '' }))
        .filter((entry) => entry.path.length > 0);
      return { ok: true, entries };
    }
    // JSON but not an array — not the shape we expect.
    return { ok: false, entries: [] };
  } catch {
    // Not JSON at all — e.g. the upstream text path ("No files indexed…").
    return { ok: false, entries: [] };
  }
}

async function readStructure(
  projectRoot: string,
  runner: CodegraphProcessRunner,
): Promise<CodegraphPreflightResult> {
  let result;
  try {
    const invocation = createCodegraphInvocation({ subcommand: 'files', project: projectRoot, json: true });
    result = await executeCodegraphInvocation(invocation, runner);
  } catch (error) {
    return { available: false, note: `codegraph files unavailable: ${errorMessage(error)}` };
  }
  if (result.exitCode !== 0) {
    return {
      available: false,
      note: `codegraph files failed (exit ${String(result.exitCode)}): ${firstMeaningfulLine(result.stderr || result.stdout)}`,
    };
  }
  const { ok, entries } = parseFilesPayload(result.stdout);
  if (!ok) {
    return {
      available: false,
      note: 'codegraph files returned no parseable structure — run `peaks codegraph index` before dispatch for symbol-accurate structure.',
    };
  }
  if (entries.length === 0) {
    return {
      available: false,
      note: 'codegraph index has no files — run `peaks codegraph index` before dispatch for symbol-accurate structure.',
    };
  }
  const summary = renderCodegraphStructureBlock(entries);
  return {
    available: true,
    block: summary.block,
    fileCount: summary.total,
    truncated: summary.truncated,
  };
}

/**
 * Pre-dispatch codegraph preflight. Returns a `## Codegraph structure`
 * block when the index is (or becomes) readable; otherwise an
 * `{ available: false, note }` result. NEVER throws — the caller must be
 * able to degrade gracefully on every failure path.
 *
 * Behavior matrix (acceptance criteria):
 * - `.codegraph/` absent  → init + index (best-effort), then read.
 * - `.codegraph/` present with peaks-loop marker → skip init/index
 *   (fresh), read directly. No redundant re-index on every dispatch.
 * - `.codegraph/` present WITHOUT marker (foreign schema) → fail-soft;
 *   never clobber a foreign store.
 *
 * The optional `runner` mirrors `CodegraphProcessRunner` and is the ONLY
 * injected boundary (tests fake the upstream binary).
 */
export async function buildCodegraphPreflightBlock(
  projectRoot: string,
  runner?: CodegraphProcessRunner,
): Promise<CodegraphPreflightResult> {
  const processRunner: CodegraphProcessRunner = runner ?? defaultCodegraphProcessRunner;
  const guard = defaultCodegraphInitGuard(projectRoot);

  if (guard.status === 'conflict-foreign-schema') {
    return {
      available: false,
      note: `codegraph unavailable: ${CODEGRAPH_DIR_NAME}/ exists with a non-peaks-loop schema and was not touched. Move or rename the foreign directory, then re-run \`peaks codegraph init\` to enable pre-dispatch structure reads.`,
    };
  }

  if (guard.status === 'fresh') {
    // 1. init (best-effort). Upstream creates the `.codegraph/` dir; we
    //    stamp the peaks-loop marker afterwards so the NEXT dispatch hits
    //    the noop (skip-when-fresh) branch.
    try {
      const initResult = await executeCodegraphInvocation(
        createCodegraphInvocation({ subcommand: 'init', project: projectRoot }),
        processRunner,
      );
      if (initResult.exitCode !== 0) {
        return {
          available: false,
          note: `codegraph init failed (exit ${String(initResult.exitCode)}): ${firstMeaningfulLine(initResult.stderr || initResult.stdout)}`,
        };
      }
      try {
        // Upstream init creates `.codegraph/`; mkdir is a no-op in the real
        // path and lets the marker write succeed even when the runner is
        // faked (tests). Best-effort: failure must not undo the init.
        mkdirSync(guard.codegraphDir, { recursive: true });
        writeCodegraphMarker(guard.codegraphDir);
      } catch {
        // Best-effort: a marker-write failure must not undo the init.
      }
    } catch (error) {
      return { available: false, note: `codegraph init unavailable: ${errorMessage(error)}` };
    }
    // 2. index (best-effort).
    try {
      const indexResult = await executeCodegraphInvocation(
        createCodegraphInvocation({ subcommand: 'index', project: projectRoot, quiet: true }),
        processRunner,
      );
      if (indexResult.exitCode !== 0) {
        return {
          available: false,
          note: `codegraph index failed (exit ${String(indexResult.exitCode)}): ${firstMeaningfulLine(indexResult.stderr || indexResult.stdout)}`,
        };
      }
    } catch (error) {
      return { available: false, note: `codegraph index unavailable: ${errorMessage(error)}` };
    }
  }
  // guard.status === 'noop-already-peaks-loop' (or we just initialized):
  // the schema exists — do NOT re-index, go straight to the bounded read.
  return readStructure(projectRoot, processRunner);
}
