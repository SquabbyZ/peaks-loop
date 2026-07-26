import { mkdir, readFile, rename, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDirectory } from 'peaks-loop-shared/fs';

import { validateChangeId } from './artifact-boundary.js';
import type { OpenSpecScanOptions } from './openspec-scan-service.js';

export type OpenSpecArchiveOptions = OpenSpecScanOptions & {
  apply?: boolean;
  /**
   * Skip the Pre-cond 2 (Coverage Evidence) gate even when the change declares
   * requirements. Use only when the operator has confirmed the gap is acceptable
   * for this archive operation. Default: false (gate enforced).
   */
  force?: boolean;
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
};

export type OpenSpecArchiveResult = {
  changeId: string;
  from: string;
  to: string;
  applied: boolean;
  coverage?: CoverageEvidence;
  /** Set when `applied === true` and the gate was bypassed via `--force`. */
  coverageGateBypassed?: boolean;
};

export class OpenSpecArchiveError extends Error {
  constructor(
    public readonly code:
      | 'OPENSPEC_COVERAGE_GATE_FAILED'
      | 'OPENSPEC_COVERAGE_GATE_PARTIAL'
      | 'OPENSPEC_COVERAGE_EVIDENCE_MALFORMED',
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
 * Accepted shape (markdown table or fenced code block):
 *
 *     ## Coverage Evidence
 *
 *     | capability | requirement | status | testAnchor |
 *     | --- | --- | --- | --- |
 *     | quality-gates | 100% coverage for included modules | covered | tests/unit/quality-gates.test.ts |
 *
 *     | artifact-workspace | MVP implementation verification commands | covered | tests/unit/openspec-archive-service.test.ts |
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
    return { rows: [], present: false };
  }

  const lines = raw.split(/\r?\n/);
  const headingIdx = lines.findIndex((line) => /^##\s+Coverage\s+Evidence\s*$/.test(line));
  if (headingIdx === -1) {
    return { rows: [], present: false };
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

  return { rows, present: true };
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
  // Skip header (| capability | requirement | status | ...) and separator (| --- | --- |)
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
  changeId: string,
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

  // Pre-cond 2: Coverage Evidence gate.
  // Only enforce when the change declares at least one spec (otherwise there
  // are no requirements to gate on — backward-compat for design-only changes).
  let coverage: CoverageEvidence | undefined;
  let coverageGateBypassed: boolean | undefined;
  if (options.apply === true && (await changeHasSpecs(from))) {
    const proposalPath = join(from, 'proposal.md');
    coverage = await parseCoverageEvidence(proposalPath);
    if (!coverage.present) {
      throw new OpenSpecArchiveError(
        'OPENSPEC_COVERAGE_GATE_FAILED',
        `Refusing to archive "${changeId}": proposal.md is missing a "## Coverage Evidence" block. ` +
          'Add a Coverage Evidence table listing every Requirement from specs/*/spec.md with status covered/partial/uncovered, ' +
          'or re-run with --force to bypass the gate.',
        { changeId, reason: 'no-coverage-evidence-block', coverage }
      );
    }
    const verdict = evaluateGate(changeId, coverage);
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
  } else if (options.apply === true) {
    // Spec-less change — try to surface evidence for visibility, but never fail.
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
  };
}