/**
 * Race-lane handoff probe for `peaks code orchestrator-can-do --lane race`.
 *
 * The race lanes do their work in a single window, so nothing inside them
 * can answer "is this task still small enough for the fast lane?" on its
 * own. This module is that answer: it compares three caller-supplied
 * signals against named thresholds and reports a routing verdict.
 *
 * Crossing a threshold is a routing decision, never a failure. The verdict
 * carries `mustHandoff: true` while the command's envelope stays `ok`, so
 * the caller hands the task to `peaks-code` instead of reporting an error.
 */

/** Independent subtasks at or above this count leave the race lane. */
export const RACE_MAX_SUBTASKS = 3;

/** Expected changed files at or above this count leave the race lane. */
export const RACE_MAX_FILES = 8;

/** Risk surfaces the fast lane refuses to carry; any hit leaves the lane. */
export const RACE_RISK_SURFACES = [
  'auth',
  'filesystem',
  'external-call',
  'schema-migration',
  'release'
] as const;

export type RaceRiskSurface = (typeof RACE_RISK_SURFACES)[number];

export interface RaceThresholds {
  readonly maxSubtasks: number;
  readonly maxFiles: number;
  readonly riskSurfaces: readonly RaceRiskSurface[];
}

/** The named ceilings a caller is judged against, echoed in the verdict. */
export const RACE_THRESHOLDS: RaceThresholds = {
  maxSubtasks: RACE_MAX_SUBTASKS,
  maxFiles: RACE_MAX_FILES,
  riskSurfaces: RACE_RISK_SURFACES
};

export interface RaceLaneInput {
  readonly subtasks: number;
  readonly files: number;
  readonly risks: readonly RaceRiskSurface[];
}

export interface RaceVerdict {
  readonly lane: 'race';
  /** True when any threshold is crossed; the task belongs to peaks-code. */
  readonly mustHandoff: boolean;
  /** Named thresholds that fired, e.g. `subtasks` or `risk:auth`. */
  readonly exceeded: readonly string[];
  readonly thresholds: RaceThresholds;
}

/** Raw flag values as Commander hands them over — absent is `undefined`. */
export interface RaceLaneFlags {
  readonly subtasks: string | undefined;
  readonly files: string | undefined;
  readonly risk: string | undefined;
}

export type RaceLaneErrorCode = 'MISSING_RACE_INPUTS' | 'INVALID_RACE_INPUT' | 'UNSUPPORTED_LANE';

export class RaceLaneError extends Error {
  constructor(
    message: string,
    public readonly code: RaceLaneErrorCode
  ) {
    super(message);
    this.name = 'RaceLaneError';
  }
}

function parseCount(value: string | undefined, flag: string): number {
  if (value === undefined) {
    throw new RaceLaneError(`${flag} is required when --lane race is set`, 'MISSING_RACE_INPUTS');
  }
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  if (trimmed.length === 0 || !Number.isInteger(parsed) || parsed < 0) {
    throw new RaceLaneError(
      `${flag} must be a non-negative integer, got "${value}"`,
      'INVALID_RACE_INPUT'
    );
  }
  return parsed;
}

function parseRisks(value: string | undefined): RaceRiskSurface[] {
  if (value === undefined) {
    throw new RaceLaneError(
      '--race-risk is required when --lane race is set; pass "" for no risk surface',
      'MISSING_RACE_INPUTS'
    );
  }
  const tokens = value
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  const risks: RaceRiskSurface[] = [];
  for (const token of tokens) {
    if (!(RACE_RISK_SURFACES as readonly string[]).includes(token)) {
      throw new RaceLaneError(
        `unknown risk surface "${token}"; expected one of ${RACE_RISK_SURFACES.join(', ')}`,
        'INVALID_RACE_INPUT'
      );
    }
    risks.push(token as RaceRiskSurface);
  }
  return risks;
}

/** Validate the three flag values; never defaults a missing one to a passing zero. */
export function resolveRaceLaneInput(flags: RaceLaneFlags): RaceLaneInput {
  return {
    subtasks: parseCount(flags.subtasks, '--race-subtasks'),
    files: parseCount(flags.files, '--race-files'),
    risks: parseRisks(flags.risk)
  };
}

/** Compare validated inputs against the three named thresholds. */
export function evaluateRaceLane(input: RaceLaneInput): RaceVerdict {
  const exceeded: string[] = [];
  if (input.subtasks >= RACE_MAX_SUBTASKS) {
    exceeded.push('subtasks');
  }
  if (input.files >= RACE_MAX_FILES) {
    exceeded.push('files');
  }
  const hit = new Set(input.risks);
  for (const surface of RACE_RISK_SURFACES) {
    if (hit.has(surface)) {
      exceeded.push(`risk:${surface}`);
    }
  }
  return {
    lane: 'race',
    mustHandoff: exceeded.length > 0,
    exceeded,
    thresholds: RACE_THRESHOLDS
  };
}
