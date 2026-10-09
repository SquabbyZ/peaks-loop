// Split out of `slice-commands.ts`:
// `peaks slice ls` plus the decomposition-artifact listing it renders. The
// action was 93 code lines; the JSON/table renderers and the filters are their
// own functions so each stays inside the 50-code-line cap.
import type { Command } from 'commander';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

/**
 * PRD-002b slice 2 — extract CLI listing-pagination + table-format
 * constants. Values are bytewise-identical to the original literals.
 */
const SLICE_LIST_DEFAULT_LIMIT = 50;
const SLICE_LIST_MAX_LIMIT = 500;
const SLICE_LIST_RID_COL_WIDTH = 34;
const SLICE_LIST_MTIME_COL_WIDTH = 22;
const SLICE_LIST_SIZE_COL_WIDTH = 8;
const SLICE_LIST_PICKED_COL_WIDTH = 6;
const SLICE_LIST_SEPARATOR_WIDTH = 76;

const LIST_DESCRIPTION =
  'List slice decomposition artifacts under .peaks/sc/slice-decomposition/. ' +
  'Returns one row per distinct rid with mtime, sizeBytes, pickedPath, and isStale ' +
  '(mtime > 30d). Use --stale-only to filter, --rid <substring> to narrow, ' +
  '--limit <n> to cap. To remove stale entries, use `peaks slice cleanup` (separate slice).';
const LIST_PROJECT_HELP = 'target project root';
const LIST_LIMIT_HELP = 'cap result count (default 50, max 500)';
const LIST_STALE_ONLY_HELP = 'only include rids older than the stale threshold';
const LIST_RID_HELP = 'case-insensitive substring filter on rid';

type SliceListOptions = {
  project: string;
  limit?: number;
  staleOnly?: boolean;
  rid?: string;
  json?: boolean;
};

interface SliceListingRow {
  readonly rid: string;
  readonly decompositionPath: string;
  readonly pickedPath: string | null;
  readonly mtime: string;
  readonly sizeBytes: number;
  readonly isStale: boolean;
}

type ListPageContext = {
  truncated: boolean;
  filteredCount: number;
  allCount: number;
  limit: number;
};

/**
 * Stale threshold for slice decomposition artifacts. Matches the default
 * recorded in .peaks/memory/ for follow-up). If that slice ships with a
 * different default, both must update here.
 */
// eslint-disable-next-line no-magic-numbers -- canonical 30-day-in-ms math
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Enumerate every slice decomposition artifact under
 * `.peaks/sc/slice-decomposition/`. Returns one row per distinct rid.
 * Missing directory is treated as empty (returns []), matching the
 * "fresh peaks repo" UX (AC5+AC6).
 *
 * Sorted by mtime descending so the most recent rid is first (AC3).
 */
function listDecompositions(projectRoot: string): readonly SliceListingRow[] {
  const dir = join(projectRoot, '.peaks', 'sc', 'slice-decomposition');
  if (!existsSync(dir)) return [];
  const nowMs = Date.now();
  const byRid = new Map<string, SliceListingRow>();
  for (const entry of readdirSync(dir)) {
    // Skip non-matching files (e.g., stray .DS_Store)
    if (!entry.endsWith('.json')) continue;
    let rid: string;
    let isPicked: boolean;
    if (entry.endsWith('-picked.json')) {
      rid = entry.slice(0, -'-picked.json'.length);
      isPicked = true;
    } else {
      rid = entry.slice(0, -'.json'.length);
      isPicked = false;
    }
    const absPath = join(dir, entry);
    const st = statSync(absPath);
    const existing = byRid.get(rid);
    if (isPicked) {
      // Picked file is supplementary; only fill in pickedPath on the existing row
      if (existing) {
        byRid.set(rid, { ...existing, pickedPath: absPath });
      } else {
        // -picked.json without a corresponding <rid>.json: still surface it
        byRid.set(rid, {
          rid,
          decompositionPath: '',
          pickedPath: absPath,
          mtime: st.mtime.toISOString(),
          sizeBytes: 0,
          isStale: nowMs - st.mtime.getTime() > STALE_THRESHOLD_MS
        });
      }
      continue;
    }
    byRid.set(rid, {
      rid,
      decompositionPath: absPath,
      pickedPath: existing?.pickedPath ?? null,
      mtime: st.mtime.toISOString(),
      sizeBytes: st.size,
      isStale: nowMs - st.mtime.getTime() > STALE_THRESHOLD_MS
    });
  }
  return Array.from(byRid.values()).sort((a, b) =>
    a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0
  );
}

function filterDecompositions(
  all: readonly SliceListingRow[],
  options: SliceListOptions
): readonly SliceListingRow[] {
  let filtered = all;
  const ridSub = (options.rid ?? '').toLowerCase();
  if (ridSub.length > 0) {
    filtered = filtered.filter((row) => row.rid.toLowerCase().includes(ridSub));
  }
  if (options.staleOnly === true) {
    filtered = filtered.filter((row) => row.isStale);
  }
  return filtered;
}

function sliceListNextActions(
  page: readonly SliceListingRow[],
  truncated: boolean,
  limit: number
): string[] {
  const nextActions: string[] = [];
  if (truncated) {
    nextActions.push(`Result truncated to ${limit} rows; pass --limit <n> to see more.`);
  }
  if (page.some((r) => r.isStale)) {
    nextActions.push('Some entries are stale (>30d). Use `peaks slice cleanup` to remove them.');
  }
  return nextActions;
}

function printSliceListJson(
  io: ProgramIO,
  page: readonly SliceListingRow[],
  ctx: ListPageContext
): void {
  printResult(
    io,
    ok(
      'slice.ls',
      {
        rids: page,
        truncated: ctx.truncated,
        totalBeforeFilter: ctx.filteredCount,
        totalScanned: ctx.allCount
      },
      [],
      sliceListNextActions(page, ctx.truncated, ctx.limit)
    ),
    true
  );
}

function printSliceListTable(
  io: ProgramIO,
  page: readonly SliceListingRow[],
  ctx: Pick<ListPageContext, 'truncated' | 'filteredCount' | 'limit'>
): void {
  const lines: string[] = [];
  lines.push(
    'RID'.padEnd(SLICE_LIST_RID_COL_WIDTH) +
      'MTIME'.padEnd(SLICE_LIST_MTIME_COL_WIDTH) +
      'SIZE'.padEnd(SLICE_LIST_SIZE_COL_WIDTH) +
      'PICKED'.padEnd(SLICE_LIST_PICKED_COL_WIDTH) +
      'STALE'
  );
  lines.push('-'.repeat(SLICE_LIST_SEPARATOR_WIDTH));
  for (const r of page) {
    lines.push(
      r.rid.padEnd(SLICE_LIST_RID_COL_WIDTH) +
        r.mtime.padEnd(SLICE_LIST_MTIME_COL_WIDTH) +
        String(r.sizeBytes).padEnd(SLICE_LIST_SIZE_COL_WIDTH) +
        (r.pickedPath ? 'yes' : 'no').padEnd(SLICE_LIST_PICKED_COL_WIDTH) +
        (r.isStale ? 'yes' : 'no')
    );
  }
  if (ctx.truncated) {
    lines.push(`... (${ctx.filteredCount - ctx.limit} more, --limit to see more)`);
  }
  if (page.length === 0) {
    lines.push('(no slice decompositions found)');
  }
  process.stdout.write(lines.join('\n') + '\n');
}

function runSliceList(options: SliceListOptions, io: ProgramIO): void {
  try {
    const projectRoot = resolveCanonicalProjectRoot(options.project);
    const limit = Math.max(
      1,
      Math.min(SLICE_LIST_MAX_LIMIT, options.limit ?? SLICE_LIST_DEFAULT_LIMIT)
    );
    const all = listDecompositions(projectRoot);
    const filtered = filterDecompositions(all, options);
    const truncated = filtered.length > limit;
    const page = filtered.slice(0, limit);
    const ctx: ListPageContext = {
      truncated,
      filteredCount: filtered.length,
      allCount: all.length,
      limit
    };
    if (options.json === true) {
      printSliceListJson(io, page, ctx);
      return;
    }
    printSliceListTable(io, page, ctx);
  } catch (error) {
    printResult(
      io,
      fail(
        'slice.ls',
        'SLICE_LS_FAILED',
        getErrorMessage(error),
        { projectRoot: options.project },
        [
          'Verify the project path is a peaks repo and .peaks/sc/slice-decomposition/ exists or can be created'
        ]
      ),
      options.json ?? false
    );
    process.exitCode = 1;
  }
}

// Read-only listing of every decomposition artifact under
// .peaks/sc/slice-decomposition/. Used by operators to see what's
// accumulated; companion to a future `peaks slice cleanup` subcommand.
export function registerSliceListCommand(slice: Command, io: ProgramIO): void {
  addJsonOption(
    slice
      .command('ls')
      .description(LIST_DESCRIPTION)
      .option('--project <path>', LIST_PROJECT_HELP, '.')
      .option('--limit <n>', LIST_LIMIT_HELP, (v) => parseInt(v, 10), SLICE_LIST_DEFAULT_LIMIT)
      .option('--stale-only', LIST_STALE_ONLY_HELP, false)
      .option('--rid <substring>', LIST_RID_HELP, '')
  ).action((options: SliceListOptions) => runSliceList(options, io));
}
