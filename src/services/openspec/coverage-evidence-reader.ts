/**
 * Coverage Evidence reader for c8 `coverage-summary.json` (Fix-6B).
 *
 * Slice rid-Fix-6B / sub-slice T1:
 *   - pure helper module, no side effects beyond FS reads
 *   - reads the istanbul-reporter JSON shape emitted by `c8 --reporter=json-summary`
 *     (the project's coverage tool — see scripts/coverage-c8.mjs)
 *   - resolves a `coverage-summary.json` from a fixed discovery order
 *   - validates per-capability coverage against a `## Capability Mapping` block
 *
 * The module is hermetic: every function takes its inputs explicitly and returns
 * either a typed success result or a typed error code. There is no global state.
 * Throws only when the input shape is structurally malformed (the caller cannot
 * recover by branching on a Result variant); otherwise returns Result<T, Code>.
 *
 * Conventions:
 *   - All paths are POSIX-normalized for JSON safety.
 *   - The c8 summary's per-file keys are project-root-relative POSIX paths
 *     (e.g. `src/services/openspec/openspec-archive-service.ts`).
 *   - Capability mapping `source` field is also project-root-relative, may be
 *     a file (`foo.ts`) or a directory (`src/services/openspec/`).
 */

import { posix, relative, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { isDirectory } from 'peaks-loop-shared/fs';

import { ok, err, type Result } from './artifact-boundary.js';
import { normalizePath } from '../../shared/path-utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoverageSummaryPathError =
  | { code: 'missing'; triedPaths: ReadonlyArray<string> }
  | { code: 'not-readable'; path: string; message: string };

export type CoverageSummary = {
  /** Resolved absolute path to the summary file. */
  path: string;
  /** ISO timestamp of the summary file's mtime. */
  capturedAt: string;
  /** Project-root-relative per-file coverage entries. */
  files: ReadonlyMap<string, CoverageFileEntry>;
};

export type CoverageFileEntry = {
  /** Absolute path the c8 entry covers (POSIX). */
  path: string;
  /** Project-root-relative POSIX path (the key the summary uses). */
  relativePath: string;
  statements: { pct: number; covered: number; total: number };
  branches: { pct: number; covered: number; total: number };
  functions: { pct: number; covered: number; total: number };
  lines: { pct: number; covered: number; total: number };
};

/**
 * A single row from the proposal.md `## Capability Mapping` table.
 * Mirror shape of CoverageRequirementRow (Fix-6A) for symmetry.
 */
export type CapabilityMappingRow = {
  /** Capability name (e.g. `quality-gates`). */
  capability: string;
  /** Project-root-relative source path — file or directory. */
  source: string;
  /** Optional test anchor (informational; Fix-6B does not validate). */
  testAnchor?: string;
  /** Source line for diagnostics. */
  line: number;
};

export type CapabilityCoverageMismatch = {
  capability: string;
  source: string;
  failingFiles: ReadonlyArray<{
    path: string;
    actual: {
      statements: number;
      branches: number;
      functions: number;
      lines: number;
    };
    reason: 'below-threshold' | 'missing-from-summary';
  }>;
};

export type CoverageValidation =
  | { ok: true }
  | { ok: false; mismatches: ReadonlyArray<CapabilityCoverageMismatch> };

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const DEFAULT_DISCOVERY = [
  (root: string) => `${root}/coverage/coverage-summary.json`,
  (root: string) => `${root}/openspec/coverage-summary.json`,
];

/**
 * Resolve the path to a coverage-summary.json.
 *
 * Discovery order (per Fix-6B AC1):
 *   1. `explicitPath` (passed via `--coverage-summary`)
 *   2. `<projectRoot>/coverage/coverage-summary.json` (c8 wrapper default)
 *   3. `<projectRoot>/openspec/coverage-summary.json` (per-project override)
 *
 * Returns:
 *   - `{ ok: true, value: path }` when the file exists.
 *   - `{ ok: false, error: { code: 'missing', triedPaths } }` otherwise.
 */
export async function resolveCoverageSummaryPath(input: {
  projectRoot: string;
  explicitPath?: string;
}): Promise<Result<string, CoverageSummaryPathError>> {
  const triedPaths: string[] = [];

  if (input.explicitPath !== undefined) {
    const abs = resolve(input.explicitPath);
    triedPaths.push(abs);
    if (await isReadable(abs)) {
      return ok(abs);
    }
    return err({ code: 'not-readable', path: abs, message: `Cannot read coverage summary at ${abs}` });
  }

  for (const factory of DEFAULT_DISCOVERY) {
    const candidate = factory(toPosix(input.projectRoot));
    triedPaths.push(candidate);
    if (await isReadable(candidate)) {
      return ok(candidate);
    }
  }

  return err({ code: 'missing', triedPaths });
}

function toPosix(p: string): string {
  return normalizePath(p).replace(/\/$/, '');
}

async function isReadable(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Read and parse a coverage-summary.json into a typed `CoverageSummary`.
 *
 * Expected istanbul-reporter shape:
 *
 *     {
 *       "total": { "lines": { "pct": 100, ... }, ... },
 *       "src/foo.ts": { "lines": { "pct": 100, ... }, ... },
 *       ...
 *     }
 *
 * Throws only on structural malformation (caller cannot branch on a Result).
 * The fix-6B gate handles a missing summary via the discovery layer, not here.
 */
export async function readC8Summary(path: string): Promise<CoverageSummary> {
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`coverage summary at ${path} is not a JSON object`);
  }

  const obj = parsed as Record<string, unknown>;
  const files = new Map<string, CoverageFileEntry>();

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'total') continue;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const lines = asMetric(entry['lines']);
    const statements = asMetric(entry['statements']);
    const functions = asMetric(entry['functions']);
    const branches = asMetric(entry['branches']);
    if (lines === null || statements === null || functions === null || branches === null) {
      continue;
    }
    const normalizedKey = posix.normalize(normalizePath(key));
    files.set(normalizedKey, {
      path: normalizePathSep(normalizedKey),
      relativePath: normalizedKey,
      statements,
      branches,
      functions,
      lines,
    });
  }

  const stat_ = await stat(path);
  return {
    path,
    capturedAt: stat_.mtime.toISOString(),
    files,
  };
}

function asMetric(input: unknown): { pct: number; covered: number; total: number } | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;
  const pct = obj['pct'];
  const covered = obj['covered'];
  const total = obj['total'];
  if (typeof pct !== 'number' || typeof covered !== 'number' || typeof total !== 'number') return null;
  return { pct, covered, total };
}

function normalizePathSep(p: string): string {
  return normalizePath(p);
}

// ---------------------------------------------------------------------------
// Capability Mapping block parser (proposal.md)
// ---------------------------------------------------------------------------

/**
 * Parse the `## Capability Mapping` block out of a proposal.md.
 *
 * Accepted shape (markdown table):
 *
 *     ## Capability Mapping
 *
 *     | capability | source | testAnchor |
 *     | --- | --- | --- |
 *     | quality-gates | src/services/openspec/openspec-archive-service.ts | tests/unit/openspec-archive-service.test.ts |
 *     | artifact-workspace | src/services/openspec/artifact-boundary.ts | tests/unit/services/openspec/artifact-boundary.test.ts |
 *
 * Returns `{ present: false }` when the heading is missing (Fix-6B back-compat:
 * the change does not declare a mapping, so no per-capability check is possible
 * and the gate stays at Fix-6A's declarative level).
 */
export async function parseCapabilityMapping(proposalPath: string): Promise<{
  rows: ReadonlyArray<CapabilityMappingRow>;
  present: boolean;
}> {
  let raw: string;
  try {
    raw = await readFile(proposalPath, 'utf8');
  } catch {
    return { rows: [], present: false };
  }

  const lines = raw.split(/\r?\n/);
  const headingIdx = lines.findIndex((line) => /^##\s+Capability\s+Mapping\s*$/.test(line));
  if (headingIdx === -1) {
    return { rows: [], present: false };
  }

  const rows: CapabilityMappingRow[] = [];
  let i = headingIdx + 1;
  let inFence = false;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    if (!inFence && /^##\s+/.test(line)) break;
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      i += 1;
      continue;
    }
    const parsed = parseCapabilityRow(line);
    if (parsed !== null) {
      rows.push({ ...parsed, line: i + 1 });
    }
    i += 1;
  }

  return { rows, present: true };
}

function parseCapabilityRow(line: string): Omit<CapabilityMappingRow, 'line'> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length < 2) return null;
  const capability = cells[0];
  const source = cells[1];
  const testAnchor = cells[2];
  if (capability === undefined || source === undefined) return null;
  if (capability.toLowerCase() === 'capability' && source.toLowerCase() === 'source') return null;
  if (/^-+$/.test(capability.replace(/\s+/g, ''))) return null;
  const row: Omit<CapabilityMappingRow, 'line'> = {
    capability,
    source: normalizePath(source).replace(/^\.\//, '').replace(/\/$/, ''),
  };
  if (testAnchor !== undefined && testAnchor !== '') {
    row.testAnchor = testAnchor;
  }
  return row;
}

// ---------------------------------------------------------------------------
// Resolve files for a capability row
// ---------------------------------------------------------------------------

/**
 * Resolve the source files that a capability row covers.
 *
 * - File path: returns `[file]`.
 * - Directory path: returns every `*.ts` file recursively under it (relative
 *   to `projectRoot`, POSIX separators). Non-TS files are excluded because
 *   c8 only collects coverage on TS source modules.
 */
export async function resolveCapabilityFiles(input: {
  projectRoot: string;
  row: CapabilityMappingRow;
}): Promise<ReadonlyArray<string>> {
  const abs = resolve(input.projectRoot, input.row.source);
  if (!(await isDirectory(abs))) {
    const rel = normalizePath(relative(input.projectRoot, abs));
    return [rel];
  }
  return await walkTsFiles(abs, input.projectRoot);
}

async function walkTsFiles(absRoot: string, projectRoot: string): Promise<string[]> {
  // Lightweight walk; avoids pulling in fast-glob for one offscreen consumer.
  const { readdir } = await import('node:fs/promises');
  const out: string[] = [];
  const stack = [absRoot];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        const rel = normalizePath(relative(projectRoot, full));
        out.push(rel);
      }
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Validate per-capability coverage. Each capability row's `source` is resolved
 * to one or more files; each file must appear in the c8 summary with all four
 * metrics at exactly 100%.
 *
 * Returns `{ ok: true }` when every capability passes; `{ ok: false, mismatches }`
 * otherwise. The caller is responsible for rendering the mismatches into the
 * `OPENSPEC_COVERAGE_EVIDENCE_MISMATCH` error envelope.
 */
export async function validateCapabilityCoverage(input: {
  projectRoot: string;
  summary: CoverageSummary;
  rows: ReadonlyArray<CapabilityMappingRow>;
}): Promise<CoverageValidation> {
  const mismatches: CapabilityCoverageMismatch[] = [];

  for (const row of input.rows) {
    const files = await resolveCapabilityFiles({ projectRoot: input.projectRoot, row });
    const failing: Array<{
      path: string;
      actual: { statements: number; branches: number; functions: number; lines: number };
      reason: 'below-threshold' | 'missing-from-summary';
    }> = [];

    for (const file of files) {
      const entry = input.summary.files.get(file);
      if (entry === undefined) {
        failing.push({
          path: file,
          actual: { statements: 0, branches: 0, functions: 0, lines: 0 },
          reason: 'missing-from-summary',
        });
        continue;
      }
      if (
        entry.statements.pct !== 100 ||
        entry.branches.pct !== 100 ||
        entry.functions.pct !== 100 ||
        entry.lines.pct !== 100
      ) {
        failing.push({
          path: file,
          actual: {
            statements: entry.statements.pct,
            branches: entry.branches.pct,
            functions: entry.functions.pct,
            lines: entry.lines.pct,
          },
          reason: 'below-threshold',
        });
      }
    }

    if (failing.length > 0) {
      mismatches.push({
        capability: row.capability,
        source: row.source,
        failingFiles: failing,
      });
    }
  }

  if (mismatches.length === 0) {
    return { ok: true };
  }
  return { ok: false, mismatches };
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/**
 * Compare the mtime of every spec/proposal/tasks file under the change against
 * the mtime of the c8 summary. If any change file is newer than the summary,
 * the captured V8 counters no longer match the source on disk and the summary
 * is stale.
 *
 * Returns the list of stale files (project-root-relative POSIX paths). An empty
 * array means the summary is fresh.
 */
export async function findStaleChangeFiles(input: {
  projectRoot: string;
  openspecRoot: string;
  changeId: string;
  summary: CoverageSummary;
}): Promise<ReadonlyArray<string>> {
  const { stat: statFn } = await import('node:fs/promises');
  const summaryMtime = (await statFn(input.summary.path)).mtimeMs;
  const changeRoot = `${normalizePath(input.openspecRoot).replace(/\/$/, '')}/changes/${input.changeId}`;
  const candidates = [
    `${changeRoot}/proposal.md`,
    `${changeRoot}/tasks.md`,
    `${changeRoot}/design.md`,
  ];
  // spec files
  const specsRoot = `${changeRoot}/specs`;
  if (await isDirectory(specsRoot)) {
    const { readdir } = await import('node:fs/promises');
    const stack = [specsRoot];
    while (stack.length > 0) {
      const dir = stack.pop() as string;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && entry.name === 'spec.md') {
          candidates.push(full);
        }
      }
    }
  }

  const stale: string[] = [];
  for (const candidate of candidates) {
    try {
      const m = (await statFn(candidate)).mtimeMs;
      if (m > summaryMtime) {
        stale.push(normalizePath(relative(input.projectRoot, candidate)));
      }
    } catch {
      // file does not exist — not stale, just absent
    }
  }
  return stale;
}