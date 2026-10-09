// Shared plumbing for the `peaks scan` subcommands, extracted from
// scan-commands.ts so that no single file (or function) has to carry ten
// subcommands at once. Everything here is parameter-in / value-out: the option
// shapes each runner receives, the parsers the command definitions hand to
// Commander as option-processing callbacks, and the two output shapes the
// report commands share (the format-aware envelope / markdown / raw-JSON
// writer and its "Next actions:" tail).
//
// Dependency direction is one-way: this module never imports scan-commands.ts.

import { InvalidArgumentError } from 'commander';

import { ok } from 'peaks-loop-shared/result';

import {
  isRequestType,
  VALID_REQUEST_TYPES,
  type RequestType
} from '../../services/artifacts/artifact-prerequisites.js';
import { printResult, type ProgramIO } from '../cli-helpers.js';

export type ArchetypeOptions = {
  project: string;
  json?: boolean;
};

export type ExistingSystemOptions = {
  project: string;
  maxTokens?: string;
  maxSamples?: string;
  json?: boolean;
};

export type RequestTypeSanityOptions = {
  project: string;
  type: RequestType;
  baseRef?: string;
  json?: boolean;
};

export type FileSizeScanOptions = {
  project: string;
  baseRef?: string;
  threshold?: string;
  json?: boolean;
};

export type ScanLibrariesOptions = {
  project: string;
  json?: boolean;
};

export type AcceptanceCoverageOptions = {
  rid: string;
  project: string;
  sessionId?: string;
  json?: boolean;
};

export type DiffVsScopeOptions = {
  rid: string;
  project: string;
  sessionId?: string;
  baseRef?: string;
  json?: boolean;
};

/** `--format` accepts exactly these two values across the report subcommands. */
export type ScanOutputFormat = 'md' | 'json';

export type ApiSurfaceOptions = {
  project: string;
  format?: ScanOutputFormat;
  includeDirs?: string;
  maxPerKind?: number;
  json?: boolean;
};

export type OrphanScope = 'working-tree' | 'git-diff' | 'all';

export type OrphanOptions = {
  project: string;
  format?: ScanOutputFormat;
  scope?: OrphanScope;
  strict?: boolean;
  json?: boolean;
};

export type KarpathyScope = 'working-tree' | 'all';

export type KarpathyOptions = {
  project: string;
  format?: ScanOutputFormat;
  scope?: KarpathyScope;
  json?: boolean;
};

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseOptionalNonNegativeInt(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

export function parseRequestType(value: string): RequestType {
  if (!isRequestType(value)) {
    throw new InvalidArgumentError(`must be one of ${VALID_REQUEST_TYPES.join(', ')}`);
  }
  return value;
}

export function parseScanOutputFormat(value: string): ScanOutputFormat {
  if (value !== 'md' && value !== 'json') {
    throw new InvalidArgumentError('must be md or json');
  }
  return value;
}

export function parseNonNegativeIntOption(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('must be a non-negative integer');
  }
  return Number(value);
}

export function parseOrphanScope(value: string): OrphanScope {
  if (value !== 'working-tree' && value !== 'git-diff' && value !== 'all') {
    throw new InvalidArgumentError('must be working-tree, git-diff, or all');
  }
  return value;
}

export function parseKarpathyScope(value: string): KarpathyScope {
  if (value !== 'working-tree' && value !== 'all') {
    throw new InvalidArgumentError('must be working-tree or all');
  }
  return value;
}

/**
 * Everything `emitScanReport` needs. `renderMarkdown` is a thunk because the
 * original callbacks built the markdown at this exact point in the flow — after
 * the `--format json` branches have returned — and it must stay lazy so a
 * `--format json` run never renders markdown it would throw away.
 */
export type ScanReportOutput = {
  command: string;
  // Both are spelled `| undefined` because this repo compiles with
  // `exactOptionalPropertyTypes: true`: the callers forward their own optional
  // `--format` / `--json` values, which always have `undefined` in their type.
  format?: ScanOutputFormat | undefined;
  json?: boolean | undefined;
  report: unknown;
  nextActions: string[];
  renderMarkdown: () => string;
};

/**
 * The output contract shared by `scan api-surface`, `scan orphan` and
 * `scan karpathy`:
 *   - `--format json` without `--json` writes the bare report (no envelope);
 *   - `--format json` with `--json` writes the ok/data/code envelope;
 *   - otherwise markdown goes to stdout, and `--json` wraps it as
 *     `{ markdown, report }` while the human path prints "Next actions:" to
 *     stderr only when there is at least one.
 */
export function emitScanReport(io: ProgramIO, output: ScanReportOutput): void {
  if (output.format === 'json' && !output.json) {
    // Raw JSON without the ok/data/code envelope.
    process.stdout.write(JSON.stringify(output.report, null, 2) + '\n');
    return;
  }
  if (output.format === 'json') {
    printResult(io, ok(output.command, output.report, [], output.nextActions), output.json);
    return;
  }
  const md = output.renderMarkdown();
  if (output.json) {
    printResult(
      io,
      ok(output.command, { markdown: md, report: output.report }, [], output.nextActions),
      output.json
    );
    return;
  }
  process.stdout.write(md + '\n');
  if (output.nextActions.length > 0) {
    process.stderr.write(
      '\nNext actions:\n' + output.nextActions.map((a) => '  - ' + a).join('\n') + '\n'
    );
  }
}
