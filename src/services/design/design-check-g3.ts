/**
 * G3a — same-route fidelity against a recorded baseline for `peaks design check`.
 *
 * A baseline is a record, not an image: `.peaks/_runtime/<sessionId>/design/
 * baseline/<route-slug>.json` names the route, the base commit and the loopback
 * URL a live render of that commit answers on. No entry (and no explicit URL)
 * is `skipped('no-baseline')` — never a pass. A malformed entry blocks rather
 * than silently shrinking the gate.
 *
 * The threshold (`--min 90`) is applied here to the score `runFidelity` read
 * from `fidelity.json`; the engine's exit code never decides the verdict.
 *
 * G3b — the advisory archetype rubric — lives here too. It validates the rubric
 * `peaks-ui` wrote for the route's matched exemplar and warns below the
 * recorded threshold; it never yields a failure, so it cannot mask a G1/G2 fail.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ExemplarEntry } from './exemplars.js';
import { FIDELITY_MIN_DEFAULT, type FidelityRunResult, isValidFidelityMin } from './fidelity.js';
import { readRubric, rubricVerdict } from './rubric.js';

const BASELINE_VERSION = 1;
const EMPTY_SLUG = 'root';
const NON_SLUG = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

export type BaselineEntry = {
  schemaVersion: 1;
  route: string;
  baseCommit: string;
  baselineUrl: string;
};

export type BaselineIssue = { file: string; reason: string };

/** A baseline read is total: `issue` names a corrupt entry, `null` means absent. */
export type BaselineRead = { entry: BaselineEntry | null; issue: BaselineIssue | null };

/** The injected fidelity run; the caller binds project root and session id. */
export type G3ADeps = {
  fidelity: (input: {
    baselineUrl: string;
    candidateUrl: string;
    min: number;
  }) => Promise<FidelityRunResult>;
};

export type EvaluateG3aInput = {
  storeDir: string;
  route: string;
  candidateUrl: string;
  /** An explicit baseline URL wins over the recorded entry. */
  baselineUrl?: string;
  /** Defaults to `FIDELITY_MIN_DEFAULT`. */
  min?: number;
  deps: G3ADeps;
};

type G3AEvidence = {
  route: string;
  min: number;
  score: number;
  visual: number | null;
  motion: number | null;
  grade: string | null;
  generatedAt: string | null;
  reportPath: string;
  baselineUrl: string;
  candidateUrl: string;
  /** The commit the recorded baseline was rendered from; null for an explicit URL. */
  baseCommit: string | null;
};

export type G3AResult =
  | ({ status: 'pass' } & G3AEvidence)
  | ({ status: 'fail'; reason: 'below-min' } & G3AEvidence)
  | { status: 'skipped'; route: string; reason: 'no-baseline' | 'route-unknown' }
  | { status: 'blocked'; route: string; code: string; message: string };

/** `/features/channels?x=1` → `features-channels`; `/` → `root`. */
export function routeSlug(route: string): string {
  const path = route.split(/[?#]/)[0] ?? '';
  const slug = path.toLowerCase().replace(NON_SLUG, '-').replace(EDGE_DASHES, '');
  return slug === '' ? EMPTY_SLUG : slug;
}

function malformed(file: string, reason: string): BaselineRead {
  return { entry: null, issue: { file, reason } };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Read the baseline recorded for exactly `route`, with its issue.
 *
 * A missing file is an absent baseline (`issue: null`); a file that does not
 * parse, carries a different route, or lacks its commit/URL is an issue the
 * caller must block on.
 */
export function readBaselineState(storeDir: string, route: string): BaselineRead {
  const file = join(storeDir, `${routeSlug(route)}.json`);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { entry: null, issue: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return malformed(file, 'not-json');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return malformed(file, 'not-an-object');
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.schemaVersion !== BASELINE_VERSION) return malformed(file, 'schema-version');
  if (raw.route !== route) return malformed(file, 'route-mismatch');
  if (!nonEmpty(raw.baseCommit)) return malformed(file, 'base-commit-missing');
  if (!nonEmpty(raw.baselineUrl)) return malformed(file, 'baseline-url-missing');
  return {
    entry: {
      schemaVersion: 1,
      route,
      baseCommit: raw.baseCommit.trim(),
      baselineUrl: raw.baselineUrl.trim()
    },
    issue: null
  };
}

/** And the entry alone; `null` for both a missing and a malformed record. */
export function readBaseline(storeDir: string, route: string): BaselineEntry | null {
  return readBaselineState(storeDir, route).entry;
}

function blocked(route: string, code: string, message: string): G3AResult {
  return { status: 'blocked', route, code, message };
}

type BaselineTarget =
  { ok: true; url: string; baseCommit: string | null } | { ok: false; result: G3AResult };

/** The baseline URL to compare against, or the skipped/blocked verdict to return. */
function resolveBaseline(input: EvaluateG3aInput): BaselineTarget {
  const baseline = readBaselineState(input.storeDir, input.route);
  if (baseline.issue !== null) {
    const { file, reason } = baseline.issue;
    return {
      ok: false,
      result: blocked(
        input.route,
        'DESIGN_BASELINE_INVALID',
        `The recorded baseline ${file} is not usable (${reason}); re-record it on a green run.`
      )
    };
  }
  const url = input.baselineUrl ?? baseline.entry?.baselineUrl ?? null;
  if (url === null) {
    return {
      ok: false,
      result: { status: 'skipped', route: input.route, reason: 'no-baseline' }
    };
  }
  return { ok: true, url, baseCommit: baseline.entry?.baseCommit ?? null };
}

/**
 * Judge one changed route against its baseline.
 *
 * `pass`/`fail` carry the score, its visual/motion split, the grade and the
 * report path so the evidence can name the exact comparison.
 */
export async function evaluateG3a(input: EvaluateG3aInput): Promise<G3AResult> {
  const min = input.min ?? FIDELITY_MIN_DEFAULT;
  if (!isValidFidelityMin(min)) {
    return blocked(
      input.route,
      'DESIGN_FIDELITY_MIN_INVALID',
      `The G3a threshold must be an integer 0..100; refusing ${String(min)}.`
    );
  }
  const target = resolveBaseline(input);
  if (!target.ok) return target.result;
  let result: FidelityRunResult;
  try {
    result = await input.deps.fidelity({
      baselineUrl: target.url,
      candidateUrl: input.candidateUrl,
      min
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return blocked(
      input.route,
      'DESIGN_FIDELITY_NO_EVIDENCE',
      `The fidelity run threw before producing a report: ${detail}`
    );
  }
  if (!result.ok) return blocked(input.route, result.code, result.message);
  const evidence: G3AEvidence = {
    route: input.route,
    min,
    score: result.score,
    visual: result.visual,
    motion: result.motion,
    grade: result.grade,
    generatedAt: result.generatedAt,
    reportPath: result.reportPath,
    baselineUrl: target.url,
    candidateUrl: input.candidateUrl,
    baseCommit: target.baseCommit
  };
  if (result.score < min) return { status: 'fail', reason: 'below-min', ...evidence };
  return { status: 'pass', ...evidence };
}

/**
 * G3b — judge the advisory archetype rubric for one changed route.
 *
 * The rubric is the LLM's product (`peaks-ui`); this function only validates
 * and thresholds it. A route with no registered exemplar is
 * `skipped(no-exemplar-for-archetype)` and an exemplar without a rubric is
 * `blocked(DESIGN_RUBRIC_MISSING)` — evidence was expected and absent. A rubric
 * below the recorded threshold is `warn`; there is no `fail` branch by design.
 */
export type EvaluateG3bInput = {
  /** The rubric envelope text, or null when none was written. */
  rubricText: string | null;
  rid: string;
  route: string;
  exemplar: ExemplarEntry | null;
};

export type G3BResult = {
  status: 'pass' | 'warn' | 'blocked' | 'skipped';
  reason?: 'no-exemplar-for-archetype' | 'below-threshold' | 'explicitly-accepted';
  code?: 'DESIGN_RUBRIC_MISSING' | 'DESIGN_RUBRIC_INVALID';
  message?: string;
  total?: number;
  dimensions?: Record<string, number>;
};

function rubricMissing(input: EvaluateG3bInput, archetype: string): G3BResult {
  return {
    status: 'blocked',
    code: 'DESIGN_RUBRIC_MISSING',
    message:
      `No archetype rubric was written for ${input.route} against the ${archetype} exemplar. ` +
      'The peaks-ui role writes the rubric JSON under the session design directory; the CLI ' +
      'validates it and never scores aesthetics itself.'
  };
}

export function evaluateG3b(input: EvaluateG3bInput): G3BResult {
  if (input.exemplar === null) {
    return { status: 'skipped', reason: 'no-exemplar-for-archetype' };
  }
  const archetype = input.exemplar.archetype;
  if (input.rubricText === null) return rubricMissing(input, archetype);
  const read = readRubric(input.rubricText, { rid: input.rid, archetype });
  if (!read.ok) return { status: 'blocked', code: read.code, message: read.message };
  const evidence = { total: read.total, dimensions: { ...read.rubric.dimensions } };
  if (rubricVerdict(read.total, read.minDimension) === 'pass') {
    return { status: 'pass', ...evidence };
  }
  return { status: 'warn', reason: 'below-threshold', ...evidence };
}
