/**
 * Parameter-injection guard for the read-only surface.
 *
 * THE ATTACK. An argv template has placeholder slots (`request show <rid>`). If a
 * placeholder value is pasted into a command LINE, the value `--apply` stops being
 * a request id and becomes a flag - the semantics of the call are inverted by its
 * own data. Two independent defences, both required (spec §8.1):
 *
 *   1. TYPE WHITELIST - every placeholder declares a type, and the value must
 *      satisfy it. No type admits a leading `-`, so a flag-shaped value is never a
 *      legal value of any placeholder.
 *   2. ARRAY PASSING - `buildArgv` returns `string[]`. The caller passes the array
 *      to the process API with shell parsing disabled (`readonlySpawnOptions`), so
 *      no value is ever re-tokenized by a shell.
 *
 * Defence 2 alone is not enough: `spawn(..., {shell:false})` still hands `--apply`
 * to the CLI as a real flag. Defence 1 alone is not enough: a caller that joins
 * the array into a string reintroduces the shell. Hence both.
 */
import { isAbsolute } from 'node:path';

import type { PlaceholderSpec, ReadOnlyWhitelistEntry } from './readonly-whitelist.js';

/** Fallback pattern for a `slug` placeholder that declares none. */
const DEFAULT_SLUG_PATTERN = '^[a-z0-9][a-z0-9-]*$';

/** Upper bound on any single placeholder value, whatever its type. */
export const READONLY_VALUE_MAX_LENGTH = 200;

export type GuardRejection = {
  readonly ok: false;
  readonly param: string;
  readonly code: GuardRejectionCode;
  readonly message: string;
};

export type GuardRejectionCode =
  | 'NOT_A_STRING'
  | 'EMPTY'
  | 'TOO_LONG'
  | 'FLAG_SHAPED'
  | 'CONTROL_CHARACTER'
  | 'WHITESPACE'
  | 'PATTERN_MISMATCH'
  | 'NOT_IN_ENUM'
  | 'NOT_AN_INTEGER'
  | 'OUT_OF_RANGE'
  | 'NOT_ABSOLUTE';

export type GuardResult = { readonly ok: true; readonly value: string } | GuardRejection;

/** The process options that keep the array from being re-parsed by a shell. */
export function readonlySpawnOptions(): { readonly shell: false } {
  return { shell: false };
}

function reject(param: string, code: GuardRejectionCode, message: string): GuardRejection {
  return { ok: false, param, code, message };
}

/**
 * Control characters, matched by Unicode category rather than by a literal range:
 * a hand-written `\x00-\x1f` class is a lint error (`no-control-regex`) precisely
 * because such a range in a pattern is usually a bug, and `\p{Cc}` says what is
 * meant without spelling out code points.
 */
function hasControlCharacter(value: string): boolean {
  return /\p{Cc}/u.test(value);
}

/**
 * The rules that hold for EVERY type, before any type-specific rule runs. A
 * leading `-` is refused here, so no type can carry a flag into the argv.
 */
function precheckCommon(param: string, raw: unknown): GuardResult {
  if (typeof raw !== 'string') {
    return reject(param, 'NOT_A_STRING', `Parameter ${param} must be a string.`);
  }
  if (raw.length === 0) return reject(param, 'EMPTY', `Parameter ${param} must not be empty.`);
  if (raw.length > READONLY_VALUE_MAX_LENGTH) {
    return reject(
      param,
      'TOO_LONG',
      `Parameter ${param} exceeds ${READONLY_VALUE_MAX_LENGTH} characters.`
    );
  }
  if (raw.startsWith('-')) {
    return reject(param, 'FLAG_SHAPED', `Parameter ${param} must not look like a flag: ${raw}`);
  }
  if (hasControlCharacter(raw)) {
    return reject(
      param,
      'CONTROL_CHARACTER',
      `Parameter ${param} must not contain control characters.`
    );
  }
  return { ok: true, value: raw };
}

function checkToken(param: string, value: string): GuardResult {
  if (/\s/.test(value)) {
    return reject(param, 'WHITESPACE', `Parameter ${param} must be a single token.`);
  }
  return { ok: true, value };
}

function checkSlug(param: string, value: string, spec: PlaceholderSpec): GuardResult {
  const asToken = checkToken(param, value);
  if (!asToken.ok) return asToken;
  const pattern = new RegExp(spec.pattern ?? DEFAULT_SLUG_PATTERN);
  if (!pattern.test(value)) {
    return reject(
      param,
      'PATTERN_MISMATCH',
      `Parameter ${param} must match ${pattern.source}: ${value}`
    );
  }
  return { ok: true, value };
}

function checkEnum(param: string, value: string, spec: PlaceholderSpec): GuardResult {
  if (spec.values === undefined || !spec.values.includes(value)) {
    return reject(
      param,
      'NOT_IN_ENUM',
      `Parameter ${param} must be one of: ${(spec.values ?? []).join(', ')}`
    );
  }
  return { ok: true, value };
}

function checkInteger(param: string, value: string, spec: PlaceholderSpec): GuardResult {
  if (!/^[0-9]+$/.test(value)) {
    return reject(param, 'NOT_AN_INTEGER', `Parameter ${param} must be an integer: ${value}`);
  }
  const parsed = Number.parseInt(value, 10);
  const min = spec.min ?? 0;
  const max = spec.max ?? Number.MAX_SAFE_INTEGER;
  if (parsed < min || parsed > max) {
    return reject(param, 'OUT_OF_RANGE', `Parameter ${param} must be between ${min} and ${max}.`);
  }
  return { ok: true, value };
}

function checkPath(param: string, value: string): GuardResult {
  // Spaces are legal in a path and irrelevant under array passing; the absolute
  // check is what keeps `--apply` and a bare word out.
  if (!isAbsolute(value)) {
    return reject(param, 'NOT_ABSOLUTE', `Parameter ${param} must be an absolute path.`);
  }
  return { ok: true, value };
}

const TYPE_CHECKS: Readonly<
  Record<
    PlaceholderSpec['type'],
    (param: string, value: string, spec: PlaceholderSpec) => GuardResult
  >
> = {
  token: (param, value) => checkToken(param, value),
  slug: (param, value, spec) => checkSlug(param, value, spec),
  enum: (param, value, spec) => checkEnum(param, value, spec),
  integer: (param, value, spec) => checkInteger(param, value, spec),
  path: (param, value) => checkPath(param, value)
};

/** Validate one placeholder value against its spec. */
export function validatePlaceholderValue(
  param: string,
  spec: PlaceholderSpec,
  raw: unknown
): GuardResult {
  const prechecked = precheckCommon(param, raw);
  if (!prechecked.ok) return prechecked;
  return TYPE_CHECKS[spec.type](param, prechecked.value, spec);
}

export type BuildArgvResult = { readonly ok: true; readonly argv: string[] } | GuardRejection;

function missingParam(param: string): GuardRejection {
  return reject(param, 'EMPTY', `Parameter ${param} was not supplied.`);
}

/** A value is required for every placeholder present in the template. */
function resolveParamValue(
  param: string,
  declared: PlaceholderSpec | undefined,
  values: Readonly<Record<string, string>>
): GuardResult {
  if (declared === undefined) return missingParam(param);
  const supplied = values[param];
  // Every placeholder in this surface is required (introspected), and a missing
  // OPTIONAL value could only be honoured by also dropping the flag literal the
  // loop has already pushed. Refusing is the honest answer.
  if (supplied === undefined) return missingParam(param);
  return validatePlaceholderValue(param, declared, supplied);
}

function unknownParams(
  entry: ReadOnlyWhitelistEntry,
  values: Readonly<Record<string, string>>
): GuardRejection | undefined {
  for (const name of Object.keys(values)) {
    if (!(name in entry.params)) {
      return reject(name, 'NOT_A_STRING', `Entry ${entry.id} declares no parameter ${name}.`);
    }
  }
  return undefined;
}

/**
 * Render a whitelist entry into a concrete argv ARRAY.
 *
 * The output is never a string: literals and validated values are pushed as
 * separate elements, so no value can contribute token boundaries. A parameter the
 * entry does not declare is refused rather than appended.
 */
export function buildArgv(
  entry: ReadOnlyWhitelistEntry,
  values: Readonly<Record<string, string>>
): BuildArgvResult {
  const unexpected = unknownParams(entry, values);
  if (unexpected !== undefined) return unexpected;

  const argv: string[] = [];
  for (const segment of entry.argv) {
    if (segment.kind === 'literal') {
      argv.push(segment.value);
      continue;
    }
    const resolved = resolveParamValue(segment.name, entry.params[segment.name], values);
    if (!resolved.ok) return resolved;
    argv.push(resolved.value);
  }
  return { ok: true, argv };
}
