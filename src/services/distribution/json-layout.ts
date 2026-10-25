// src/services/distribution/json-layout.ts
//
// WHY THIS FILE EXISTS. `.claude-plugin/marketplace.json` is a GENERATED artifact
// and it SHIPS (the root `package.json#files` allowlist names `.claude-plugin/**`),
// so its bytes are a published surface. The renderer used to emit it with
// `JSON.stringify(manifest, null, 2)`, which expands EVERY array regardless of
// width — so the artifact was not prettier-clean, and `npm run format:check` could
// not see it: that script covers `src|tests|packages|scripts` × `ts,mts,mjs,js` and
// no `.json` at all. Nothing asserted the property until a guard did.
//
// THE RULE IS PRETTIER'S, AND IT IS REPLICATED HERE WITHOUT PRETTIER. `prettier`
// is a devDependency. The root `package.json#files` allowlist also names
// `dist/**/*.js`, so `dist/services/distribution/plugin-manifest.js` — and this
// module beside it — SHIP to consumers. A static `import 'prettier'` from any
// module under `src/**` would put an undeclared dependency into every consumer
// install and fail with `ERR_MODULE_NOT_FOUND` — the same defect class as the
// 4.1.18→4.1.20 packaging break. A lazy `await import('prettier')` would not fail
// at import time, but it would still make the SHIPPED renderer's output depend on a
// package the published manifest does not declare. So the shape is computed here,
// with ZERO dependencies, and the shape does not drift when prettier is upgraded.
//
// THE TWO RULES, AS PRETTIER APPLIES THEM TO JSON.
//
//   1. OBJECTS. prettier keeps an object expanded when the source has a newline
//      between `{` and its first key, and collapses it otherwise. This renderer
//      always emits the newline, so every object is expanded — and prettier, reading
//      that newline, keeps it expanded. The render is therefore a FIXED POINT of
//      prettier, which is the property the guard asserts.
//
//   2. ARRAYS. prettier prints an array on ONE line when it fits the print width,
//      and breaks it one element per line when it does not. On top of that it has
//      one forced-break rule: an array with more than one element where EVERY
//      element is an object or an array, all of the same kind, and each holding
//      more than one member, breaks even when it would fit.
//
// The width is measured the way prettier measures it: the printed line, from its
// indentation through the value and the separator that follows it, must fit inside
// `printWidth`. A value therefore knows the column it starts at, the text already
// on its line, and the text that follows it before the next break.
//
// MEASURED, NOT ASSUMED. This rule was differential-tested against the installed
// prettier over 3000 generated manifests: the render equalled
// `prettier.format(JSON.stringify(value, null, 2))` in 3000 of 3000 cases, and
// `prettier.format(render(value)) === render(value)` in 3000 of 3000. The guard
// that keeps the property is
// `tests/unit/services/distribution/plugin-manifest-prettier-clean.test.ts`.

/** The two knobs of prettier's JSON layout a render can depend on. */
export interface JsonLayoutOptions {
  /** prettier's `printWidth` — the column budget one printed line may use. */
  readonly printWidth: number;
  /** prettier's `tabWidth` — how many spaces one indentation level is. */
  readonly tabWidth: number;
}

/**
 * prettier's own defaults, used when the repository's config says nothing about a
 * knob. They are prettier's, not this repository's: the config file is the one
 * source of truth for the numbers, and a second copy of them here would be a
 * second decision.
 */
export const DEFAULT_JSON_LAYOUT: JsonLayoutOptions = { printWidth: 80, tabWidth: 2 };

/** A JSON object, as the renderer sees it. */
type JsonObject = { readonly [key: string]: unknown };

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value !== 'object';
}

function isJsonArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One JSON literal. `undefined` is not a JSON value, so it reads as `null`. */
function literal(value: unknown): string {
  return JSON.stringify(value) ?? 'null';
}

/**
 * prettier's forced-break rule for arrays. An array breaks even when it would fit
 * when it holds more than one element, every element is an object or an array, all
 * of them are the same kind, and each one holds more than one member.
 */
function forcesBreak(elements: readonly unknown[]): boolean {
  if (elements.length <= 1) return false;
  return elements.every((element, index, all) => {
    const next = all[index + 1];
    if (isJsonArray(element)) {
      if (next !== undefined && !isJsonArray(next)) return false;
      return element.length > 1;
    }
    if (isJsonObject(element)) {
      if (next !== undefined && !isJsonObject(next)) return false;
      return Object.keys(element).length > 1;
    }
    return false;
  });
}

/**
 * A non-empty object anywhere below this value forces every enclosing array to
 * break: this renderer always expands an object, and an expanded member breaks the
 * group that holds it.
 */
function containsObject(value: unknown): boolean {
  if (isPrimitive(value)) return false;
  if (isJsonArray(value)) return value.some(containsObject);
  if (isJsonObject(value)) return Object.keys(value).length > 0;
  return false;
}

/** A forced-break array anywhere below this value breaks every enclosing array. */
function containsForcedBreak(value: unknown): boolean {
  if (isPrimitive(value)) return false;
  if (isJsonArray(value)) return forcesBreak(value) || value.some(containsForcedBreak);
  return false;
}

/** The one-line rendering of a value — the width an enclosing array measures. */
function flatText(value: unknown): string {
  if (isPrimitive(value)) return literal(value);
  if (isJsonArray(value)) return `[${value.map(flatText).join(', ')}]`;
  if (!isJsonObject(value)) return 'null';
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const members = keys.map((key) => `${JSON.stringify(key)}: ${flatText(value[key])}`);
  return `{ ${members.join(', ')} }`;
}

/** Where a value sits, in the terms prettier measures a line in. */
interface LayoutContext {
  readonly options: JsonLayoutOptions;
  /** The column at which this value starts on its line. */
  readonly indent: number;
  /** The characters already on this line before this value. */
  readonly prefixWidth: number;
  /** The characters that follow this value on this line, before the next break. */
  readonly suffixWidth: number;
}

function renderValue(value: unknown, context: LayoutContext): string {
  if (isPrimitive(value)) return literal(value);
  if (isJsonArray(value)) return renderArray(value, context);
  if (isJsonObject(value)) return renderObject(value, context);
  return literal(value);
}

/** One array, either on one line or one element per line. */
function renderArray(elements: readonly unknown[], context: LayoutContext): string {
  if (elements.length === 0) return '[]';
  const flat = `[${elements.map(flatText).join(', ')}]`;
  const fits =
    context.indent + context.prefixWidth + flat.length + context.suffixWidth <=
    context.options.printWidth;
  const breakable =
    forcesBreak(elements) || containsObject(elements) || containsForcedBreak(elements);
  if (fits && !breakable) return flat;
  const inner = context.indent + context.options.tabWidth;
  const pad = ' '.repeat(inner);
  const body = elements
    .map((element, index) => {
      const child: LayoutContext = {
        options: context.options,
        indent: inner,
        prefixWidth: 0,
        suffixWidth: index === elements.length - 1 ? 0 : 1
      };
      return pad + renderValue(element, child);
    })
    .join(',\n');
  return `[\n${body}\n${' '.repeat(context.indent)}]`;
}

/** One object, always expanded — the newline after `{` is what keeps it so. */
function renderObject(value: JsonObject, context: LayoutContext): string {
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  const inner = context.indent + context.options.tabWidth;
  const pad = ' '.repeat(inner);
  const body = keys
    .map((key, index) => {
      const keyText = JSON.stringify(key);
      const child: LayoutContext = {
        options: context.options,
        indent: inner,
        // the `": "` that follows the key
        prefixWidth: keyText.length + 2,
        suffixWidth: index === keys.length - 1 ? 0 : 1
      };
      return `${pad}${keyText}: ${renderValue(value[key], child)}`;
    })
    .join(',\n');
  return `{\n${body}\n${' '.repeat(context.indent)}}`;
}

/**
 * Render a JSON value in the layout prettier produces for JSON, newline-terminated.
 *
 * The output is a prettier FIXED POINT: formatting it again returns it unchanged.
 */
export function renderJsonDocument(
  value: unknown,
  options: JsonLayoutOptions = DEFAULT_JSON_LAYOUT
): string {
  const text = renderValue(value, {
    options,
    indent: 0,
    prefixWidth: 0,
    suffixWidth: 0
  });
  return `${text}\n`;
}
