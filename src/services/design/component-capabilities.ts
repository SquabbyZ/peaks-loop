/**
 * `componentCapabilities` — the paved road's machine-readable component list.
 *
 * `design/contract.md` is generated prose and `componentEntrypoints` names only
 * module paths, so nothing in the contract says what a component can express.
 * This optional section carries decidable facts only (enumerated prop values),
 * so a prototype can be rejected when the component library cannot build it.
 * An absent section is a legitimate older contract: it reads as "nothing is
 * filtered", the same reading as `not-applicable`.
 */

import { join } from 'node:path';

import { MAX_SOURCE_BYTES, readCappedText } from './file-cap.js';
import { stringList } from './paved-road.js';

/** One component: where it lives, what it accepts, which tokens it consumes. */
export type ComponentCapability = {
  /** A module path or export name declared in `componentEntrypoints`. */
  entrypoint: string;
  /** Prop name -> the values the component renders. Enumerated props only. */
  props: Record<string, string[]>;
  /** Token names the component consumes inside itself; optional. */
  tokens?: string[];
};

export type ComponentCapabilities = Record<string, ComponentCapability>;

/**
 * `DESIGN_CAPABILITIES_INVALID` is a shape violation (unknown key, a prop that
 * is not a string array, a malformed section); `_UNKNOWN_ENTRYPOINT` is a
 * well-shaped entry that names a module the paved road does not declare.
 */
export type CapabilitiesErrorCode =
  'DESIGN_CAPABILITIES_INVALID' | 'DESIGN_CAPABILITIES_UNKNOWN_ENTRYPOINT';

export type CapabilitiesFailure = { code: CapabilitiesErrorCode; message: string };

export type CapabilitiesVerdict =
  | { ok: true; capabilities: ComponentCapabilities | null }
  | { ok: false; failure: CapabilitiesFailure };

/** The only keys a component entry may carry; anything else is a typo, not data. */
const ENTRY_KEYS = new Set(['entrypoint', 'props', 'tokens']);

function invalid(message: string): CapabilitiesFailure {
  return { code: 'DESIGN_CAPABILITIES_INVALID', message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Every allowed value is a non-blank string; an empty list is allowed. */
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim() !== '')
  );
}

type EntryResult =
  { ok: true; capability: ComponentCapability } | { ok: false; failure: CapabilitiesFailure };

type EntrypointResult =
  { ok: true; entrypoint: string } | { ok: false; failure: CapabilitiesFailure };

type PropsResult =
  { ok: true; props: Record<string, string[]> } | { ok: false; failure: CapabilitiesFailure };

type TokensResult =
  { ok: true; tokens: string[] | undefined } | { ok: false; failure: CapabilitiesFailure };

function readEntrypoint(
  name: string,
  value: unknown,
  entrypoints: readonly string[]
): EntrypointResult {
  if (typeof value !== 'string' || value.trim() === '') {
    return { ok: false, failure: invalid(`${name} entrypoint is not a non-empty string`) };
  }
  if (entrypoints.includes(value)) return { ok: true, entrypoint: value };
  const declared = entrypoints.length === 0 ? 'none declared' : entrypoints.join(', ');
  return {
    ok: false,
    failure: {
      code: 'DESIGN_CAPABILITIES_UNKNOWN_ENTRYPOINT',
      message: `${name} entrypoint "${value}" is not one of componentEntrypoints (${declared})`
    }
  };
}

function readProps(name: string, value: unknown): PropsResult {
  if (!isPlainObject(value)) {
    return { ok: false, failure: invalid(`${name} props is not an object keyed by prop name`) };
  }
  const props: Record<string, string[]> = {};
  for (const [prop, values] of Object.entries(value)) {
    if (!isStringArray(values)) {
      return { ok: false, failure: invalid(`${name} props.${prop} is not a string array`) };
    }
    props[prop] = [...values];
  }
  return { ok: true, props };
}

function readTokens(name: string, value: unknown): TokensResult {
  if (value === undefined) return { ok: true, tokens: undefined };
  if (!isStringArray(value)) {
    return { ok: false, failure: invalid(`${name} tokens is not a string array`) };
  }
  return { ok: true, tokens: [...value] };
}

function validateEntry(
  rawName: string,
  entry: unknown,
  entrypoints: readonly string[]
): EntryResult {
  const name = rawName.trim();
  if (name === '') return { ok: false, failure: invalid('a component name is empty') };
  if (!isPlainObject(entry)) return { ok: false, failure: invalid(`${name} is not an object`) };
  const unknown = Object.keys(entry).filter((key) => !ENTRY_KEYS.has(key));
  if (unknown.length > 0) {
    return { ok: false, failure: invalid(`${name} has unknown key(s): ${unknown.join(', ')}`) };
  }
  const entrypoint = readEntrypoint(name, entry.entrypoint, entrypoints);
  if (!entrypoint.ok) return entrypoint;
  const props = readProps(name, entry.props);
  if (!props.ok) return props;
  const tokens = readTokens(name, entry.tokens);
  if (!tokens.ok) return tokens;
  return {
    ok: true,
    capability: {
      entrypoint: entrypoint.entrypoint,
      props: props.props,
      ...(tokens.tokens === undefined ? {} : { tokens: tokens.tokens })
    }
  };
}

/**
 * The section as a verdict. Absent (or `null`) is not an error — it is the
 * documented "no filtering" contract — and every other malformation is refused
 * by name rather than repaired, because a repaired manifest would silently
 * filter against capabilities the project never declared.
 */
export function validateComponentCapabilities(
  value: unknown,
  entrypoints: readonly string[]
): CapabilitiesVerdict {
  if (value === undefined || value === null) return { ok: true, capabilities: null };
  if (!isPlainObject(value)) {
    return { ok: false, failure: invalid('componentCapabilities is not an object') };
  }
  const capabilities: ComponentCapabilities = {};
  for (const [name, entry] of Object.entries(value)) {
    const result = validateEntry(name, entry, entrypoints);
    if (!result.ok) return { ok: false, failure: result.failure };
    capabilities[name.trim()] = result.capability;
  }
  return { ok: true, capabilities };
}

/** Read `design/paved-road.json` and validate its `componentCapabilities`. */
export function readComponentCapabilities(designRoot: string): CapabilitiesVerdict {
  const read = readCappedText(join(designRoot, 'paved-road.json'));
  if (read.kind === 'missing') return { ok: true, capabilities: null };
  if (read.kind === 'oversize') {
    return {
      ok: false,
      failure: invalid(
        `design/paved-road.json is ${read.bytes} bytes, larger than the ` +
          `${MAX_SOURCE_BYTES}-byte cap`
      )
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    return { ok: false, failure: invalid('design/paved-road.json is not valid JSON') };
  }
  const raw = isPlainObject(parsed) ? parsed : {};
  return validateComponentCapabilities(
    raw.componentCapabilities,
    stringList(raw.componentEntrypoints)
  );
}
