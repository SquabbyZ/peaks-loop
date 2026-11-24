/**
 * The G3b archetype rubric envelope.
 *
 * The rubric is produced by the LLM (`peaks-ui`) as JSON; this module only
 * validates what was written. Six dimensions are each scored 1..5. The
 * calibration threshold is recorded out of 40 (spec §6.4), so `total` puts the
 * six-score sum on that scale (a raw 30 reads 40, a uniform 4 reads 32); a raw
 * sum would cap at 30 and no rubric could ever reach the threshold. The gate is
 * advisory: `rubricVerdict` yields `pass` or `warn` and never a failure.
 *
 * Validation is deliberately total and strict. A missing dimension, a score
 * outside 1..5, a non-integer score, a foreign rid or archetype, or a wrong
 * schema version is refused with `DESIGN_RUBRIC_INVALID` and a message naming
 * what to regenerate — a permissive read would let an incomplete rubric pass as
 * evidence.
 */
export const RUBRIC_DIMENSIONS = [
  'layout',
  'type',
  'color',
  'states',
  'responsive',
  'a11y'
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

export type Rubric = {
  schemaVersion: 1;
  rid: string;
  archetype: string;
  dimensions: Record<RubricDimension, number>;
};

export type RubricRefusal = { ok: false; code: 'DESIGN_RUBRIC_INVALID'; message: string };

export type RubricRead =
  { ok: true; rubric: Rubric; total: number; minDimension: number } | RubricRefusal;

const SCHEMA_VERSION = 1;
const MIN_SCORE = 1;
const MAX_SCORE = 5;
/** The scale the recorded calibration threshold is stated on (spec §6.4). */
const CALIBRATION_SCALE = 40;
const RAW_MAX = RUBRIC_DIMENSIONS.length * MAX_SCORE;
const PASS_TOTAL = 32;
const PASS_MIN_DIMENSION = 3;

function invalid(message: string): RubricRefusal {
  return { ok: false, code: 'DESIGN_RUBRIC_INVALID', message };
}

/** The JSON object a rubric must be, or the refusal that says why not. */
function parseEnvelope(text: string): { ok: true; raw: Record<string, unknown> } | RubricRefusal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid(
      'The design rubric is not valid JSON; peaks-ui must write the rubric envelope as strict JSON.'
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return invalid(
      'The design rubric must be a JSON object with schemaVersion, rid, archetype and dimensions.'
    );
  }
  return { ok: true, raw: parsed as Record<string, unknown> };
}

function isScore(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= MIN_SCORE && value <= MAX_SCORE
  );
}

/** The schema, request and archetype checks, or null when all agree. */
function identityIssue(
  raw: Record<string, unknown>,
  expected: { rid: string; archetype: string }
): RubricRead | null {
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    return invalid(
      `The design rubric's schemaVersion must be ${String(SCHEMA_VERSION)}; ` +
        `regenerate the envelope with schemaVersion ${String(SCHEMA_VERSION)}.`
    );
  }
  if (raw.rid !== expected.rid) {
    return invalid(
      `The design rubric names rid ${String(raw.rid)} but this check is for ${expected.rid}; ` +
        'write the rubric for this request.'
    );
  }
  if (raw.archetype !== expected.archetype) {
    return invalid(
      `The design rubric names archetype ${String(raw.archetype)} but the route's exemplar is ` +
        `${expected.archetype}; score the matched archetype.`
    );
  }
  return null;
}

type DimensionRead =
  { ok: true; scores: Record<RubricDimension, number> } | Extract<RubricRead, { ok: false }>;

/**
 * The six scores, or the refusal. Only the named dimensions are copied; an
 * extra key is ignored rather than becoming evidence nothing scored.
 */
function readDimensions(value: unknown): DimensionRead {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(
      'The design rubric needs a dimensions object scoring layout, type, color, states, responsive and a11y.'
    );
  }
  const dimensions = value as Record<string, unknown>;
  const scores = {} as Record<RubricDimension, number>;
  for (const dimension of RUBRIC_DIMENSIONS) {
    if (!(dimension in dimensions)) {
      return invalid(
        `The design rubric is missing the ${dimension} dimension; all ` +
          `${String(RUBRIC_DIMENSIONS.length)} dimensions are required.`
      );
    }
    const score = dimensions[dimension];
    if (!isScore(score)) {
      return invalid(
        `The design rubric scores ${dimension} as ${JSON.stringify(score)}; ` +
          `every dimension must be an integer ${String(MIN_SCORE)}..${String(MAX_SCORE)}.`
      );
    }
    scores[dimension] = score;
  }
  return { ok: true, scores };
}

/**
 * Read one rubric envelope and return its score, or the refusal.
 *
 * `expected` binds the rubric to the request and the exemplar: a rubric written
 * for another rid or another archetype is refused rather than re-attributed.
 */
export function readRubric(text: string, expected: { rid: string; archetype: string }): RubricRead {
  const envelope = parseEnvelope(text);
  if (!('raw' in envelope)) return envelope;
  const issue = identityIssue(envelope.raw, expected);
  if (issue !== null) return issue;
  const read = readDimensions(envelope.raw.dimensions);
  if (!read.ok) return read;
  const scores = read.scores;
  const sum = RUBRIC_DIMENSIONS.reduce((total, dimension) => total + scores[dimension], 0);
  return {
    ok: true,
    rubric: {
      schemaVersion: SCHEMA_VERSION,
      rid: expected.rid,
      archetype: expected.archetype,
      dimensions: scores
    },
    total: Math.round((sum * CALIBRATION_SCALE) / RAW_MAX),
    minDimension: Math.min(...RUBRIC_DIMENSIONS.map((dimension) => scores[dimension]))
  };
}

/**
 * The advisory verdict: `pass` only at total >= 32 with no dimension below 3.
 *
 * There is no failure branch by design — G3b warns and the caller decides how
 * to surface it; it never turns another gate's verdict into a failure.
 */
export function rubricVerdict(total: number, minDimension: number): 'pass' | 'warn' {
  return total >= PASS_TOTAL && minDimension >= PASS_MIN_DIMENSION ? 'pass' : 'warn';
}
