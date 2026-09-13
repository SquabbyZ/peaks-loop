/**
 * Harness context witness — peaks-loop's second scale, captured from the
 * harness instead of re-derived by peaks-loop.
 *
 * The harness pipes a JSON session payload on the statusline command's stdin,
 * and that payload is the ONLY supported programming channel that carries the
 * harness's OWN context numbers (`context_window.used_percentage` and
 * `context_window.context_window_size`). peaks-loop's own ratio is derived
 * separately (transcript estimate) and divides by a window peaks-loop writes
 * into the harness's settings. Two derivations, two authors — and until now
 * nothing compared them. This module is the comparison.
 *
 * WHAT IS NOT COMPARED, and why — read before changing anything here:
 * `context_window_size` is the MODEL window. peaks-loop's denominator is the
 * AUTO-COMPACT window it configures. They are semantically different objects
 * that happen to be equal on the machine this slice was written on. The
 * comparison is therefore `peaks ratio` vs `used_percentage` — two fractions
 * "used / some window" — and NEVER a comparison of the two windows as if they
 * were one field. A guard that compared the windows would report agreement on
 * the one machine where the two numbers coincide and would have no idea why.
 *
 * `context_window_size` IS read as the denominator of the harness's OWN
 * `used_percentage`, to recover the unit of a payload that does not state one
 * (`readPercentageUnit`). That is reading the harness's field against the
 * harness's own window; it is not a denominator for the comparison above.
 *
 * WHY A RESIDUAL, AND WHY THIS BUDGET (`witnessToleranceTokens` + the residual
 * in `compareHarnessWitness`).
 *
 * WHY A THIRD ANSWER. This guard has three outcomes, not two: after "they
 * agree" and "they disagree" there is "this sample cannot tell". A guard with
 * only two answers cannot distinguish "correctly silent" from "broken", which
 * is the failure mode this repository has a memory about. `unverifiable` is
 * that third answer, and it is the honest one whenever the two numbers are not
 * known to describe the same moment — and also whenever they describe the same
 * moment but the sample is too coarse to separate a real window difference from
 * the budget's own uncertainty, which is the state a small or stale witness
 * puts this guard in.
 *
 * THE FILE IS A RENDER LEDGER, NOT ONLY A WITNESS. It is written on every
 * render that receives a payload, including a render whose payload carried no
 * usable percentage. That is what makes `absent` diagnosable: "no file" means
 * nothing rendered here, and "a file with no percentage" means one did and its
 * payload had nothing to read. See `.peaks/_runtime/<sid>/rd/tech-doc.md` §17.
 *
 * ...BUT A LOWER-INFORMATION RENDER DOES NOT OVERWRITE A HIGHER-INFORMATION
 * ONE (repair cycle 3). The ledger rule is what makes the FIRST render of a
 * session land; the no-downgrade rule is what stops a later contextless render
 * from silencing a comparison the earlier one could still make. `capturedAt`
 * keeps naming the render that produced the surviving record, so nothing on
 * disk claims to be fresher than it is. See `writeHarnessWitness`.
 *
 * COST (the statusline runs this on every render): one small file write on the
 * render path, one small file read on the probe path. No network, no directory
 * walk, no transcript read, no new dependency.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getSessionDir } from '../session/getSessionDir.js';
import type { StatusLineStdin } from '../skills/skill-statusline-service.js';

export const HARNESS_CONTEXT_WITNESS_FILE = 'harness-context-witness.json';
export const WITNESS_SCHEMA_VERSION = 2;

/**
 * Contributor 1 of the budget: the harness reports a rounded percentage.
 * "Pre-calculated percentage of context window used" is not documented as
 * fractional, so the conservative reading is an integer percent, i.e. up to
 * ±0.5 percentage points = ±0.005 of the window. If the real payload turns out
 * to carry decimals this term shrinks tenfold and the guard gets sharper; the
 * assumption is visible in the first witness file, where
 * `usageTokens / modelWindowTokens` and `usedPercentage` must agree.
 */
export const WITNESS_PERCENT_ROUNDING_FRACTION = 0.005;

/**
 * Contributor 2: the two sides do not sum exactly the same token quantities.
 * MEASURED, not guessed — on 2026-09-13 the harness's own pre-compact count
 * (963,306 tokens) exceeded peaks-loop's transcript estimate (961,658) by
 * 1,648 tokens = 0.171%. Used as a fraction of the tokens, not of the window.
 */
export const WITNESS_NUMERATOR_FRACTION = 0.0017;

/**
 * The smallest window difference this guard claims to detect, and therefore
 * the yardstick for "is this sample sharp enough to answer at all".
 *
 * 3% is not arbitrary: the harness compacts a native-1M model at ~967,000 by
 * default while peaks-loop writes the model ceiling, so 1,000,000 vs 967,000 —
 * a 3.3% difference — is the smallest real-world disagreement between the two
 * denominators today. Anything the guard reports as "agree" while its own
 * budget is wider than that difference is a claim it cannot support.
 *
 * NOTE (repair cycle 2): the constant is a floor on the SAMPLE, and the sample
 * it floors is the WITNESS's, not peaks-loop's — a gap of this size leaves a
 * residual proportional to the witness's ratio, so a stale (or low) witness
 * shrinks the signal while the budget's rounding term does not shrink with it.
 * See `sampleSupportsAgreement`, which is where this constant is applied. At
 * zero skew it was already correctly calibrated (measured onset 0.176 of the
 * window against a predicted 0.177); the fault was that only zero skew was
 * correctly calibrated.
 */
export const MIN_DETECTABLE_WINDOW_DIFFERENCE = 0.03;

/**
 * The largest raw value a FRACTION reading can carry. Above it the fraction
 * reading is out of range, so the value has exactly ONE in-range reading —
 * percent — and the unit needs no other evidence. (The repo's env / statusline
 * readers use 1.5; that threshold calls values in (1, 1.5] fractions by fiat
 * and then has to throw them away, which is why this reader does not reuse it.)
 */
const FRACTION_MAX = 1;

/** Upper bound of a sane percentage scale; above this the payload is not a percent. */
const PERCENT_SCALE_MAX = 100;

/** The three prompt-side components peaks-loop's own `rawTokens` sums. */
const USAGE_TOKEN_KEYS = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const;

/**
 * Which of the two in-range readings of a raw percentage was taken, or that
 * neither could be taken. `unestablished` is not a reading: the payload said a
 * percentage and carried nothing that could settle which scale it is on.
 */
export type PercentageUnit = 'fraction' | 'percent' | 'unestablished';

/**
 * A harness context snapshot, as written to
 * `<projectRoot>/.peaks/_runtime/<sessionId>/harness-context-witness.json`.
 *
 * The path is peaks-loop's own session runtime directory — deliberately NOT
 * the harness's settings file or any other harness-owned location.
 */
export interface HarnessContextWitness {
  readonly schemaVersion: number;
  /** When peaks-loop received the render payload. */
  readonly capturedAt: string;
  /**
   * `context_window.used_percentage`, normalised to 0..1. `null` when this
   * render's payload had no percentage this module could read — the record is
   * still written, because "a render happened and carried nothing usable" is
   * a different fact from "nothing rendered", and the two are told apart by
   * exactly this file existing or not.
   */
  readonly usedPercentage: number | null;
  /**
   * The payload's `used_percentage` VERBATIM, before any normalisation. Kept
   * so a human can tell a unit misread from a real disagreement: the number
   * above is a 0..1 fraction and this one is not, and only this one shows what
   * the harness actually said.
   */
  readonly usedPercentageRaw: number | null;
  /** Which reading `usedPercentage` was normalised from, or why none was taken. */
  readonly usedPercentageUnit: PercentageUnit | null;
  /** `context_window.context_window_size`. Recorded, never the comparison's denominator. */
  readonly modelWindowTokens: number | null;
  /**
   * Sum of the prompt-side `context_window.current_usage` components. This is
   * the ALIGNMENT KEY: comparing it with a probe's `rawTokens` is how the
   * guard learns whether the two numbers describe the same API response, and
   * therefore how much of any difference is sampling skew rather than a real
   * disagreement. `output_tokens` is excluded so the sum is the same quantity
   * peaks-loop's transcript estimate sums.
   */
  readonly usageTokens: number | null;
  /** The harness session id from the payload, for the foreign-session check. */
  readonly outerSessionId: string | null;
}

export type WitnessVerdict = 'absent' | 'foreign-session' | 'unverifiable' | 'agree' | 'disagree';

/**
 * Why there is no witness to compare. The first two leave the same file system
 * state — no file — so the caller, which knows the session directory, resolves
 * which applies and this module turns it into a sentence.
 *
 * The third (`unreadable`, repair cycle 3) is decided by the READ, not by the
 * directory, and it is the reason `readHarnessWitness` returns a tagged union
 * rather than `null`: a file that exists but cannot be used is evidence that a
 * render DID happen, so calling it `not-rendered` names the wrong cause — the
 * exact mis-attribution §17-B was written to remove.
 */
export type WitnessAbsentCause = 'session-dir-missing' | 'not-rendered' | 'unreadable';

export interface HarnessWitnessComparison {
  readonly verdict: WitnessVerdict;
  /** Why the verdict is what it is, when it is not `agree` / `disagree`. */
  readonly reason: string | null;
  readonly harnessPct: number | null;
  readonly peaksRatio: number;
  /** `peaksRatio - harnessPct`; `null` when the harness side is unknown. */
  readonly deviation: number | null;
  /**
   * The quantity the verdict is actually decided on: `deviation` minus the
   * sampling skew the two token snapshots measure. Equal denominators put this
   * at zero no matter how stale the witness is, so a non-zero residual is the
   * window difference itself rather than the sample's age.
   */
  readonly residual: number | null;
  /** The budget `residual` was tested against, as a fraction of the window. */
  readonly tolerance: number | null;
  readonly witnessedAt: string | null;
  readonly witnessTokens: number | null;
  readonly peaksTokens: number | null;
  /** The harness's raw `used_percentage`, verbatim — see `usedPercentageRaw`. */
  readonly witnessRawPercentage: number | null;
  /** Which reading produced `harnessPct`, so a unit misread is visible. */
  readonly witnessPercentageUnit: PercentageUnit | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Pick the reading of a raw `used_percentage` whose unit the payload does not
 * state.
 *
 * Above `FRACTION_MAX` only the percent reading is in range, so the value
 * decides. At or below it both readings are in range and the value cannot
 * decide, so the witness's OWN token snapshot does: the two readings differ by
 * exactly 100x, which puts their geometric midpoint at `raw / 10`.
 * `unestablished` when the payload did not carry enough to compute that ratio:
 * the value is in range on both scales and nothing in the payload says which
 * one the harness meant.
 *
 * NOTE: this reads the harness's field against the harness's own window. It is
 * not the comparison's denominator (see the module header).
 */
function readPercentageUnit(raw: number, tokensPerWindow: number | null): PercentageUnit {
  if (raw > FRACTION_MAX) return 'percent';
  if (tokensPerWindow === null) return 'unestablished';
  return tokensPerWindow < raw / 10 ? 'percent' : 'fraction';
}

/**
 * Normalise a harness percentage to 0..1, keeping the raw value either way.
 *
 * A value on neither scale (negative, or above 100) is refused rather than
 * clamped — a witness nobody can interpret must not be compared — but it is
 * still RETURNED with its raw value attached, because discarding it is what
 * left a refused payload indistinguishable from a render that never happened.
 *
 * A value that is in range on BOTH scales, with no snapshot to settle which,
 * is refused the same way — no reading is taken. Applying the repo's
 * fraction-first convention here instead is what read a "used 1%" payload as
 * 100% and turned a unit misfire into a confident disagreement that blamed the
 * two denominators (see `unusableReason`).
 */
function resolvePercentage(
  raw: unknown,
  tokensPerWindow: number | null,
): { value: number | null; raw: number | null; unit: PercentageUnit | null } {
  const value = finiteNumber(raw);
  if (value === null || value < 0 || value > PERCENT_SCALE_MAX) {
    return { value: null, raw: value, unit: null };
  }
  const unit = readPercentageUnit(value, tokensPerWindow);
  if (unit === 'unestablished') return { value: null, raw: value, unit };
  return { value: unit === 'percent' ? value / PERCENT_SCALE_MAX : value, raw: value, unit };
}

/** Sum the prompt-side usage components, or `null` when none is present. */
function sumUsageTokens(currentUsage: unknown): number | null {
  if (currentUsage === null || typeof currentUsage !== 'object' || Array.isArray(currentUsage)) {
    return null;
  }
  const record = currentUsage as Record<string, unknown>;
  let sum = 0;
  let seen = false;
  for (const key of USAGE_TOKEN_KEYS) {
    const value = finiteNumber(record[key]);
    if (value !== null) {
      sum += value;
      seen = true;
    }
  }
  return seen ? sum : null;
}

/**
 * Read the harness's context block out of a parsed statusline stdin payload.
 * Returns `null` only when there was no payload at all (a render on a TTY, or
 * a manual `peaks statusline`) — in which case there is nothing to record and
 * nothing to say. A payload that arrived but carried no usable percentage is
 * recorded, not dropped.
 */
export function parseHarnessWitness(input: {
  readonly stdin: StatusLineStdin | null;
  readonly nowMs: number;
}): HarnessContextWitness | null {
  if (input.stdin === null || input.stdin === undefined) return null;
  const block = input.stdin.context_window;
  // `null` AS WELL AS `undefined` (repair cycle 3). The key being present with
  // no value is how a JSON producer spells "there is no context block", and the
  // harness — not peaks-loop — decides this field's value. Guarding only
  // `undefined` let `null` through to `block.context_window_size` and threw
  // straight out of the statusline render: measured 2026-09-14 against the real
  // CLI, `PEAKS_STATUSLINE_STDIN='{"context_window":null}' … statusline` gave
  // exit 1, empty stdout, `UNHANDLED_ERROR` — no line rendered at all, for as
  // long as the harness sends that shape. `block?.used_percentage` below was
  // already null-safe; this pair was the hole.
  const noBlock = block === null || block === undefined;
  const modelWindowTokens = noBlock ? null : finiteNumber(block.context_window_size);
  const usageTokens = noBlock ? null : sumUsageTokens(block.current_usage);
  const tokensPerWindow =
    usageTokens !== null && modelWindowTokens !== null && modelWindowTokens > 0
      ? usageTokens / modelWindowTokens
      : null;
  const percentage = resolvePercentage(block?.used_percentage, tokensPerWindow);
  const sessionId = input.stdin.session_id;
  return {
    schemaVersion: WITNESS_SCHEMA_VERSION,
    capturedAt: new Date(input.nowMs).toISOString(),
    usedPercentage: percentage.value,
    usedPercentageRaw: percentage.raw,
    usedPercentageUnit: percentage.unit,
    modelWindowTokens,
    usageTokens,
    outerSessionId: typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
  };
}

export function harnessWitnessPath(projectRoot: string, sessionId: string): string {
  return `${getSessionDir(projectRoot, sessionId)}/${HARNESS_CONTEXT_WITNESS_FILE}`;
}

/**
 * Write this render's record. Returns whether a file was written.
 *
 * This is the ONLY side effect on the statusline render path. It is bounded
 * (one small file, inside peaks-loop's own session directory), it cannot
 * influence any decision peaks-loop makes (nothing except the diagnostic in
 * `peaks code context-now` reads it), and it never throws — a statusline that
 * fails to render because an observability file could not be written would be
 * a worse failure than a missing observation. A failed write is not swallowed:
 * the next probe reports `absent`, which is the visible symptom.
 *
 * No `mkdir`: the session directory is created by the session layer, and a
 * statusline render is the wrong place to be creating directories. Its absence
 * is one of the honest reasons the witness can be missing.
 *
 * Written via temp + rename, not in place. A reader runs in ANOTHER process
 * (the probe) and treats unreadable JSON as "no witness" — so a torn read
 * would not be an error, it would be a SILENT loss of the comparison, which is
 * the failure mode this whole slice exists to remove. The rename makes the
 * partial state unobservable. Same shape as `atomicWriteJson` in
 * statusline-settings-service.ts.
 *
 * The rename is not always available: on Windows it throws EPERM while another
 * process holds the target open, which is exactly the reader this guard is
 * written for. Dropping the sample then would be the silent loss the temp
 * rename was introduced to remove, so the write falls back to in-place. The
 * fallback gives up atomicity for that one write — the reader may see a
 * half-written file and call it "no witness" — which is a narrower failure
 * than never recording the sample at all, and the temp path stays the normal
 * one.
 *
 * A LOWER-INFORMATION RECORD DOES NOT REPLACE A HIGHER-INFORMATION ONE (repair
 * cycle 3). The render that carries no readable percentage is still recorded
 * when there is nothing better on disk — that is what tells "rendered, nothing
 * usable" apart from "never rendered" (§17-B) — but it does NOT overwrite a
 * record whose percentage IS readable. Overwriting silences a real comparison:
 * measured 2026-09-14, a witness giving a real 3.3% window gap reported
 * `disagree` with its sentence, and one render whose payload lacked
 * `context_window` turned the same comparison into `unverifiable` with the
 * sentence suppressed. A render that says less must not delete a sample that
 * says more.
 *
 * AND THE PARSE IS INSIDE A TRY (repair cycle 3). The module's contract at the
 * top of this comment — "it never throws" — was true only by inspection: the
 * `parseHarnessWitness` call sat above the only `try`, and a payload shape the
 * guards did not anticipate escaped the function and killed the render (see
 * `parseHarnessWitness` for the measured case). A nested `try` rather than a
 * wider one, because the outer catch says something different: it is the
 * temp+rename FALLBACK, and a parse failure has no JSON to fall back TO.
 * A payload this module cannot read is a missing observation, which is the
 * outcome the contract already prefers.
 */
export function writeHarnessWitness(input: {
  readonly projectRoot: string | null;
  readonly sessionId: string | null;
  readonly stdin: StatusLineStdin | null;
  readonly nowMs: number;
}): boolean {
  if (input.projectRoot === null || input.sessionId === null) return false;
  let witness: HarnessContextWitness | null;
  try {
    witness = parseHarnessWitness({ stdin: input.stdin, nowMs: input.nowMs });
  } catch {
    return false;
  }
  if (witness === null) return false;
  const path = harnessWitnessPath(input.projectRoot, input.sessionId);
  if (!existsSync(dirname(path))) return false;
  if (witness.usedPercentage === null) {
    const existing = readHarnessWitness({ projectRoot: input.projectRoot, sessionId: input.sessionId });
    if (existing.kind === 'valid' && existing.witness.usedPercentage !== null) return false;
  }
  const json = `${JSON.stringify(witness, null, 2)}\n`;
  const tempPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tempPath, json, 'utf8');
    renameSync(tempPath, path);
    return true;
  } catch {
    rmSync(tempPath, { force: true });
    try {
      writeFileSync(path, json, 'utf8');
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * What a read found.
 *
 * This used to be `HarnessContextWitness | null`, which collapsed FOUR file
 * states — absent, unreadable, not JSON, not the shape this module writes —
 * into one `null`. The caller then had to guess the cause from the directory
 * alone and picked `not-rendered` whenever the directory existed, so a render
 * whose record was merely unreadable was reported as "the statusline has not
 * rendered here": the wrong-cause sentence §17-B was written to remove. The
 * three states are named here instead of re-derived by a second look at the
 * disk. Same shape, and deliberately the same words (`missing` / `valid` /
 * `invalid`), as `CompactLifecycleRead` in
 * `src/services/compact-statusline/compact-lifecycle-store.ts`, which reads a
 * sibling file in the same directory for the same purpose.
 */
export type HarnessWitnessRead =
  | { readonly kind: 'missing' }
  | { readonly kind: 'valid'; readonly witness: HarnessContextWitness }
  | { readonly kind: 'invalid' };

/**
 * Read the record for a session. Anything that exists but cannot be used as a
 * record reads as `invalid` — never as `missing`, which would erase the one
 * fact the file's existence carries: a render happened here.
 */
export function readHarnessWitness(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
}): HarnessWitnessRead {
  const path = harnessWitnessPath(input.projectRoot, input.sessionId);
  if (!existsSync(path)) return { kind: 'missing' };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'invalid' };
    const record = parsed as Record<string, unknown>;
    const unit = record['usedPercentageUnit'];
    return {
      kind: 'valid',
      witness: {
        schemaVersion: finiteNumber(record['schemaVersion']) ?? WITNESS_SCHEMA_VERSION,
        capturedAt: typeof record['capturedAt'] === 'string' ? record['capturedAt'] : '',
        usedPercentage: finiteNumber(record['usedPercentage']),
        usedPercentageRaw: finiteNumber(record['usedPercentageRaw']),
        usedPercentageUnit: unit === 'fraction' || unit === 'percent' || unit === 'unestablished' ? unit : null,
        modelWindowTokens: finiteNumber(record['modelWindowTokens']),
        usageTokens: finiteNumber(record['usageTokens']),
        outerSessionId: typeof record['outerSessionId'] === 'string' ? record['outerSessionId'] : null
      }
    };
  } catch {
    // Unreadable (permissions, a directory where the file belongs, a torn
    // read) and unparseable both land here. They are one fact for the caller:
    // the file is there and no record can be taken from it.
    return { kind: 'invalid' };
  }
}

/**
 * The budget, in tokens: what a difference between the two ratios can be
 * explained by WITHOUT the two denominators being different, once the
 * sampling skew has been taken out (see `compareHarnessWitness`).
 *
 *   rounding     0.005 x window        — the harness's percentage is rounded
 *   numerator    0.0017 x usedTokens   — measured disagreement of the two sums
 *
 * Sample skew is deliberately NOT a term here. It is not a budget at all: it
 * is MEASURED per sample from the two token counts and SUBTRACTED from the
 * deviation, because under equal denominators the token difference and the
 * ratio difference are the same number — see `compareHarnessWitness`.
 */
export function witnessToleranceTokens(input: {
  readonly windowTokens: number;
  readonly usedTokens: number;
}): number {
  return WITNESS_PERCENT_ROUNDING_FRACTION * input.windowTokens
    + WITNESS_NUMERATOR_FRACTION * input.usedTokens;
}

/**
 * Whether this sample can support an `agree`.
 *
 * `agree` is a claim that the two denominators MATCH. A window difference `d`
 * shows up in the residual as `-d x harnessPct/(1+d)` — it carries the
 * WITNESS's ratio, not peaks-loop's, because the residual is a difference of
 * two ratios and therefore scales with how much of the harness's window was in
 * use when the witness was captured. The observation also carries an error of
 * up to one budget (`tolerance`): the harness's percentage is rounded, and the
 * two sides do not sum exactly the same token quantities. So the smallest
 * difference this guard claims to detect has to leave a residual bigger than
 * twice the budget, or it hides inside the budget's own uncertainty and the
 * strongest answer goes to a real gap.
 *
 * Gating on `peaksRatio` instead — which is what this guard did until repair
 * cycle 2 — is blind to exactly that: it is a function of a number the signal
 * does not contain. Measured (2026-09-13): with the budget and the gate as they
 * were, a real 3.3% gap was reported `agree` at every ratio below ~0.61, 2,436
 * of 95,475 swept samples across ratios 0.18-0.99 reported `agree` over a real
 * gap of 3-8%, and `unverifiable` was unreachable above 0.18 of the window —
 * the one answer that was honest there could not be produced there.
 */
function sampleSupportsAgreement(harnessPct: number, tolerance: number): boolean {
  const smallestGapSignal =
    (MIN_DETECTABLE_WINDOW_DIFFERENCE * Math.abs(harnessPct)) / (1 + MIN_DETECTABLE_WINDOW_DIFFERENCE);
  return smallestGapSignal > 2 * tolerance;
}

/** Which of the three `absent` states applies, in the reader's own words. */
function absentReason(cause: WitnessAbsentCause): string {
  if (cause === 'session-dir-missing') {
    return 'this session has no runtime directory yet, so nothing has been captured for it';
  }
  if (cause === 'unreadable') {
    return 'a witness file exists for this session but could not be read as a record — the statusline DID '
      + 'render here, and its record is unreadable, malformed, or not the shape this reader expects';
  }
  return 'no render has been recorded for this session — the statusline has not rendered through peaks-loop here';
}

/** Why a recorded render cannot be compared, in the reader's own words. */
function unusableReason(witness: HarnessContextWitness): string {
  if (witness.usedPercentageRaw === null) {
    return 'the payload carried no `used_percentage`, so this render recorded nothing to compare';
  }
  if (witness.usedPercentageUnit === 'unestablished') {
    return `the payload reported used_percentage ${witness.usedPercentageRaw} and carried no token snapshot `
      + 'to settle whether that is a fraction or a percent; the raw value is recorded, and no comparison is '
      + 'made from it';
  }
  return `the payload reported used_percentage ${witness.usedPercentageRaw}, which is on neither scale `
    + '(a 0..1 fraction or a 0..100 percent); the raw value is recorded, and no comparison is made from it';
}

/**
 * Compare peaks-loop's ratio with the harness's own percentage.
 *
 * Two identifiers must match before any comparison is allowed:
 *   1. the SESSION — a witness written by another harness session on the same
 *      project is not evidence about this one. Lenient in the same direction as
 *      the compact-event attribution: refused only when BOTH ids resolve and
 *      differ, because a guard that turns a missing field into a permanent
 *      "cannot tell" is the failure this whole slice exists to remove.
 *   2. the MOMENT — a witness is a snapshot, and the harness documents that its
 *      percentage depends on when it was calculated. The token counts are what
 *      says whether the two numbers came from the same API response.
 *
 * THE MOMENT IS REMOVED, NOT BUDGETED (repair cycle 1). If the two ratios
 * share a denominator W, the harness's count and peaks-loop's count differ by
 * exactly the sampling skew, so
 *
 *     peaksRatio - harnessPct == (peaksTokens - witnessTokens) / W
 *
 * holds identically — it is not a tolerance to be granted, it is an equality
 * to be tested. Budgeting the skew instead (`tolerance += |skew|`) made the
 * budget grow by `x` while the deviation grew by `x(1+g)`, so a real window
 * difference `g` was cancelled for every skew large enough to absorb it: a
 * measured 3.3% denominator gap read `agree` for skew in [12,400, 22,100]
 * tokens, and gaps up to 5.3% never surfaced at all. Subtracting the skew from
 * the deviation and testing the remainder against a budget that contains only
 * rounding and numerator disagreement makes the test invariant to skew by
 * construction, and leaves `-g x harnessPct/(1+g)` — the window difference
 * itself — as the only thing the residual can be.
 *
 * AND THE RESIDUAL'S SIZE IS THE WITNESS'S, NOT PEAKS-LOOP'S (repair cycle 2).
 * `-g x harnessPct/(1+g)` carries the witness's ratio, so a witness captured
 * while the session was small cannot show a window difference that a bigger
 * witness would. The three answers therefore do not share one gate: a residual
 * past the budget is a `disagree` at any witness size, while `agree` needs the
 * sample to be sharp enough to support it (`sampleSupportsAgreement`).
 */
export function compareHarnessWitness(input: {
  readonly witness: HarnessContextWitness | null;
  readonly peaksRatio: number;
  readonly peaksTokens: number | null;
  readonly peaksWindowTokens: number | null;
  readonly outerSessionId: string | null;
  readonly absentCause?: WitnessAbsentCause;
}): HarnessWitnessComparison {
  const base = {
    peaksRatio: input.peaksRatio,
    peaksTokens: input.peaksTokens,
    witnessTokens: input.witness?.usageTokens ?? null,
    witnessedAt: input.witness?.capturedAt ?? null,
    witnessRawPercentage: input.witness?.usedPercentageRaw ?? null,
    witnessPercentageUnit: input.witness?.usedPercentageUnit ?? null
  };

  if (input.witness === null) {
    return {
      ...base,
      verdict: 'absent',
      reason: absentReason(input.absentCause ?? 'not-rendered'),
      harnessPct: null,
      deviation: null,
      residual: null,
      tolerance: null
    };
  }

  const witness = input.witness;
  // The version is the record's own statement of which unit rule normalised
  // `usedPercentage`. Reading a record written under an older rule as if it
  // were this one takes an old value under a new rule: a v1 file that recorded
  // the payload's bare `1` as a fraction holds `usedPercentage: 1` (100%), and
  // reading that as the current shape reports a confident disagreement and
  // blames the two denominators for a unit misfire. Those files are already on
  // disk for anyone who ran an earlier revision, and the next render replaces
  // one — so the honest answer here is to abstain, not to migrate a value whose
  // raw form was never recorded.
  if (witness.schemaVersion !== WITNESS_SCHEMA_VERSION) {
    return {
      ...base,
      verdict: 'unverifiable',
      reason: `this witness was recorded under schema v${witness.schemaVersion} and this revision reads `
        + `v${WITNESS_SCHEMA_VERSION}, which do not agree on what the recorded percentage means; it is not `
        + 'compared, and the next render replaces it',
      harnessPct: null,
      deviation: null,
      residual: null,
      tolerance: null
    };
  }
  if (
    witness.outerSessionId !== null &&
    input.outerSessionId !== null &&
    witness.outerSessionId !== input.outerSessionId
  ) {
    return {
      ...base,
      verdict: 'foreign-session',
      reason: 'the witness names a different harness session, so it says nothing about this one',
      harnessPct: witness.usedPercentage,
      deviation: witness.usedPercentage === null ? null : input.peaksRatio - witness.usedPercentage,
      residual: null,
      tolerance: null
    };
  }

  const harnessPct = witness.usedPercentage;
  const windowTokens = input.peaksWindowTokens;
  const peaksTokens = input.peaksTokens;
  const witnessTokens = witness.usageTokens;
  if (harnessPct === null) {
    return {
      ...base,
      verdict: 'unverifiable',
      reason: unusableReason(witness),
      harnessPct: null,
      deviation: null,
      residual: null,
      tolerance: null
    };
  }
  if (windowTokens === null || windowTokens <= 0 || peaksTokens === null || witnessTokens === null) {
    return {
      ...base,
      verdict: 'unverifiable',
      reason: 'the probe and the witness do not both carry a token snapshot, so the two numbers cannot be shown to describe the same moment',
      harnessPct,
      deviation: input.peaksRatio - harnessPct,
      residual: null,
      tolerance: null
    };
  }

  const deviation = input.peaksRatio - harnessPct;
  // The skew is measured here, not assumed, and it is subtracted rather than
  // granted: see the doc comment above. Signed, so a witness captured before
  // or after the probe is corrected in the direction it is actually off.
  const skewRatio = (peaksTokens - witnessTokens) / windowTokens;
  const residual = deviation - skewRatio;
  const tolerance = witnessToleranceTokens({ windowTokens, usedTokens: peaksTokens }) / windowTokens;

  // The two answers are not symmetric, so they do not share one gate.
  // `disagree` only claims that SOME difference exists, and a residual past the
  // budget is exactly that claim — sound at any ratio, any witness age.
  if (Math.abs(residual) > tolerance) {
    return { ...base, verdict: 'disagree', reason: null, harnessPct, deviation, residual, tolerance };
  }
  // `agree` claims there is no difference, which needs the sample to be sharp
  // enough to support it — see `sampleSupportsAgreement`.
  if (!sampleSupportsAgreement(harnessPct, tolerance)) {
    return {
      ...base,
      verdict: 'unverifiable',
      reason:
        'the witness covers too small a share of the harness window for this sample to separate a real window difference from the budget’s own uncertainty',
      harnessPct,
      deviation,
      residual,
      tolerance
    };
  }
  return { ...base, verdict: 'agree', reason: null, harnessPct, deviation, residual, tolerance };
}

/**
 * One-way sentence for a disagreeing witness. Advising, never asking: an
 * auto-compact observation must never become an `AskUserQuestion` (see
 * `.peaks/memory/auto-compact-threshold-policy.md`).
 *
 * The sentence states the quantity that decided it (the residual, after the
 * measured skew was removed) and the raw harness value with the reading that
 * was taken from it. Both are there so a reader can tell a real denominator
 * difference from a unit misread without going back to the file.
 */
export function describeHarnessWitness(comparison: HarnessWitnessComparison): string | null {
  if (comparison.verdict !== 'disagree') return null;
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
  const skew = comparison.deviation === null || comparison.residual === null
    ? null
    : comparison.deviation - comparison.residual;
  const readAs = comparison.witnessPercentageUnit === null
    ? ''
    : ` (raw ${comparison.witnessRawPercentage}, read as a ${comparison.witnessPercentageUnit})`;
  return `Harness context witness disagrees: the harness reports ${pct(comparison.harnessPct ?? 0)} used${readAs}, `
    + `peaks-loop computes ${pct(comparison.peaksRatio)} (deviation ${pct(Math.abs(comparison.deviation ?? 0))}`
    + `${skew === null ? '' : `, of which the measured sampling skew explains ${pct(Math.abs(skew))}`}, `
    + `leaving ${pct(Math.abs(comparison.residual ?? 0))} against a budget of ${pct(comparison.tolerance ?? 0)}). `
    + 'The two ratios do not share a denominator: '
    + 'peaks-loop\'s configured auto-compact window and the harness\'s effective auto-compact window are '
    + 'different numbers. Nothing is blocked.';
}

/** Convenience for the CLI: read + compare in one call. */
export function readAndCompareHarnessWitness(input: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly peaksRatio: number;
  readonly peaksTokens: number | null;
  readonly peaksWindowTokens: number | null;
  readonly outerSessionId: string | null;
}): HarnessWitnessComparison {
  const read = readHarnessWitness({ projectRoot: input.projectRoot, sessionId: input.sessionId });
  return compareHarnessWitness({
    witness: read.kind === 'valid' ? read.witness : null,
    peaksRatio: input.peaksRatio,
    peaksTokens: input.peaksTokens,
    peaksWindowTokens: input.peaksWindowTokens,
    outerSessionId: input.outerSessionId,
    // Only the reader knows the session directory, so only the reader can tell
    // the two no-file states apart. The third cause is not a directory
    // question — `invalid` IS the fact that a render happened — so it is
    // answered by the read and never falls through to the ternary.
    absentCause: read.kind === 'invalid'
      ? 'unreadable'
      : existsSync(getSessionDir(input.projectRoot, input.sessionId))
        ? 'not-rendered'
        : 'session-dir-missing'
  });
}
