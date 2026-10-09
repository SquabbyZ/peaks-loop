/**
 * Shared helpers for the `peaks evolution *` subcommand modules
 * (propose / evaluate / mark-keep / revert / status). Split out of
 * `evolution-commands.ts` in the size-debt batch: every command name,
 * option, envelope key, error code and exit-code site is unchanged.
 *
 * Nothing here holds module-level mutable state: each helper takes
 * parameters and returns a value, and the DB helpers own the
 * open/close pair so callers never see a half-closed handle.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  EvolutionService,
  type EvolutionIntegrityError
} from '../../services/evolution/evolution-service.js';
import {
  EVOLUTION_TARGET_KINDS,
  type EvolutionTargetKind
} from '../../services/evolution/evolution-types.js';
import { openStateDb } from '../../services/skillhub/sqlite-store.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, type ResultEnvelope } from 'peaks-loop-shared/result';

/** A parsed `--target <kind:id>` flag. */
export interface EvolutionTarget {
  kind: EvolutionTargetKind;
  id: string;
}

/**
 * Parse `--target <kind:id>`. Returns the kind + id, or `null` on
 * failure. Validates `kind` against the EVOLUTION_TARGET_KINDS
 * union.
 */
export function parseTargetFlag(raw: string): EvolutionTarget | null {
  const idx = raw.indexOf(':');
  if (idx <= 0 || idx === raw.length - 1) return null;
  const kind = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (!(EVOLUTION_TARGET_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as EvolutionTargetKind, id };
}

/** The shared `--target` parse failure envelope (`propose` + `status`). */
export function invalidTargetFailure(
  command: string,
  target: string
): ResultEnvelope<{ target: string }> {
  return fail(
    command,
    'EVOLUTION_INVALID_TARGET',
    `--target must be '<kind>:<id>' where kind ∈ {${EVOLUTION_TARGET_KINDS.join(',')}}`,
    { target },
    ['Pass --target loop:<loop-id> or --target bee:<bee-id>.']
  );
}

/** The shared "no such proposal" failure envelope. */
export function proposalNotFoundFailure(
  command: string,
  proposalId: string,
  nextActions: string[]
): ResultEnvelope<{ proposalId: string }> {
  return fail(
    command,
    'EVOLUTION_PROPOSAL_NOT_FOUND',
    `proposal '${proposalId}' not found`,
    { proposalId },
    nextActions
  );
}

/**
 * Helper: collect repeatable `--risk-tag` values into an array.
 * Commander's `collect` is not always available; we read
 * `previous` from the default value.
 */
export function collectRepeatable(value: string, previous: string[]): string[] {
  if (Array.isArray(previous)) return [...previous, value];
  return [value];
}

/** Upper bound of the 0..10 score scale used by proposal + evaluator scores. */
export const SCORE_SCALE_MAX = 10;

/** True when `value` is a finite number on the 0..10 score scale. */
export function isScoreInRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= SCORE_SCALE_MAX;
}

/** Inputs for {@link scoreRangeFailure}. */
export interface ScoreRangeFailureArgs {
  command: string;
  code: string;
  /** Message label, e.g. `before_score`. */
  label: string;
  /** CLI flag named in the hint, e.g. `--before-score`. */
  flag: string;
  /** `data` key carrying the raw value, e.g. `beforeScore`. */
  key: string;
  /** The raw, unparsed flag value. */
  raw: string;
}

/** The shared "[0, 10] finite number" validation failure envelope. */
export function scoreRangeFailure(
  args: ScoreRangeFailureArgs
): ResultEnvelope<Record<string, string>> {
  return fail(
    args.command,
    args.code,
    `${args.label} must be a finite number in [0, 10] (got "${args.raw}")`,
    { [args.key]: args.raw },
    [`Pass a numeric ${args.flag} in [0, 10].`]
  );
}

/** The `--delta-min` validation failure envelope. */
export function deltaMinFailure(
  command: string,
  raw: string
): ResultEnvelope<Record<string, string>> {
  return fail(
    command,
    'EVOLUTION_INVALID_DELTA_MIN',
    `delta_min must be a finite number >= 0 (got "${raw}")`,
    { deltaMin: raw },
    ['Pass a numeric --delta-min >= 0 (default 1.0).']
  );
}

/**
 * Resolve the project root, bootstrap an empty `.peaks/` dir when it
 * is missing (so tests do not need a full peaks project) and open the
 * state DB.
 */
function openEvolutionDb(project: string | undefined): ReturnType<typeof openStateDb> {
  const projectRoot = project ?? findProjectRoot(process.cwd()) ?? process.cwd();
  if (!existsSync(join(projectRoot, '.peaks'))) {
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
  }
  return openStateDb(join(projectRoot, '.peaks', 'state.db'));
}

/** Run `body` against a fresh EvolutionService, closing the DB after. */
export function withEvolutionDb<T>(
  project: string | undefined,
  body: (svc: EvolutionService) => T
): T {
  const db = openEvolutionDb(project);
  try {
    return body(new EvolutionService(db));
  } finally {
    db.close();
  }
}

/** `await`-friendly sibling of {@link withEvolutionDb}. */
export async function withEvolutionDbAsync<T>(
  project: string | undefined,
  body: (svc: EvolutionService) => Promise<T>
): Promise<T> {
  const db = openEvolutionDb(project);
  try {
    return await body(new EvolutionService(db));
  } finally {
    db.close();
  }
}

/** Params for {@link reportIntegrityFailure}. */
export interface IntegrityFailureReport {
  io: ProgramIO;
  command: string;
  error: EvolutionIntegrityError;
  nextActions: string[];
  /** `options.json` — the caller's `--json` flag, possibly absent. */
  asJson?: boolean | undefined;
}

/** Print an `EvolutionIntegrityError` envelope and set exit code 1. */
export function reportIntegrityFailure(report: IntegrityFailureReport): void {
  printResult(
    report.io,
    fail(
      report.command,
      report.error.code,
      report.error.message,
      { findings: report.error.findings },
      report.nextActions
    ),
    report.asJson
  );
  process.exitCode = 1;
}

/** Params for {@link reportFailure}. */
export interface CommandFailureReport {
  io: ProgramIO;
  command: string;
  code: string;
  error: unknown;
  data: Record<string, unknown>;
  nextActions: string[];
  /** `options.json` — the caller's `--json` flag, possibly absent. */
  asJson?: boolean | undefined;
}

/** Print a generic `<command>_FAILED` envelope and set exit code 1. */
export function reportFailure(report: CommandFailureReport): void {
  printResult(
    report.io,
    fail(
      report.command,
      report.code,
      getErrorMessage(report.error),
      report.data,
      report.nextActions
    ),
    report.asJson
  );
  process.exitCode = 1;
}
