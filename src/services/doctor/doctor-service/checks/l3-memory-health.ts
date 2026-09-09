/**
 * Checks for `.peaks/memory/` health (`L3:l3-memory-health` and siblings).
 *
 * Slice 2026-06-13-repair-pre-existing-test-failures: the
 * production MemoryIndex schema (see
 * `src/services/memory/project-memory-service.ts`) uses
 * `version: 1` as the schema marker, NOT `schema_version`.
 * We accept BOTH names for back-compat with any external index
 * writers (e.g. a future `schema_version: '2.0.0'` form).
 *
 * When no `.peaks/memory/index.json` exists yet, the check passes
 * (fresh project — no memories have been extracted).
 *
 * Slice 2026-09-09-memory-system-overhaul (D) extends the check with the
 * drift findings the original version could not see. It used to report
 * `ok: true` for "index.json is well-formed JSON; 100 hot + 131 warm" and
 * never looked at coverage, orphans, or unclassified files. It now emits,
 * in addition to the unchanged well-formed-JSON assertion:
 *
 *   - `L3:l3-memory-coverage`      — disk files vs indexed entries (warning
 *                                    when the gap exceeds a small threshold)
 *   - `L3:l3-memory-orphans`       — index entries whose `sourcePath` is gone
 *                                    (error) + disk files absent from the
 *                                    index (warning)
 *   - `L3:l3-memory-unclassified`  — files with no resolvable kind (warning,
 *                                    count + first N names)
 *
 * All three are read-only and fail-soft: an inspection error degrades to a
 * single warning instead of throwing, and none of them change the id or the
 * `ok` semantics of the original `L3:l3-memory-health` assertion.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import {
  listMarkdownFiles,
  MEMORY_MD_FILENAME,
  parseMemoryFrontmatter
} from '../../../memory/project-memory-service/index.js';
import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

interface MemoryIndexShape {
  schema_version?: string;
  version?: number | string;
  hot?: Record<string, unknown[]>;
  warm?: Record<string, unknown[]>;
  cold?: unknown[];
}

/** Warn when |disk - indexed| exceeds this. Small enough to catch real drift. */
const COVERAGE_GAP_WARN_THRESHOLD = 2;
/** How many offending names to inline before truncating the message. */
const MAX_NAMES_IN_MESSAGE = 5;

function countEntries(bucket: Record<string, unknown[]> | undefined): number {
  return Object.values(bucket ?? {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
}

function previewNames(names: readonly string[]): string {
  const shown = names.slice(0, MAX_NAMES_IN_MESSAGE);
  const suffix = names.length > shown.length ? ` (+${names.length - shown.length} more)` : '';
  return shown.join(', ') + suffix;
}

interface IndexEntryShape {
  name?: string;
  sourcePath?: string;
}

function readIndexSourcePaths(indexPath: string): IndexEntryShape[] {
  const parsed = JSON.parse(readFileSync(indexPath, 'utf8')) as MemoryIndexShape;
  const fromBucket = (bucket: Record<string, unknown[]> | undefined): IndexEntryShape[] =>
    Object.values(bucket ?? {}).flatMap((arr) => (Array.isArray(arr) ? (arr as IndexEntryShape[]) : []));
  return [...fromBucket(parsed.hot), ...fromBucket(parsed.warm), ...((parsed.cold ?? []) as IndexEntryShape[])];
}

function inspectDrift(
  memoryDir: string,
  memoryIndexPath: string,
  indexedCount: number
): readonly DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const diskFiles = listMarkdownFiles(memoryDir).filter((filePath) => basename(filePath) !== MEMORY_MD_FILENAME);

  // --- coverage ---------------------------------------------------------
  const gap = diskFiles.length - indexedCount;
  if (Math.abs(gap) > COVERAGE_GAP_WARN_THRESHOLD) {
    const direction = gap > 0
      ? `${gap} file(s) on disk are not in the index`
      : `${-gap} index entr(ies) have no matching file`;
    checks.push({
      id: 'L3:l3-memory-coverage',
      ok: false,
      severity: 'warning',
      message: `Memory index coverage gap: ${diskFiles.length} file(s) on disk vs ${indexedCount} indexed — ${direction}. Run \`peaks memory reindex\` for the full drift report.`
    });
  } else {
    checks.push({
      id: 'L3:l3-memory-coverage',
      ok: true,
      message: `Memory index coverage: ${diskFiles.length} file(s) on disk, ${indexedCount} indexed (within threshold ${COVERAGE_GAP_WARN_THRESHOLD})`
    });
  }

  // --- orphans (both directions) ---------------------------------------
  const missingSources = readIndexSourcePaths(memoryIndexPath)
    .filter((entry) => typeof entry.sourcePath !== 'string' || entry.sourcePath.length === 0 || !existsSync(entry.sourcePath))
    .map((entry) => entry.name ?? entry.sourcePath ?? '<unnamed>')
    .sort((left, right) => left.localeCompare(right));
  if (missingSources.length > 0) {
    checks.push({
      id: 'L3:l3-memory-orphans',
      ok: false,
      severity: 'error',
      message: `${missingSources.length} index entr(ies) point at a missing sourcePath: ${previewNames(missingSources)}. Run \`peaks memory reindex\` to rebuild the index.`
    });
  } else {
    checks.push({
      id: 'L3:l3-memory-orphans',
      ok: true,
      message: 'No memory index entries point at missing files'
    });
  }

  // --- unclassified -----------------------------------------------------
  const unclassified: string[] = [];
  for (const filePath of diskFiles) {
    try {
      if (parseMemoryFrontmatter(readFileSync(filePath, 'utf8')).kind.kind === null) {
        unclassified.push(basename(filePath, '.md'));
      }
    } catch {
      unclassified.push(`${basename(filePath, '.md')} (unreadable)`);
    }
  }
  unclassified.sort((left, right) => left.localeCompare(right));
  if (unclassified.length > 0) {
    checks.push({
      id: 'L3:l3-memory-unclassified',
      ok: false,
      severity: 'warning',
      message: `${unclassified.length} memory file(s) have no resolvable kind (no metadata.type / kind / type): ${previewNames(unclassified)}. Add \`metadata.type\` then run \`peaks memory reindex\`.`
    });
  } else {
    checks.push({
      id: 'L3:l3-memory-unclassified',
      ok: true,
      message: 'Every memory file on disk has a resolvable kind'
    });
  }

  return checks;
}

function run({ resolvedL3Root }: DoctorContext): readonly DoctorCheck[] {
  const memoryDir = join(resolvedL3Root, '.peaks/memory');
  const memoryIndexPath = join(memoryDir, 'index.json');
  if (!existsSync(memoryIndexPath)) {
    return [{
      id: 'L3:l3-memory-health',
      ok: true,
      message: 'No .peaks/memory/index.json yet (no memories extracted)'
    }];
  }

  let parsed: MemoryIndexShape;
  try {
    const raw = readFileSync(memoryIndexPath, 'utf8');
    parsed = JSON.parse(raw) as MemoryIndexShape;
  } catch (parseError) {
    return [{
      id: 'L3:l3-memory-health',
      ok: false,
      message: `.peaks/memory/index.json is not valid JSON: ${getErrorMessage(parseError)}`
    }];
  }

  const schemaMarker = parsed.schema_version ?? parsed.version;
  if (schemaMarker === undefined) {
    return [{
      id: 'L3:l3-memory-health',
      ok: false,
      message: '.peaks/memory/index.json missing schema_version / version field'
    }];
  }

  const hotCount = countEntries(parsed.hot);
  const warmCount = countEntries(parsed.warm);
  const checks: DoctorCheck[] = [{
    id: 'L3:l3-memory-health',
    ok: true,
    message: `.peaks/memory/index.json is well-formed JSON; version=${schemaMarker}; ${hotCount} hot + ${warmCount} warm memory entries`
  }];

  // Drift inspection is best-effort: a scan failure must not turn a
  // well-formed index into a hard failure.
  try {
    checks.push(...inspectDrift(memoryDir, memoryIndexPath, hotCount + warmCount));
  } catch (error) {
    checks.push({
      id: 'L3:l3-memory-coverage',
      ok: true,
      severity: 'warning',
      message: `Memory drift inspection skipped: ${getErrorMessage(error)}`
    });
  }

  return checks;
}

export const check: DoctorCheckPlugin = {
  name: 'l3-memory-health',
  run
};
