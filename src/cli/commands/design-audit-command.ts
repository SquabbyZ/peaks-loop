/**
 * `peaks design audit` — the advisory S7 audit command.
 *
 * Exit contract: findings NEVER change the exit code (this slice is advisory),
 * both audited outcomes and `not-a-ui-project` exit 0, and a UI source set with
 * no design contract exits 2 with the named reason `DESIGN_AUDIT_CONTRACT_MISSING`;
 * a contract file past the byte cap exits 2 with
 * `DESIGN_AUDIT_CONTRACT_TOO_LARGE`. An unexpected read/write failure exits 1.
 *
 * `--json` prints the stable envelope documented in `audit-report.ts` and writes
 * nothing. Without it the pair `design/audit[-<rid>].md` + `.json` is written
 * under the app root and the envelope is printed as text.
 */

import { resolve } from 'node:path';

import type { Command } from 'commander';

import { fail, ok } from 'peaks-loop-shared/result';

import { repoRelativeKey } from '../../shared/path-utils.js';
import { MAX_SOURCE_BYTES } from '../../services/design/file-cap.js';
import {
  runAuditProject,
  type AuditProjectResult
} from '../../services/design/audit/audit-project.js';
import {
  MAX_RENDER_FRAMES,
  readRenderDir,
  type RenderDirRead
} from '../../services/design/audit/render/render-captures.js';
import {
  buildAuditReport,
  writeAuditReport,
  type AuditReport
} from '../../services/design/audit/audit-report.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

export type DesignAuditCliOptions = {
  project: string;
  rid?: string;
  json?: boolean;
  /** The probe capture directory (`<probe-slug>/screenshots/full-page.png`). */
  render?: string;
};

const CONTRACT_MISSING_CODE = 'DESIGN_AUDIT_CONTRACT_MISSING';
const CONTRACT_MISSING_ACTIONS = [
  'Create the design contract for this app root first; the audit will not judge a project against a scale it never declared.'
];
const CONTRACT_TOO_LARGE_CODE = 'DESIGN_AUDIT_CONTRACT_TOO_LARGE';
const CONTRACT_TOO_LARGE_ACTIONS = [
  'Check the contract file for a corrupted or generated blob; the audit reads only a declared contract.'
];

function nextActionsFor(report: AuditReport): string[] {
  if (report.data.verdict === 'not-a-ui-project') {
    return ['No UI source and no design contract were found; nothing was scored.'];
  }
  if (report.data.verdict === 'findings') {
    return ['Fix the three listed findings, then run the audit again.'];
  }
  return [];
}

type AuditFailure = {
  code: string;
  message: string;
  data: Record<string, unknown>;
  exitCode: number;
  actions?: string[];
};

function failWith(io: ProgramIO, json: boolean | undefined, failure: AuditFailure): void {
  printResult(
    io,
    fail('design.audit', failure.code, failure.message, failure.data, failure.actions ?? []),
    json === true
  );
  process.exitCode = failure.exitCode;
}

async function writeAndDescribe(
  io: ProgramIO,
  options: DesignAuditCliOptions,
  appRoot: string,
  report: AuditReport
): Promise<string[] | null> {
  try {
    const written = await writeAuditReport({
      appRoot,
      report,
      ...(options.rid === undefined || options.rid.trim() === '' ? {} : { rid: options.rid })
    });
    const path = repoRelativeKey(written.markdownPath, appRoot);
    return [`The audit report pair was written as ${path} and its .json sibling.`];
  } catch (error) {
    failWith(io, options.json, {
      code: 'DESIGN_AUDIT_WRITE_FAILED',
      message: getErrorMessage(error),
      data: { appRoot },
      exitCode: 1,
      actions: ['Fix the design directory permissions, then run the audit again.']
    });
    return null;
  }
}

/** How many skipped-capture names one gap line cites. */
const GAP_WITNESSES = 3;

/** The `--render` read's truncation/skip note, or undefined when it was clean. */
function renderGapOf(read: Extract<RenderDirRead, { ok: true }>): string | undefined {
  const parts: string[] = [];
  if (read.truncated) {
    parts.push(
      `capture read stopped at the ${MAX_RENDER_FRAMES}-frame bound (${read.found} found)`
    );
  }
  if (read.skipped.length > 0) {
    parts.push(
      `${read.skipped.length} capture(s) skipped: ${read.skipped.slice(0, GAP_WITNESSES).join('; ')}`
    );
  }
  return parts.length === 0 ? undefined : parts.join('; ');
}

/** Read `--render`, refusing with a named code before any audit runs. */
function readEvidence(
  options: DesignAuditCliOptions,
  appRoot: string,
  io: ProgramIO
): Extract<RenderDirRead, { ok: true }> | null {
  if (options.render === undefined) return null;
  const read = readRenderDir({ dir: options.render, appRoot });
  if (read.ok) return read;
  failWith(io, options.json, {
    code: read.code,
    message: read.message,
    data: { appRoot, render: options.render },
    exitCode: 2,
    actions: [
      'Point --render at the probe capture directory, or an absolute directory you trust; a link that escapes it is refused.'
    ]
  });
  return null;
}

/** Read the project, turning an unexpected throw into the named failure. */
function projectFor(
  options: DesignAuditCliOptions,
  appRoot: string,
  evidence: Extract<RenderDirRead, { ok: true }> | null,
  io: ProgramIO
): AuditProjectResult | null {
  try {
    const gap = evidence === null ? undefined : renderGapOf(evidence);
    return runAuditProject({
      appRoot,
      ...(evidence === null ? {} : { render: evidence.captures }),
      ...(gap === undefined ? {} : { renderGap: gap })
    });
  } catch (error) {
    failWith(io, options.json, {
      code: 'DESIGN_AUDIT_FAILED',
      message: getErrorMessage(error),
      data: { appRoot },
      exitCode: 1
    });
    return null;
  }
}

/** The two pre-audit refusals, as a boolean "already handled". */
function refusedOutcome(
  result: AuditProjectResult,
  appRoot: string,
  options: DesignAuditCliOptions,
  io: ProgramIO
): boolean {
  if (result.kind === 'contract-missing') {
    failWith(io, options.json, {
      code: CONTRACT_MISSING_CODE,
      message: `The design contract is missing (${result.missing.join(', ')}) under design/.`,
      data: { appRoot, missing: result.missing },
      exitCode: 2,
      actions: CONTRACT_MISSING_ACTIONS
    });
    return true;
  }
  if (result.kind === 'contract-too-large') {
    const named = result.files.map((file) => `${file.path}: ${file.bytes} bytes`).join(', ');
    failWith(io, options.json, {
      code: CONTRACT_TOO_LARGE_CODE,
      message: `The design contract is larger than the ${MAX_SOURCE_BYTES}-byte cap (${named}); a contract that large is not one this audit can trust.`,
      data: { appRoot, files: result.files },
      exitCode: 2,
      actions: CONTRACT_TOO_LARGE_ACTIONS
    });
    return true;
  }
  return false;
}

export async function runDesignAudit(options: DesignAuditCliOptions, io: ProgramIO): Promise<void> {
  const appRoot = resolve(options.project);
  const evidence = readEvidence(options, appRoot, io);
  if (options.render !== undefined && evidence === null) return;
  const result = projectFor(options, appRoot, evidence, io);
  if (result === null || refusedOutcome(result, appRoot, options, io)) return;
  const report = buildAuditReport(result);
  const warnings = result.kind === 'audited' ? result.warnings : [];
  const written = options.json === true ? [] : await writeAndDescribe(io, options, appRoot, report);
  if (written === null) return;
  printResult(
    io,
    ok('design.audit', report.data, warnings, [...nextActionsFor(report), ...written]),
    options.json === true
  );
  process.exitCode = 0;
}

export function registerDesignAuditCommand(design: Command, io: ProgramIO): void {
  addJsonOption(
    design
      .command('audit')
      .description('Score the design dimensions from source and the contract (advisory)')
      .requiredOption('--project <path>', 'app root')
      .option('--rid <rid>', 'request id used in design/audit-<rid>.md')
      .option(
        '--render <dir>',
        'probe capture directory (<probe-slug>/screenshots/full-page.png); enables the rendered palette and contrast'
      )
  ).action((options: DesignAuditCliOptions) => runDesignAudit(options, io));
}
