/**
 * The slice-boundary step for the stored graph: it rewrites the derived token
 * reverse index and marks the entries a moved spacing token now reaches.
 *
 * It never captures. No page render can run inside a slice checkpoint, so the
 * step marks stale and reports the captures it leaves pending; a re-measure is
 * a separate, explicit refresh.
 */
import { existsSync } from 'node:fs';

import { affectedEntries } from './layout-graph-incremental.js';
import { recordedDesignRoot } from './layout-graph-root-record.js';
import { rebuildIndexes } from './layout-graph-store.js';
import { graphRoot } from './layout-graph-paths.js';
import { readSpacingTokensStrict, type SpacingToken } from './layout-tokens.js';

export type LayoutGraphSliceReason =
  'no-graph' | 'no-index' | 'capture-required' | 'unavailable' | 'up-to-date';

export type LayoutGraphSliceRefresh = {
  reason: LayoutGraphSliceReason;
  /**
   * Entries whose cited tokens moved: marked stale here, never re-measured here.
   * `null` when the step could not enumerate the graph, so the count is unknown.
   */
  markedStale: number | null;
  /** Entries that need a capture before they can be cited as current; `null` when unknown. */
  pendingCapture: number | null;
  note: string;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function staleLine(count: number): string {
  return count === 1 ? 'marked 1 graph entry stale' : `marked ${String(count)} graph entries stale`;
}

function unknownCount(reason: LayoutGraphSliceReason, note: string): LayoutGraphSliceRefresh {
  return { reason, markedStale: null, pendingCapture: null, note };
}

/** A step that judged the graph and found nothing pending; zero here is measured, not assumed. */
function nothingPending(reason: LayoutGraphSliceReason, note: string): LayoutGraphSliceRefresh {
  return { reason, markedStale: 0, pendingCapture: 0, note };
}

/** What the moved spacing tokens reach, once the derived index is current. */
function pendingAfter(
  projectRoot: string,
  tokens: readonly SpacingToken[]
): LayoutGraphSliceRefresh {
  const affected = affectedEntries(projectRoot, tokens);
  if (affected.mode === 'full') {
    return unknownCount(
      'no-index',
      `auto layout graph refresh failed: the graph entries cannot be read (${affected.reason ?? 'unknown reason'}); ` +
        'every graph entry must be re-measured before it is cited as current'
    );
  }
  const count = affected.affected.length;
  if (affected.needsRewrite) {
    const indexed = rebuildIndexes(projectRoot);
    if (!indexed.ok) {
      return unknownCount(
        'unavailable',
        `auto layout graph refresh failed: the indexes could not be rewritten (${indexed.reason}); ` +
          'the marked set was not recorded, so treat every entry a moved token reaches as pending'
      );
    }
  }
  if (count === 0) return nothingPending('up-to-date', '');
  const moved = affected.changedTokens.join(', ');
  return {
    reason: 'capture-required',
    markedStale: count,
    pendingCapture: count,
    note:
      `${staleLine(count)} (a moved spacing token: ${moved}); pending capture: ${String(count)} — ` +
      're-measure them before the graph is cited as current evidence'
  };
}

/**
 * Refresh the derived index and report what a changed spacing token reaches.
 * Never throws: every failure becomes a result the caller can print.
 */
export function refreshLayoutGraphAtSliceBoundary(projectRoot: string): LayoutGraphSliceRefresh {
  try {
    if (!existsSync(graphRoot(projectRoot))) {
      return nothingPending(
        'no-graph',
        'auto layout graph refresh skipped: no graph directory exists'
      );
    }
    const read = readSpacingTokensStrict(recordedDesignRoot(projectRoot));
    if (!read.ok) {
      return unknownCount(
        'unavailable',
        `auto layout graph refresh unavailable: ${read.reason}; ` +
          'no entry count could be confirmed, so no entry may be cited as current'
      );
    }
    return pendingAfter(projectRoot, read.tokens);
  } catch (error) {
    return unknownCount(
      'unavailable',
      `auto layout graph refresh unavailable: ${errorText(error)}; ` +
        'no entry count could be confirmed, so no entry may be cited as current'
    );
  }
}

/**
 * The operator-facing line for a boundary step that judged nothing pending, or
 * null when there is nothing to report. A project with no graph never opted in.
 */
export function layoutGraphRefreshNotice(result: LayoutGraphSliceRefresh): string | null {
  if (result.reason === 'no-graph' || result.reason === 'up-to-date') return null;
  return result.note;
}
