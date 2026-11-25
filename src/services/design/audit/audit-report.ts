/**
 * Report rendering for `peaks design audit` (S7 Task 4, scoped by Task 6a).
 *
 * Two shapes, deliberately different:
 *
 *   THE CLI ENVELOPE (`--json`) — stable and small. It is exactly
 *   `{ ok, command, data: { contract, scope, state, pages, overall, dimensions,
 *   topFixes, unmeasured, verdict } }` on the standard `ok()` envelope
 *   (`warnings` / `nextActions` are the envelope's, not `data`'s). Per-page
 *   findings are not repeated there; `--json` writes no file.
 *
 *   THE WRITTEN PAIR — `design/audit-<rid>.md` and `.json` (no `-<rid>` when
 *   `--rid` is omitted). The JSON document adds `schemaVersion`, the scope, the
 *   dimension table and each page's findings, because it is the durable record.
 *
 * `not-a-ui-project` writes no score at all: `overall` and every page score are
 * absent, so the verdict can never be read as 0 or as a pass.
 *
 * The markdown and JSON renderers live in `audit-report-markdown.ts` to keep
 * this module to the read → score → write path.
 */

import { lstatSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isInsidePath, stableRealPath } from '../../../shared/path-utils.js';
import { isSinglePathSegment } from '../../session/getSessionDir.js';
import type { AuditFinding } from './audit-finding.js';
import type { AuditContractRef, AuditProjectResult, AuditRuntimeState } from './audit-project.js';
import { notUiScope, type AuditScope } from './audit-scope.js';
import { topFixes, unmeasuredItems, type TopFix, type UnmeasuredItem } from './audit-fixes.js';
import { scoreAudit } from './audit-score-table.js';
import type { DimensionScore } from './audit-scoring.js';
import { renderAuditJson, renderAuditMarkdown } from './audit-report-markdown.js';

export { renderAuditJson, renderAuditMarkdown } from './audit-report-markdown.js';
export type { AuditJsonDocument } from './audit-report-markdown.js';

/** `clean` = no hard/soft finding; unmeasured gaps never masquerade as a pass. */
export type AuditVerdict = 'clean' | 'findings' | 'not-a-ui-project';

/**
 * A gap every report carries because the audit CANNOT judge it from source
 * (review K5). Responsive overflow is the product-level acceptance item (AC7);
 * omitting it read as "nothing to fix", which is a lie about the product's
 * coverage. It is a fixed row, so no detector can drop it.
 *
 * `reason` says WHY the gap exists when the default ("no source-readable
 * signal") is not the whole story; the renderers print it after the text. It is
 * optional, so a gap that omits it keeps the original line unchanged.
 */
export type KnownGap = { id: string; text: string; reason?: string };

/** The fixed known gaps; the markdown and JSON both render every entry. */
export const KNOWN_GAPS: readonly KnownGap[] = [
  { id: 'responsive-overflow', text: 'responsive overflow — needs the rendered page (S8)' },
  {
    // The tsconfig cap is NOT a contract refusal (see `path-aliases.ts`): the
    // audit continues with no alias table rather than exiting 2. Declared here
    // so the divergence is visible in the report instead of silent.
    id: 'alias-config-oversize',
    text: 'an over-cap tsconfig declares no alias table, so aliased imports are not followed (the unread config is named in the runtime state)',
    reason: 'path aliases are an optional hint, not the design contract, so the audit still runs'
  }
];

/** One page as the envelope reports it. */
export type AuditPageReport = {
  path: string;
  score: number;
  dimensions: DimensionScore[];
  /** Present only when the page's import closure was truncated (Task 6e). */
  truncated?: boolean;
};

/** THE stable `--json` `data` shape; see the module header. */
export type AuditReportData = {
  contract: AuditContractRef | null;
  scope: AuditScope;
  state: AuditRuntimeState;
  pages: AuditPageReport[];
  /** Worst unit score, or null for a non-UI verdict. */
  overall: number | null;
  dimensions: DimensionScore[];
  topFixes: TopFix[];
  unmeasured: UnmeasuredItem[];
  /** The fixed gaps the audit cannot judge from source (review K5). */
  knownGaps: KnownGap[];
  verdict: AuditVerdict;
};

/** The renderer's working set: the envelope data plus what only files carry. */
export type AuditReport = {
  data: AuditReportData;
  overall: number | null;
  dimensions: DimensionScore[];
  pages: Array<AuditPageReport & { findings: AuditFinding[] }>;
};

export type AuditReportMeta = {
  appRoot: string;
  rid?: string;
  generatedAt: string;
};

const NO_STATE: AuditRuntimeState = { scored: [], skipped: [], readGaps: [], truncated: false };

function notUiReport(): AuditReport {
  return {
    data: {
      contract: null,
      scope: notUiScope(),
      state: { ...NO_STATE },
      pages: [],
      overall: null,
      dimensions: [],
      topFixes: [],
      unmeasured: [],
      knownGaps: [...KNOWN_GAPS],
      verdict: 'not-a-ui-project'
    },
    overall: null,
    dimensions: [],
    pages: []
  };
}

/** Turn a project read into scores + the envelope + per-page findings. */
export function buildAuditReport(result: AuditProjectResult): AuditReport {
  if (result.kind === 'not-a-ui-project') return notUiReport();
  if (result.kind === 'contract-missing') {
    throw new Error(
      `the audit cannot report a missing contract (${result.missing.join(', ')}); refuse before rendering`
    );
  }
  if (result.kind === 'contract-too-large') {
    const files = result.files.map((file) => `${file.path}: ${file.bytes} bytes`).join(', ');
    throw new Error(
      `the audit cannot report an over-cap contract (${files}); refuse before rendering`
    );
  }
  const findings = [...result.pages.flatMap((page) => page.findings), ...result.globalFindings];
  // Contrast is judged by the CONTRACT, so a passing pair set leaves no page
  // finding to prove it ran; the declared pairs are that proof (review K1).
  const contractJudged = { contrast: result.contractSource.pairs.length > 0 };
  const score = scoreAudit(result.pages, result.globalFindings, contractJudged);
  const findingsByPath = new Map(result.pages.map((page) => [page.path, page.findings]));
  const pages = score.pages.map((page) => ({
    ...page,
    findings: findingsByPath.get(page.path) ?? []
  }));
  return {
    data: {
      contract: result.contract,
      scope: result.scope,
      state: result.state,
      pages: score.pages,
      overall: score.overall,
      dimensions: score.dimensions,
      topFixes: topFixes(findings),
      unmeasured: unmeasuredItems(findings),
      knownGaps: [...KNOWN_GAPS],
      verdict: findings.some((finding) => finding.severity !== 'unmeasured') ? 'findings' : 'clean'
    },
    overall: score.overall,
    dimensions: score.dimensions,
    pages
  };
}

/** A `--rid` that is not one path segment is refused before any directory exists. */
export class DesignAuditPathError extends Error {
  readonly code = 'DESIGN_AUDIT_PATH_INVALID';

  constructor(value: string) {
    super(`The audit report rid must be a single path segment: ${value}`);
    this.name = 'DesignAuditPathError';
  }
}

/**
 * A `design/` directory or report target that resolves outside the app root is
 * refused before it is written (S7 security review): a junctioned `design/`
 * wrote both files outside the app root, so the write path now resolves every
 * link first and names the escape instead of following it.
 */
export class DesignAuditWriteEscapeError extends Error {
  readonly code = 'DESIGN_AUDIT_WRITE_ESCAPE';

  constructor(target: string, appRoot: string) {
    super(`The audit report target resolves outside the app root: ${target} (app root ${appRoot})`);
    this.name = 'DesignAuditWriteEscapeError';
  }
}

/**
 * Resolve an existing `target` and refuse it when it leaves the already-resolved
 * `root`. A target that does not exist is inside by construction (its parent is
 * resolved); one that exists is resolved first, and an unresolvable (dangling)
 * link is refused rather than written through.
 */
function resolveInside(root: string, target: string, appRoot: string): string {
  if (lstatSync(target, { throwIfNoEntry: false }) === undefined) return target;
  let resolved: string;
  try {
    resolved = stableRealPath(target);
  } catch {
    throw new DesignAuditWriteEscapeError(target, appRoot);
  }
  if (!isInsidePath(resolved, root)) throw new DesignAuditWriteEscapeError(target, appRoot);
  return resolved;
}

export type WrittenAuditReport = { markdownPath: string; jsonPath: string };

export type WriteAuditReportInput = {
  appRoot: string;
  report: AuditReport;
  rid?: string;
  now?: () => Date;
};

/**
 * Write the pair under `<appRoot>/design/`. JSON first, markdown last: a
 * failure at either write never leaves a readable half-report behind.
 */
export async function writeAuditReport(input: WriteAuditReportInput): Promise<WrittenAuditReport> {
  const rid = (input.rid ?? '').trim();
  if (rid !== '' && !isSinglePathSegment(rid)) throw new DesignAuditPathError(rid);
  const suffix = rid === '' ? '' : `-${rid}`;
  const designDir = join(input.appRoot, 'design');
  await mkdir(designDir, { recursive: true });
  // Resolve the directory AND each target before writing: a junctioned or
  // symlinked `design/` wrote both reports outside the app root.
  const appRootReal = stableRealPath(input.appRoot);
  const designReal = resolveInside(appRootReal, designDir, input.appRoot);
  const markdownPath = resolveInside(
    designReal,
    join(designReal, `audit${suffix}.md`),
    input.appRoot
  );
  const jsonPath = resolveInside(
    designReal,
    join(designReal, `audit${suffix}.json`),
    input.appRoot
  );
  const meta: AuditReportMeta = {
    appRoot: input.appRoot,
    ...(rid === '' ? {} : { rid }),
    generatedAt: (input.now?.() ?? new Date()).toISOString()
  };
  const written: string[] = [];
  try {
    await writeFile(
      jsonPath,
      `${JSON.stringify(renderAuditJson(input.report, meta), null, 2)}\n`,
      'utf8'
    );
    written.push(jsonPath);
    await writeFile(markdownPath, renderAuditMarkdown(input.report, meta), 'utf8');
    written.push(markdownPath);
  } catch (error) {
    await Promise.allSettled(written.map((path) => rm(path, { force: true })));
    throw error;
  }
  return { markdownPath, jsonPath };
}
