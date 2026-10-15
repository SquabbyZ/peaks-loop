/**
 *
 * Reads and validates the `--lookup-results <file>` document that lets a
 * caller — in practice the LLM, holding real Context7 / WebSearch results from
 * its own MCP tool — inject real documentation fragments into
 * `best-practice-scan`. The CLI itself never performs that lookup and never
 * touches the network; this module is the only seam between the two.
 *
 * The document speaks the scan seam's own vocabulary: one optional key per
 * priority, whose value is exactly `LookupFn`'s return type.
 *
 *   { "intent": "<the same string that was passed to --intent>",
 *     "context7":  { "ok": true,  "results": [ { "title", "url", "snippet" } ] },
 *     "websearch": { "ok": true,  "results": [ { "title", "url", "snippet" } ] } }
 *
 * One refusal code, `BEST_PRACTICE_SCAN_INVALID_RESULTS`. A file that breaks
 * any rule performs no scan and writes no artifact — the caller is the LLM,
 * which either produced a valid file or needs to be told which field is wrong.
 *
 * `ok: true` requires a non-empty `results` array: a claimed hit that carries
 * nothing is the shape a fabrication would take, and it is refused rather than
 * rendered. **The converse is not a miss.** `ok: false` does not end the scan —
 * the orchestrator falls *through* a failed priority to the next one, and a
 * chain in which no stub took part reports `synthetic: false` even when it
 * found nothing. A document declaring `ok: false` on every seam it supplies is
 * therefore valid *and* fragments-free, and the CLI — not this module — is
 * where a fragments-free scan is refused. (`best-practice-scan-command.ts`.)
 *
 * Unknown keys are refused at every level, not just the top: the document is
 * the caller's, and a key this module would ignore is a key the caller believed
 * it was sending. Refusing them also bounds the parsed structure, so nothing
 * downstream can be handed an arbitrarily deep object.
 */
import { readFileSync, statSync } from 'node:fs';

import type { LookupFn } from '../../services/best-practice/scan-orchestrator.js';
import { fail, redactSensitiveErrorMessage } from 'peaks-loop-shared/result';

import {
  getErrorMessage,
  printableWarningText,
  printResult,
  type ProgramIO
} from '../cli-helpers.js';

/** The two seam keys a document may carry, named as the orchestrator names them. */
const SEAM_KEYS = ['context7', 'websearch'] as const;
type SeamKey = (typeof SEAM_KEYS)[number];

const ALLOWED_KEYS: readonly string[] = ['intent', ...SEAM_KEYS];
const ALLOWED_SEAM_KEYS: readonly string[] = ['ok', 'results'];
const ALLOWED_FRAGMENT_KEYS: readonly string[] = ['title', 'url', 'snippet'];

const INVALID_RESULTS_CODE = 'BEST_PRACTICE_SCAN_INVALID_RESULTS';

/** A best-practice scan cites a handful of fragments; it does not ingest a corpus. */
const MAX_RESULTS_FILE_BYTES = 1_048_576;
const MAX_FRAGMENTS_PER_SEAM = 64;
const BOM_CODE_POINT = 0xfeff;

/** The scan seam's two optional lookups, ready to spread into `ScanOptions`. */
export type InjectedLookups = {
  context7Lookup?: LookupFn;
  webSearchLookup?: LookupFn;
};

type LookupOutcome = {
  readonly ok: boolean;
  readonly results: readonly {
    readonly title: string;
    readonly url: string;
    readonly snippet: string;
  }[];
};

type ParseOutcome =
  | { readonly ok: true; readonly lookups: InjectedLookups }
  | { readonly ok: false; readonly message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The first key of `value` that is not in `allowed`, or `undefined`.
 *
 * The NAME comes back sanitised for echoing, and that is deliberate: every
 * caller of this function puts the key into a refusal message, the key is the
 * document's own text, and nothing stops it carrying an ESC sequence (which
 * reaches a terminal raw) or a newline (which forges a line of this command's
 * own output). Matching is done against the raw key first, so the allowance
 * check is unaffected.
 */
function firstUnknownKey(
  value: Record<string, unknown>,
  allowed: readonly string[]
): string | undefined {
  const key = Object.keys(value).find((candidate) => !allowed.includes(candidate));
  return key === undefined ? undefined : safeToEcho(key);
}

function isFragment(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (firstUnknownKey(value, ALLOWED_FRAGMENT_KEYS) !== undefined) return false;
  return ALLOWED_FRAGMENT_KEYS.every((field) => {
    const candidate = value[field];
    return typeof candidate === 'string' && candidate.trim().length > 0;
  });
}

/** The first malformed fragment, as its refusal message; `null` when all are well formed. */
function firstBadFragment(key: SeamKey, results: readonly unknown[]): string | null {
  for (let index = 0; index < results.length; index += 1) {
    if (!isFragment(results[index])) {
      return `"${key}".results[${index}] must have non-empty string title, url and snippet, and no other keys`;
    }
  }
  return null;
}

/** `{ ok: boolean, results: unknown[] }`, the only seam value shape accepted. */
function isSeamShape(value: unknown): value is { ok: boolean; results: unknown[] } {
  return isPlainObject(value) && typeof value.ok === 'boolean' && Array.isArray(value.results);
}

/** Rules 6-8: one seam value must be `{ ok: boolean, results: DocFragment[] }`. */
function parseSeam(
  key: SeamKey,
  value: unknown
): { ok: true; value: LookupOutcome } | { ok: false; message: string } {
  if (!isSeamShape(value)) {
    return {
      ok: false,
      message: `"${key}" must be an object with a boolean "ok" and an array "results"`
    };
  }
  const unknownKey = firstUnknownKey(value, ALLOWED_SEAM_KEYS);
  if (unknownKey !== undefined) {
    return {
      ok: false,
      message: `unknown key "${unknownKey}" in "${key}"; allowed keys are ${ALLOWED_SEAM_KEYS.join(', ')}`
    };
  }
  const results: readonly unknown[] = value.results;
  if (value.ok && results.length === 0) {
    return {
      ok: false,
      message: `"${key}" declares ok: true but "results" is empty; a hit must carry at least one fragment`
    };
  }
  // Kept deliberately (Karpathy V2 raised it as speculative): `ok: false` with a
  // non-empty `results` is a document that contradicts itself, and the
  // orchestrator would read `ok` and silently discard the fragments. A caller
  // that meant `ok: true` and mistyped it must be told, not half-read.
  if (!value.ok && results.length > 0) {
    return {
      ok: false,
      message: `"${key}" declares ok: false but "results" is non-empty`
    };
  }
  if (results.length > MAX_FRAGMENTS_PER_SEAM) {
    return {
      ok: false,
      message: `"${key}" carries ${results.length} fragments, over the cap of ${MAX_FRAGMENTS_PER_SEAM}; cite the few that matter`
    };
  }
  const bad = firstBadFragment(key, results);
  if (bad !== null) return { ok: false, message: bad };
  return {
    ok: true,
    value: { ok: value.ok, results: results as LookupOutcome['results'] }
  };
}

/** Rules 2-8 over an already-parsed JSON value. Pure: no fs, no io. */
function parseLookupResults(value: unknown, intent: string): ParseOutcome {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      message: `the top level must be a JSON object, not ${Array.isArray(value) ? 'an array' : typeof value}`
    };
  }
  const unknownKey = firstUnknownKey(value, ALLOWED_KEYS);
  if (unknownKey !== undefined) {
    return {
      ok: false,
      message: `unknown top-level key "${unknownKey}"; allowed keys are ${ALLOWED_KEYS.join(', ')}`
    };
  }
  const present = SEAM_KEYS.filter((key) => value[key] !== undefined);
  if (present.length === 0) {
    return { ok: false, message: 'at least one of "context7" or "websearch" must be present' };
  }
  if (value.intent !== intent) {
    const declared = typeof value.intent === 'string' ? safeToEcho(value.intent) : value.intent;
    return {
      ok: false,
      message: `intent mismatch: the file declares ${JSON.stringify(declared)} but --intent is ${JSON.stringify(safeToEcho(intent))}`
    };
  }

  const lookups: InjectedLookups = {};
  for (const key of present) {
    const parsed = parseSeam(key, value[key]);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    const seam = parsed.value;
    if (key === 'context7') {
      lookups.context7Lookup = async () => seam;
    } else {
      lookups.webSearchLookup = async () => seam;
    }
  }
  return { ok: true, lookups };
}

/** A caller-supplied string is echoed into a refusal; make it safe to echo. */
function safeToEcho(value: string): string {
  return printableWarningText(redactSensitiveErrorMessage(value));
}

/**
 * Rule 1 plus the refusal. Returns the injected seam lookups, or `null` after
 * emitting `BEST_PRACTICE_SCAN_INVALID_RESULTS` — in which case the caller must
 * set a non-zero exit code and scan nothing.
 */
export function readLookupResultsOrFail(
  file: string,
  intent: string,
  io: ProgramIO,
  asJson: boolean
): InjectedLookups | null {
  const read = readJsonOrFail(file);
  const parsed: ParseOutcome = read.ok
    ? parseLookupResults(read.value, intent)
    : { ok: false, message: read.message };

  if (parsed.ok) return parsed.lookups;

  printResult(
    io,
    fail(
      'best-practice.scan',
      INVALID_RESULTS_CODE,
      parsed.message,
      { lookupResults: safeToEcho(file), intent: safeToEcho(intent) },
      ['Fix the lookup-results file, or rerun without --lookup-results to record the honest skip.']
    ),
    asJson
  );
  return null;
}

type ReadOutcome =
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly message: string };

/** Rule 1: read the file and parse it as JSON, or say why not. */
function readJsonOrFail(file: string): ReadOutcome {
  const shown = safeToEcho(file);
  // The size gate runs BEFORE the read so an oversized file is never read, and
  // before the parse so it is never parsed.
  let size: number;
  try {
    size = statSync(file).size;
  } catch (err) {
    return {
      ok: false,
      message: `cannot read lookup-results file at ${shown}: ${safeToEcho(getErrorMessage(err))}`
    };
  }
  if (size > MAX_RESULTS_FILE_BYTES) {
    return {
      ok: false,
      message:
        `${shown} is ${size} bytes, over the ${MAX_RESULTS_FILE_BYTES}-byte cap for a ` +
        'lookup-results file; cite a handful of fragments, not a corpus'
    };
  }
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    return {
      ok: false,
      message: `cannot read lookup-results file at ${shown}: ${safeToEcho(getErrorMessage(err))}`
    };
  }
  // A BOM is what several editors and PowerShell redirection write on Windows;
  // JSON.parse rejects it, so a correct file would read as malformed.
  const text = raw.charCodeAt(0) === BOM_CODE_POINT ? raw.slice(1) : raw;
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // Deliberately not echoing the parser's message: V8 quotes ~10 bytes of the
    // file back, which leaks file content past `fail()`'s secret redaction, and
    // copies control bytes to a terminal verbatim.
    return { ok: false, message: `${shown} is not valid JSON` };
  }
}
