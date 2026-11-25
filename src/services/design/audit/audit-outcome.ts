/**
 * Folding a completed page read into the `audited` result (S8 close-out, cap
 * split from `audit-project.ts`).
 *
 * The project reader owns "which units exist"; this module owns the single
 * `audited` outcome: the scope note, the contract paths, the contract-level
 * render findings, the truncated flag and the render-evidence summary. It also
 * owns the unmatched-capture read gap, because that is the one place both the
 * page set and the capture set are in hand.
 */

import { join, relative } from 'node:path';

import { normalizePath } from '../../../shared/path-utils.js';
import { buildAuditScope } from './audit-scope.js';
import type { AuditPage, AuditRuntimeState } from './audit-pages.js';
import type { AuditProjectResult, ContractRead } from './audit-project.js';
import { collectRenderFindings, renderUsage, type RenderFrame } from './render/render-audit.js';

/** How many unmatched capture names one read-gap line cites. */
const UNMATCHED_CAPTURE_NAMES = 3;

/** Everything the post-page read needs. */
export type AuditedInput = {
  appRoot: string;
  designRoot: string;
  read: ContractRead;
  frames: readonly RenderFrame[];
  state: AuditRuntimeState;
  pages: AuditPage[];
  context: Set<string>;
  valueFiles: Set<string>;
  /** The capture label the overflow/contrast gap rows cite, when one was supplied. */
  probeFile?: string;
  renderGap?: string;
};

/** The read gap naming captures that bound to no page (close-out M5). */
export function unmatchedCaptureGap(
  pages: readonly AuditPage[],
  frames: readonly RenderFrame[]
): string | null {
  const bound = new Set(
    pages.flatMap((page) => (page.capture === undefined ? [] : [page.capture]))
  );
  const unused = frames.filter((frame) => !bound.has(frame.capture));
  if (unused.length === 0) return null;
  const names = unused.slice(0, UNMATCHED_CAPTURE_NAMES).map((frame) => frame.capture);
  return `${unused.length} capture(s) matched no page: ${names.join(', ')}`;
}

/** Fold the read pages into the `audited` result (scope, findings, render summary). */
export function auditedOutcome(input: AuditedInput): AuditProjectResult {
  const { appRoot, designRoot, read, frames, state, pages, context, valueFiles } = input;
  const boundBy = new Map<string, string>();
  for (const page of pages) if (page.capture !== undefined) boundBy.set(page.capture, page.path);
  const scope = buildAuditScope({
    declaredRoots: read.paved.pageRoots,
    scoredPages: pages.length,
    contextFiles: context,
    scoredPaths: new Set(pages.map((page) => page.path)),
    valueFiles
  });
  const rel = (file: string): string => normalizePath(relative(appRoot, join(designRoot, file)));
  const contract = { tokens: rel('tokens.json'), pavedRoad: rel('paved-road.json') };
  const global = collectRenderFindings({
    contract: read.contract,
    frames,
    tokensFile: contract.tokens,
    probeFile: input.probeFile ?? 'design/probe'
  });
  const truncated = state.truncated || pages.some((page) => page.truncated);
  return {
    kind: 'audited',
    appRoot,
    designRoot,
    contract,
    contractSource: read.contract,
    state: { ...state, truncated },
    scope,
    warnings: (read.paved.warnings ?? []).map((warning) => warning.message),
    pages,
    globalFindings: global.findings,
    contractJudged: global.contractJudged,
    render: { captures: renderUsage(frames, boundBy), gap: input.renderGap ?? null }
  };
}
