/**
 * api-diff-openapi-schema-read — the schema-node readers behind
 * `api-diff-openapi.ts`.
 *
 * Hoisted verbatim by the wave-5 file-size split
 * (rid 2026-10-01-wave5-w5-2-slice-scan): the `$ref` / composition primitives a
 * schema node is read with, the flat-field-set constants, the content and
 * parameter accessors, and `loadApiDocument` (which the parent re-exports so
 * `./api-diff-openapi.js` stays the public import path). The analysis that
 * *judges* a document — `schemaToTypeString`, `collectFields`,
 * `parseOpenApiDocument`, `splitTopLevel`, `normalizeType` — stays in the
 * parent, because those carry the file's lint findings.
 *
 * The parent <-> sibling import is a deliberate cycle, safe under
 * `module: NodeNext`: every cross-boundary reference is a hoisted function
 * declaration read at call time, never at module init (lint-gate.md 4e).
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

import { ApiDiffInputError, isRecord, type ParsedDocument } from './api-diff-types.js';
import { parseOpenApiDocument, schemaToTypeString } from './api-diff-openapi.js';

const MAX_REF_DEPTH = 4;
/**
 * OpenAPI scalar types mapped to their TypeScript spelling. `integer` is NOT a
 * TypeScript type — an unmapped `integer` produced a false `number -> integer`
 * exact line against a recorded `id: number`.
 */
const SCALAR_TYPES: Readonly<Record<string, string>> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean'
};
const COMPOSITION_KEYS = ['allOf', 'oneOf', 'anyOf'] as const;

function refName(ref: string): string {
  const tail = ref.slice(ref.lastIndexOf('/') + 1);
  return tail.length > 0 ? tail : ref;
}

/** Resolves a `$ref` chain. Callers that only need the NAME must not use this — see `schemaToTypeString`. */
function deref(
  schema: unknown,
  doc: Record<string, unknown>,
  depth: number
): Record<string, unknown> | null {
  if (!isRecord(schema)) return null;
  const ref = schema['$ref'];
  if (typeof ref === 'string' && depth < MAX_REF_DEPTH) {
    let node: unknown = doc;
    for (const part of ref.replace(/^#\//, '').split('/')) {
      if (!isRecord(node)) return null;
      node = node[part];
    }
    return deref(node, doc, depth + 1);
  }
  return schema;
}

/** The composition/open-shape construct a schema node carries, if any — those cannot be flattened without a compiler. */
function unreadableConstruct(node: Record<string, unknown>): string | null {
  for (const key of COMPOSITION_KEYS) {
    const value = node[key];
    if (Array.isArray(value) && value.length > 0) {
      return `it composes schemas with \`${key}\`, which cannot be flattened here`;
    }
  }
  const additional = node['additionalProperties'];
  if (additional !== undefined && additional !== false) {
    return 'it declares `additionalProperties`, so it may carry fields it does not list';
  }
  return null;
}

export { COMPOSITION_KEYS, deref, refName, SCALAR_TYPES, unreadableConstruct };

type SchemaRead = { fields: Map<string, string>; incompleteReason: string | null };

/**
 * Flat leaf fields of a body/response schema. Arrays descend one level into
 * `items`. The ROOT `$ref` is resolved on purpose — a top-level `$ref` response
 * IS the interface — while nested refs stay named (see `schemaToTypeString`).
 *
 * A node carrying `allOf`/`oneOf`/`anyOf` or `additionalProperties` alongside its
 * own `properties` is INCOMPLETE: the sibling properties made the location look
 * non-empty, so there was neither suppression nor a note, and a field declared
 * under `allOf` was reported as an exact `-> (absent)`.
 */
const UNRESOLVED_REF = 'its schema is a `$ref` chain deeper than the reader resolves';
const NO_PROPERTIES = 'its schema lists no `properties`, so no field set could be read from it';

export { NO_PROPERTIES, type SchemaRead, UNRESOLVED_REF };

function jsonContent(content: unknown): unknown {
  if (!isRecord(content)) return undefined;
  if (content['application/json'] !== undefined) return content['application/json'];
  return Object.values(content)[0];
}

function schemaOf(media: unknown): unknown {
  return isRecord(media) ? media['schema'] : undefined;
}

/**
 * The `parameters` array of an OpenAPI object, or `[]` when absent.
 *
 * S10 (2026-09-20): the call sites used to inline
 * `Array.isArray(x['parameters']) ? x['parameters'] : []`, and because
 * `Array.isArray` is typed `arg is any[]` the ternary's type was `any[]` —
 * which then flowed into `collectParameters`. Returning `readonly unknown[]`
 * stops the `any` at this function boundary without asserting anything about
 * the elements: `collectParameters` already narrows each entry itself
 * (`Array.isArray` + `isRecord`), and that is the only place that knows what a
 * parameter may contain.
 */
function parametersOf(record: Record<string, unknown>): readonly unknown[] {
  const value = record['parameters'];
  return Array.isArray(value) ? value : [];
}

function collectParameters(parameters: unknown, locations: Map<string, Map<string, string>>): void {
  if (!Array.isArray(parameters)) return;
  for (const raw of parameters) {
    if (!isRecord(raw)) continue;
    const where = raw['in'];
    const name = raw['name'];
    if (where !== 'path' && where !== 'query') continue;
    if (typeof name !== 'string') continue;
    const key = where === 'path' ? 'pathParams' : 'queryParams';
    const bucket = locations.get(key) ?? new Map<string, string>();
    bucket.set(name, schemaToTypeString(raw['schema'], {}, 0));
    locations.set(key, bucket);
  }
}

export { collectParameters, jsonContent, parametersOf, schemaOf };

/** Reads and parses `.json` / `.yaml` / `.yml`. Throws `ApiDiffInputError` on anything else. */
export function loadApiDocument(file: string): ParsedDocument {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    throw new ApiDiffInputError('UNREADABLE', `cannot read ${file}: ${(error as Error).message}`);
  }
  const lower = file.toLowerCase();
  let parsed: unknown;
  try {
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) parsed = parseYaml(raw);
    else if (lower.endsWith('.json') || raw.trimStart().startsWith('{')) parsed = JSON.parse(raw);
    else parsed = parseYaml(raw);
  } catch (error) {
    throw new ApiDiffInputError(
      'PARSE_FAILED',
      `cannot parse ${file} as JSON or YAML: ${(error as Error).message}`
    );
  }
  if (!isRecord(parsed)) {
    throw new ApiDiffInputError('NOT_AN_OBJECT', `${file} did not parse to an object`);
  }
  return parseOpenApiDocument(file, parsed);
}
