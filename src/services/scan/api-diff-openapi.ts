/**
 * S1 / rid=api-diff-report — OpenAPI 3.x parsing for `peaks scan api-diff`.
 *
 * `.json` via `JSON.parse`; `.yaml` / `.yml` via the `yaml` runtime dependency.
 * A document that is not OpenAPI 3.x, or that declares no operations, raises
 * `ApiDiffInputError` — the command must never print an empty-but-successful
 * diff.
 *
 * THE SAME INVERTED COMPLETENESS RULE THE RECORDED SIDE GETS APPLIES HERE
 * (QA final gate): `collectFields` returns a *partial* field set just as easily
 * as a complete one, and the two are indistinguishable downstream. Any schema
 * construct this reader cannot fully account for marks its LOCATION as
 * incomplete, which suppresses every exact line for that location. Partial is
 * never presented as complete.
 */

import {
  ApiDiffInputError,
  HTTP_METHODS,
  isRecord,
  type DocOperation,
  type ParsedDocument
} from './api-diff-types.js';
import {
  collectParameters,
  COMPOSITION_KEYS,
  deref,
  jsonContent,
  loadApiDocument,
  NO_PROPERTIES,
  parametersOf,
  refName,
  SCALAR_TYPES,
  type SchemaRead,
  schemaOf,
  unreadableConstruct,
  UNRESOLVED_REF
} from './api-diff-openapi-schema-read.js';

export { loadApiDocument };

/**
 * Renders an OpenAPI schema as a TypeScript-ish type text. Arrays render as
 * `Array<X>` (not `X[]`) on purpose: `normalizeType` rewrites both sides
 * identically, so a recorded `X[]` and a document `Array<X>` still compare equal.
 *
 * A `$ref` is answered with its referenced NAME and never dereferenced. Checking
 * after `deref()` made `refName` unreachable for every ref inside
 * `MAX_REF_DEPTH`, so a nested `owner: {$ref: User}` was reported as `object`
 * against a recorded `owner: User` — an exact line for a field that did not
 * change. The name is the faithful reading, and it is what a recorded interface
 * writes.
 */
function schemaToTypeString(schema: unknown, doc: Record<string, unknown>, depth: number): string {
  if (isRecord(schema) && typeof schema['$ref'] === 'string') {
    const named = refName(schema['$ref']);
    return schema['nullable'] === true ? `${named} | null` : named;
  }
  const node = deref(schema, doc, depth);
  if (!node) return 'unknown';

  const nullable = node['nullable'] === true;
  const enumValues = node['enum'];
  let base: string;
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    base = enumValues
      .map((value) => (typeof value === 'string' ? JSON.stringify(value) : String(value)))
      .join(' | ');
  } else if (
    COMPOSITION_KEYS.some((key) => Array.isArray(node[key]) && (node[key] as unknown[]).length > 0)
  ) {
    const key = COMPOSITION_KEYS.find((candidate) => Array.isArray(node[candidate]))!;
    const variants = node[key] as unknown[];
    const glue = key === 'allOf' ? ' & ' : ' | ';
    base = variants.map((variant) => schemaToTypeString(variant, doc, depth + 1)).join(glue);
  } else if (Array.isArray(node['type'])) {
    // OpenAPI 3.1 spells nullability as `type: ['string', 'null']`. The same
    // SCALAR_TYPES mapping must apply here — joining with bare `String(entry)`
    // leaked an unmapped `integer`, which this file's own comment records as a
    // source of false `number -> integer` exact lines.
    base = (node['type'] as unknown[])
      .map((entry) =>
        typeof entry === 'string' && SCALAR_TYPES[entry] !== undefined
          ? SCALAR_TYPES[entry]
          : String(entry)
      )
      .join(' | ');
  } else {
    const type = node['type'];
    if (type === 'array') {
      const items = node['items'];
      base = `Array<${items === undefined ? 'unknown' : schemaToTypeString(items, doc, depth + 1)}>`;
    } else if (type === 'object') {
      base = 'object';
    } else if (typeof type === 'string' && SCALAR_TYPES[type] !== undefined) {
      base = SCALAR_TYPES[type]!;
    } else {
      base = 'unknown';
    }
  }

  return nullable ? `${base} | null` : base;
}

export { schemaToTypeString };

function collectFields(schema: unknown, doc: Record<string, unknown>): SchemaRead {
  const fields = new Map<string, string>();
  const node = deref(schema, doc, 0);
  if (!node) return { fields, incompleteReason: 'its schema could not be read' };
  if (typeof node['$ref'] === 'string') return { fields, incompleteReason: UNRESOLVED_REF };

  const rootIssue = unreadableConstruct(node);
  if (rootIssue !== null) return { fields, incompleteReason: rootIssue };

  let target = node;
  if (target['type'] === 'array' || target['items'] !== undefined) {
    const items = deref(target['items'], doc, 0);
    if (!items) return { fields, incompleteReason: 'its array items schema could not be read' };
    if (typeof items['$ref'] === 'string') return { fields, incompleteReason: UNRESOLVED_REF };
    const itemsIssue = unreadableConstruct(items);
    if (itemsIssue !== null) return { fields, incompleteReason: itemsIssue };
    target = items;
  }

  const properties = target['properties'];
  // An ABSENT `properties` is not an empty field set: it is a schema this reader
  // cannot produce a field set from at all. Returning `{fields: {}, null}` here
  // dropped the whole location, which is the "empty result treated as a
  // successful one" failure the inverted rule exists to prevent — and dropping
  // a readable `200` also let a `*Response` interface be compared against a
  // surviving `404`, defeating the multi-status guard.
  if (!isRecord(properties)) return { fields, incompleteReason: NO_PROPERTIES };

  // Per OpenAPI, OMITTING `required` means every property is optional — which is
  // how `openapi-typescript` renders it (`id?: T`). Treating an absent
  // `required` as "everything is required" produced false
  // `string | undefined -> string` lines against generated recordings.
  const requiredRaw = target['required'];
  const required = Array.isArray(requiredRaw)
    ? new Set(requiredRaw.filter((entry): entry is string => typeof entry === 'string'))
    : new Set<string>();
  for (const [key, propSchema] of Object.entries(properties)) {
    const type = schemaToTypeString(propSchema, doc, 1);
    fields.set(key, required.has(key) ? type : `${type} | undefined`);
  }
  return { fields, incompleteReason: null };
}

export function parseOpenApiDocument(file: string, doc: Record<string, unknown>): ParsedDocument {
  const version = doc['openapi'];
  if (typeof version !== 'string' || !/^3\.\d+/.test(version.trim())) {
    throw new ApiDiffInputError(
      'NOT_OPENAPI_3',
      `${file} is not an OpenAPI 3.x document (expected a top-level \`openapi: 3.x\` string, found ${
        version === undefined ? 'nothing' : JSON.stringify(version)
      })`
    );
  }
  const paths = doc['paths'];
  if (!isRecord(paths)) {
    throw new ApiDiffInputError(
      'NO_PATHS',
      `${file} declares openapi ${version} but has no \`paths\` object — nothing to diff`
    );
  }

  const operations: DocOperation[] = [];
  for (const [path, pathItemRaw] of Object.entries(paths)) {
    const pathItem = deref(pathItemRaw, doc, 0);
    if (!pathItem) continue;
    for (const method of HTTP_METHODS) {
      const opRaw = pathItem[method];
      if (!isRecord(opRaw)) continue;
      const locations = new Map<string, Map<string, string>>();
      const locationIssues = new Map<string, string>();
      const record = (location: string, read: SchemaRead): void => {
        if (read.fields.size === 0 && read.incompleteReason === null) return;
        locations.set(location, read.fields);
        if (read.incompleteReason !== null) locationIssues.set(location, read.incompleteReason);
      };

      const shared = parametersOf(pathItem);
      const own = parametersOf(opRaw);
      collectParameters([...shared, ...own], locations);

      const requestBody = opRaw['requestBody'];
      const bodySchema = schemaOf(
        jsonContent(isRecord(requestBody) ? requestBody['content'] : undefined)
      );
      if (bodySchema !== undefined) record('request', collectFields(bodySchema, doc));

      const responses = opRaw['responses'];
      if (isRecord(responses)) {
        for (const [status, responseRaw] of Object.entries(responses)) {
          if (!isRecord(responseRaw)) continue;
          const responseSchema = schemaOf(jsonContent(responseRaw['content']));
          if (responseSchema === undefined) continue;
          record(`response.${status}`, collectFields(responseSchema, doc));
        }
      }

      const operationId =
        typeof opRaw['operationId'] === 'string' ? opRaw['operationId'] : undefined;
      operations.push(
        operationId === undefined
          ? { method, path, locations, locationIssues }
          : { method, path, operationId, locations, locationIssues }
      );
    }
  }

  if (operations.length === 0) {
    throw new ApiDiffInputError(
      'NO_OPERATIONS',
      `${file} is an OpenAPI ${version} document but declares no operations — refusing to print an empty diff`
    );
  }

  const info = doc['info'];
  const title = isRecord(info) && typeof info['title'] === 'string' ? info['title'] : undefined;
  return title === undefined
    ? { openapi: version, operations }
    : { openapi: version, title, operations };
}

/** Splits on a separator that sits at bracket depth 0, leaving `("a" | "b")[]` and `Record<string, number>` intact. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inString: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString !== null) {
      if (ch === '\\') {
        current += ch + (text[i + 1] ?? '');
        i += 1;
        continue;
      }
      if (ch === inString) inString = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (depth === 0 && text.startsWith(separator, i)) {
      parts.push(current);
      current = '';
      i += separator.length - 1;
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Normalizes type text so `Array<string>`, `string[]`, `string | null` and
 * `string|null` compare equal.
 *
 * Quote style is unified because it is a RENDERING artifact, not a change: the
 * document renders enums via `JSON.stringify` (`"a"`) while hand-written
 * recorded types use single quotes (`'a'`), so the same project written with
 * double quotes emitted nothing and with single quotes emitted an exact
 * CHANGED. Duplicate union members are collapsed for the same reason — a
 * recorded `a?: X` normalises to `X | undefined`, which against a document's
 * `X | undefined` used to become `X | undefined | undefined`.
 */
export function normalizeType(text: string): string {
  let out = text
    .trim()
    .replace(/[;,]\s*$/, '')
    .replace(/\s+/g, ' ');
  out = out.replace(/'([^'\\]*)'/g, '"$1"');
  out = out.replace(/\s*\|\s*/g, ' | ').replace(/\s*&\s*/g, ' & ');
  const union = splitTopLevel(out, ' | ');
  if (union.length > 1) out = [...new Set(union)].join(' | ');
  out = out.replace(/\s*\[\s*\]/g, '[]');
  for (let pass = 0; pass < 3; pass += 1) {
    out = out.replace(/Array<([^<>]*)>/g, (_all, inner: string) =>
      /[|&]/.test(inner) ? `(${inner})[]` : `${inner}[]`
    );
  }
  out = out.replace(/\s*<\s*/g, '<').replace(/\s*>\s*/g, '>');
  return out.trim();
}
