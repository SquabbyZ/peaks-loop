import { mkdir, readFile, rename, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isDirectory } from 'peaks-loop-shared/fs';

import { validateChangeId } from './artifact-boundary.js';
import type { OpenSpecScanOptions } from './openspec-scan-service.js';
import {
  findStaleChangeFiles,
  parseCapabilityMapping,
  readC8Summary,
  resolveCoverageSummaryPath,
  validateCapabilityCoverage,
  type CapabilityCoverageMismatch,
  type CapabilityMappingRow,
  type CoverageSummary,
} from './coverage-evidence-reader.js';

export type OpenSpecArchiveOptions = OpenSpecScanOptions & {
  apply?: boolean;
  /**
   * Skip the Pre-cond 2 (Coverage Evidence) gate even when the change declares
   * requirements. Use only when the operator has confirmed the gap is acceptable
   * for this archive operation. Default: false (gate enforced).
   */
  force?: boolean;
  /**
   * Override coverage-summary.json discovery (Fix-6B AC1.1).
   * When omitted, discovery order is:
   *   1. <projectRoot>/coverage/coverage-summary.json
   *   2. <projectRoot>/openspec/coverage-summary.json
   */
  coverageSummaryPath?: string;
  archiveDirName?: string;
};

export type CoverageRequirementRow = {
  /** Spec delta name (e.g. `quality-gates`). */
  capability: string;
  /** Requirement heading under which the row was declared. */
  requirement: string;
  /** One of `covered`, `partial`, `uncovered`. */
  status: 'covered' | 'partial' | 'uncovered';
  /** Optional test anchor — file path or test name. */
  testAnchor?: string;
  /** Source line for diagnostics. */
  line: number;
};

export type CoverageEvidence = {
  /** Rows parsed out of the `## Coverage Evidence` block in proposal.md. */
  rows: ReadonlyArray<CoverageRequirementRow>;
  /** True when a `## Coverage Evidence` block existed in the proposal. */
  present: boolean;
  /** Rows parsed out of the `## Capability Mapping` block in proposal.md. */
  capabilityRows: ReadonlyArray<CapabilityMappingRow>;
  /** Resolved coverage-summary.json absolute path (Fix-6B). */
  summaryPath?: string;
  /** Freshness status of the c8 summary relative to change files. */
  summaryStatus: 'missing' | 'stale' | 'fresh' | 'unavailable';
  /** Per-capability validation outcome. */
  capabilityValidation: 'ok' | 'mismatch' | 'no-mapping' | 'not-enforced';
  /** Files under the change that are newer than the summary (only when stale). */
  staleFiles: ReadonlyArray<string>;
  /** Per-capability failing detail (only when mismatch). */
  mismatches: ReadonlyArray<CapabilityCoverageMismatch>;
};

export type OpenSpecArchiveResult = {
  changeId: string;
  from: string;
  to: string;
  applied: boolean;
  coverage?: CoverageEvidence;
  /** Set when `applied === true` and the gate was bypassed via `--force`. */
  coverageGateBypassed?: boolean;
  /** Set when `applied === true` and the Fix-6B mismatch gate was bypassed via `--force`. */
  coverageMismatchBypassed?: boolean;
};

export class OpenSpecArchiveError extends Error {
  constructor(
    public readonly code:
      | 'OPENSPEC_COVERAGE_GATE_FAILED'
      | 'OPENSPEC_COVERAGE_GATE_PARTIAL'
      | 'OPENSPEC_COVERAGE_EVIDENCE_MALFORMED'
      | 'OPENSPEC_COVERAGE_EVIDENCE_MISSING'
      | 'OPENSPEC_COVERAGE_EVIDENCE_STALE'
      | 'OPENSPEC_COVERAGE_EVIDENCE_MISMATCH',
    message: string,
    public readonly detail: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'OpenSpecArchiveError';
  }
}

function defaultOpenSpecRoot(): string {
  return join(process.cwd(), 'openspec');
}

/**
 * Parse the `## Coverage Evidence` block out of a proposal.md.
 *
 * Accepted shape (markdown table):
 *
 *     ## Coverage Evidence
 *
 *     | capability | requirement | status | testAnchor |
 *     | --- | --- | --- | --- |
 *     | quality-gates | 100% coverage for included modules | covered | tests/unit/quality-gates.test.ts |
 *
 * Returns `{ present: false }` when the heading is missing. Throws
 * `OpenSpecArchiveError` with `code: 'OPENSPEC_COVERAGE_EVIDENCE_MALFORMED'`
 * when the heading is present but no parsable rows are extracted.
 */
export async function parseCoverageEvidence(proposalPath: string): Promise<CoverageEvidence> {
  let raw: string;
  try {
    raw = await readFile(proposalPath, 'utf8');
  } catch {
    return {
      rows: [],
      present: false,
      capabilityRows: [],
      summaryStatus: 'unavailable',
      capabilityValidation: 'not-enforced',
      staleFiles: [],
      mismatches: [],
    };
  }

  const lines = raw.split(/\r?\n/);
  const headingIdx = lines.findIndex((line) => /^##\s+Coverage\s+Evidence\s*$/.test(line));
  if (headingIdx === -1) {
    return {
      rows: [],
      present: false,
      capabilityRows: [],
      summaryStatus: 'unavailable',
      capabilityValidation: 'not-enforced',
      staleFiles: [],
      mismatches: [],
    };
  }

  const rows: CoverageRequirementRow[] = [];
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
    const parsed = parseTableRow(line);
    if (parsed !== null) {
      rows.push({ ...parsed, line: i + 1 });
    }
    i += 1;
  }

  if (rows.length === 0) {
    throw new OpenSpecArchiveError(
      'OPENSPEC_COVERAGE_EVIDENCE_MALFORMED',
      `proposal.md contains a "## Coverage Evidence" heading but no parsable requirement rows`,
      { proposalPath }
    );
  }

  return {
    rows,
    present: true,
    capabilityRows: [],
    summaryStatus: 'unavailable',
    capabilityValidation: 'not-enforced',
    staleFiles: [],
    mismatches: [],
  };
}

function parseTableRow(line: string): Omit<CoverageRequirementRow, 'line'> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());
  if (cells.length < 3) return null;
  const capability = cells[0];
  const requirement = cells[1];
  const statusRaw = cells[2];
  const testAnchor = cells[3];
  if (capability === undefined || requirement === undefined || statusRaw === undefined) return null;
  if (capability.toLowerCase() === 'capability' && requirement.toLowerCase() === 'requirement') return null;
  if (/^-+$/.test(capability.replace(/\s+/g, ''))) return null;
  const status = statusRaw.toLowerCase();
  if (status !== 'covered' && status !== 'partial' && status !== 'uncovered') return null;
  const row: Omit<CoverageRequirementRow, 'line'> = {
    capability,
    requirement,
    status: status,
  };
  if (testAnchor !== undefined && testAnchor !== '') {
    row.testAnchor = testAnchor;
  }
  return row;
}

/**
 * Determine whether the change has any spec files (specs/<capability>/spec.md).
 * When the change has zero spec files, there are no requirements to enforce,
 * and the Pre-cond 2 gate is skipped — backward-compat for legacy spec-less
 * changes (e.g. design-only or doc-only changes).
 */
async function changeHasSpecs(changeRoot: string): Promise<boolean> {
  const specsRoot = join(changeRoot, 'specs');
  if (!(await isDirectory(specsRoot))) return false;
  const entries = await readdir(specsRoot);
  for (const entry of entries) {
    const specPath = join(specsRoot, entry, 'spec.md');
    if (await isDirectory(join(specsRoot, entry))) {
      try {
        await readFile(specPath, 'utf8');
        return true;
      } catch {
        // missing spec.md; keep scanning siblings
      }
    }
  }
  return false;
}

function evaluateGate(
  evidence: CoverageEvidence
): { ok: true } | { ok: false; reason: string; failing: CoverageRequirementRow[] } {
  const failing = evidence.rows.filter((r) => r.status !== 'covered');
  if (failing.length > 0) {
    return {
      ok: false,
      reason: 'requirement-not-fully-covered',
      failing,
    };
  }
  if (evidence.rows.length === 0) {
    return {
      ok: false,
      reason: 'no-coverage-evidence-block',
      failing: [],
    };
  }
  return { ok: true };
}

export async function archiveOpenSpecChange(
  changeId: string,
  options: OpenSpecArchiveOptions = {}
): Promise<OpenSpecArchiveResult | null> {
  const changeIdResult = validateChangeId(changeId);
  if (!changeIdResult.ok) {
    throw new Error(`changeId ${changeId} does not match [A-Za-z0-9][A-Za-z0-9._-]*`);
  }

  const openspecRoot = options.openspecRoot ?? defaultOpenSpecRoot();
  const archiveDir = options.archiveDirName ?? 'archive';
  const from = join(openspecRoot, 'changes', changeId);
  const to = join(openspecRoot, 'changes', archiveDir, changeId);

  if (!(await isDirectory(from))) {
    return null;
  }

  // Pre-cond 2 (Fix-6A + Fix-6B): Coverage Evidence gate.
  // Only enforce when the change declares at least one spec (otherwise there
  // are no requirements to gate on — backward-compat for design-only changes).
  let coverage: CoverageEvidence | undefined;
  let coverageGateBypassed: boolean | undefined;
  let coverageMismatchBypassed: boolean | undefined;

  if (options.apply === true && (await changeHasSpecs(from))) {
    const proposalPath = join(from, 'proposal.md');

    // --- Fix-6A: parse Coverage Evidence block (declarative half) ---
    const evidence = await parseCoverageEvidence(proposalPath);
    coverage = evidence;

    if (!evidence.present) {
      throw new OpenSpecArchiveError(
        'OPENSPEC_COVERAGE_GATE_FAILED',
        `Refusing to archive "${changeId}": proposal.md is missing a "## Coverage Evidence" block. ` +
          'Add a Coverage Evidence table listing every Requirement from specs/*/spec.md with status covered/partial/uncovered, ' +
          'or re-run with --force to bypass the gate.',
        { changeId, reason: 'no-coverage-evidence-block', coverage }
      );
    }
    const verdict = evaluateGate(evidence);
    if (!verdict.ok) {
      if (options.force === true) {
        coverageGateBypassed = true;
      } else {
        throw new OpenSpecArchiveError(
          'OPENSPEC_COVERAGE_GATE_PARTIAL',
          `Refusing to archive "${changeId}": ${verdict.failing.length} requirement(s) not fully covered. ` +
            'Re-run with --force to bypass the gate, or update the Coverage Evidence table to mark each requirement as covered.',
          {
            changeId,
            reason: verdict.reason,
            failing: verdict.failing.map((r) => ({
              capability: r.capability,
              requirement: r.requirement,
              status: r.status,
              testAnchor: r.testAnchor,
              line: r.line,
            })),
            coverage,
          }
        );
      }
    }

    // --- Fix-6B: parse Capability Mapping block + validate against c8 summary ---
    const mapping = await parseCapabilityMapping(proposalPath);
    coverage = {
      ...coverage,
      capabilityRows: mapping.rows,
    };

    if (mapping.rows.length === 0) {
      // No mapping → cannot enforce per-capability. Refuse with the same
      // gate-failed code but a distinct reason in detail (Fix-6B AC3).
      throw new OpenSpecArchiveError(
        'OPENSPEC_COVERAGE_GATE_FAILED',
        `Refusing to archive "${changeId}": proposal.md is missing a "## Capability Mapping" block. ` +
          'Add a Capability Mapping table listing each declared capability alongside its source file or subtree, ' +
          'or re-run with --force to bypass the gate.',
        { changeId, reason: 'no-capability-mapping-block', coverage }
      );
    }

    // Discover coverage-summary.json
    const projectRoot = resolve(openspecRoot, '..');
    const summaryPathResult = await resolveCoverageSummaryPath({
      projectRoot,
      ...(options.coverageSummaryPath !== undefined ? { explicitPath: options.coverageSummaryPath } : {}),
    });
    if (!summaryPathResult.ok) {
      // AC1: missing or not-readable
      const triedPaths = summaryPathResult.error.code === 'missing' ? summaryPathResult.error.triedPaths : [summaryPathResult.error.path];
      throw new OpenSpecArchiveError(
        'OPENSPEC_COVERAGE_EVIDENCE_MISSING',
        `Refusing to archive "${changeId}": no coverage-summary.json found at any of: ${triedPaths.join(', ')}. ` +
          'Run `pnpm test:coverage` (which invokes scripts/coverage-c8.mjs) to generate one, ' +
          'or pass --coverage-summary <path> to point at an existing summary, ' +
          'or re-run with --force to bypass.',
        {
          changeId,
          triedPaths,
          coverage,
        }
      );
    }

    // Parse summary + check freshness (AC2)
    let summary: CoverageSummary;
    try {
      summary = await readC8Summary(summaryPathResult.value);
    } catch (error) {
      throw new OpenSpecArchiveError(
        'OPENSPEC_COVERAGE_EVIDENCE_MISSING',
        `Refusing to archive "${changeId}": coverage-summary.json at ${summaryPathResult.value} is malformed (${(error as Error).message}). ` +
          'Re-run `pnpm test:coverage` to regenerate, or pass --coverage-summary <path> to point at a valid summary.',
        { changeId, path: summaryPathResult.value, coverage }
      );
    }
    coverage = {
      ...coverage,
      summaryPath: summary.path,
    };

    const staleFiles = await findStaleChangeFiles({
      projectRoot,
      openspecRoot,
      changeId,
      summary,
    });
    if (staleFiles.length > 0) {
      coverage = {
        ...coverage,
        summaryStatus: 'stale',
        staleFiles,
      };
      throw new OpenSpecArchiveError(
        'OPENSPEC_COVERAGE_EVIDENCE_STALE',
        `Refusing to archive "${changeId}": coverage-summary.json is older than ${staleFiles.length} change file(s). ` +
          'Re-run `pnpm test:coverage` to refresh, or re-run with --force to bypass.',
        { changeId, staleFiles, summaryPath: summary.path, coverage }
      );
    }
    coverage = {
      ...coverage,
      summaryStatus: 'fresh',
    };

    // Per-capability coverage check (AC4)
    const validation = await validateCapabilityCoverage({
      projectRoot,
      summary,
      rows: mapping.rows,
    });
    if (!validation.ok) {
      coverage = {
        ...coverage,
        capabilityValidation: 'mismatch',
        mismatches: validation.mismatches,
      };
      if (options.force === true) {
        coverageMismatchBypassed = true;
      } else {
        throw new OpenSpecArchiveError(
          'OPENSPEC_COVERAGE_EVIDENCE_MISMATCH',
          `Refusing to archive "${changeId}": ${validation.mismatches.length} capability row(s) claim "covered" in proposal.md but c8 reports < 100% coverage. ` +
            'Re-run `pnpm test:coverage` after closing the gap, or re-run with --force to bypass.',
          {
            changeId,
            mismatches: validation.mismatches,
            coverage,
          }
        );
      }
    } else {
      coverage = {
        ...coverage,
        capabilityValidation: 'ok',
      };
    }
  } else if (options.apply === true) {
    // Spec-less change — surface coverage evidence for visibility, never fail.
    const proposalPath = join(from, 'proposal.md');
    coverage = await parseCoverageEvidence(proposalPath);
  }

  if (options.apply !== true) {
    return {
      changeId,
      from,
      to,
      applied: false,
      ...(coverage !== undefined ? { coverage } : {}),
    };
  }

  if (await isDirectory(to)) {
    throw new Error(`Refusing to archive: target already exists at ${to}`);
  }

  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);

  return {
    changeId,
    from,
    to,
    applied: true,
    ...(coverage !== undefined ? { coverage } : {}),
    ...(coverageGateBypassed === true ? { coverageGateBypassed: true } : {}),
    ...(coverageMismatchBypassed === true ? { coverageMismatchBypassed: true } : {}),
  };
}