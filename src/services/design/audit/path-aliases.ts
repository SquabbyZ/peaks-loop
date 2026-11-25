/**
 * Path-alias resolution for the S7 audit's import closure (Task 6c).
 *
 * The pilot's calibration measured 3,465 `@/…` imports the closure never
 * followed — the single largest blind spot in the run, and the root cause of
 * most `states` and `hierarchy` false positives: the empty state and the page
 * title live in `src/components/**`, reached only through the alias.
 *
 * The aliases are read from the project's own TypeScript config — the same
 * `compilerOptions.paths` the bundler honours. `tsconfig.json` is tried first;
 * a solution-style file with no `paths` falls through to `tsconfig.app.json`,
 * `tsconfig.base.json` and `jsconfig.json`. Targets resolve against `baseUrl`
 * when one is declared, otherwise against the config file's own directory —
 * the TypeScript rule, not a guess.
 *
 * A specifier that matches no alias is still a package import (named in the
 * gap list, never silently treated as "nothing imported"). A specifier that
 * matches an alias whose target does not exist on disk is an ALIAS GAP the
 * report counts, because that is a broken contract, not a package.
 */

import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { normalizePath } from '../../../shared/path-utils.js';
import { MAX_SOURCE_BYTES, readCappedText } from '../file-cap.js';

/** One declared alias: `@/*` → the app-relative directory its `*` resolves into. */
export type PathAlias = {
  /** The pattern as declared (`@/*`). */
  pattern: string;
  /** Targets as declared (`./src/*`). */
  targets: string[];
  /** App-relative resolution base: the config dir, or its `baseUrl`. */
  baseDir: string;
};

/** The config files tried, in order; the first one declaring `paths` wins. */
const CONFIG_FILES = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json', 'jsconfig.json'];

/**
 * The index after a quoted JSON string starting at `index` (escapes respected),
 * or the text length when it never closes. JSON strings are double-quoted only.
 */
function quotedEnd(text: string, index: number): number {
  for (let cursor = index + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === '\\') {
      cursor += 1;
      continue;
    }
    if (text[cursor] === '"') return cursor + 1;
  }
  return text.length;
}

/** The index after a `//` or block comment at `index`, or null when none starts. */
function commentEnd(text: string, index: number): number | null {
  if (text[index] !== '/') return null;
  if (text[index + 1] === '/') {
    const newline = text.indexOf('\n', index + 2);
    return newline === -1 ? text.length : newline;
  }
  if (text[index + 1] === '*') {
    const close = text.indexOf('*/', index + 2);
    return close === -1 ? text.length : close + 2;
  }
  return null;
}

/** True when the comma at `index` is a trailing comma before `}` or `]`. */
function trailingComma(text: string, index: number): boolean {
  if (text[index] !== ',') return false;
  let ahead = index + 1;
  while (ahead < text.length && /\s/.test(text[ahead] ?? '')) ahead += 1;
  return text[ahead] === '}' || text[ahead] === ']';
}

/**
 * Strip comments and trailing commas. A tsconfig is JSONC by specification;
 * `JSON.parse` on the raw text reads `{}` and the alias table then looks
 * undeclared, which is the silent failure this reader removes. String-aware, so
 * a `//` inside a path string survives.
 */
function stripJsonc(text: string): string {
  let output = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] === '"') {
      const end = quotedEnd(text, index);
      output += text.slice(index, end);
      index = end;
      continue;
    }
    const comment = commentEnd(text, index);
    if (comment !== null) {
      index = comment;
      continue;
    }
    if (!trailingComma(text, index)) output += text[index];
    index += 1;
  }
  return output;
}

/**
 * A JSONC document as an object; a malformed file reads as "nothing declared".
 * An over-cap file reports its measured size so the caller can name it in the
 * report instead of treating a generated blob as a config that declares nothing.
 */
type JsoncRead = { value: Record<string, unknown>; oversize: number | null };

function readJsonc(filePath: string): JsoncRead {
  const read = readCappedText(filePath);
  if (read.kind !== 'read') {
    return { value: {}, oversize: read.kind === 'oversize' ? read.bytes : null };
  }
  try {
    const parsed: unknown = JSON.parse(stripJsonc(read.text));
    return {
      value:
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {},
      oversize: null
    };
  } catch {
    return { value: {}, oversize: null };
  }
}

/** The `compilerOptions` object of a parsed tsconfig, or an empty one. */
function compilerOptions(parsed: Record<string, unknown>): Record<string, unknown> {
  const options = parsed.compilerOptions;
  return options !== null && typeof options === 'object' && !Array.isArray(options)
    ? (options as Record<string, unknown>)
    : {};
}

type DeclaredAlias = { pattern: string; targets: string[] };

/** The alias table a config declares, or an empty list when it declares none. */
function declaredAliases(parsed: Record<string, unknown>): DeclaredAlias[] {
  const paths = compilerOptions(parsed).paths;
  if (paths === null || typeof paths !== 'object' || Array.isArray(paths)) return [];
  const aliases: DeclaredAlias[] = [];
  for (const [pattern, value] of Object.entries(paths as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const targets = value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.trim() !== ''
    );
    if (targets.length > 0) aliases.push({ pattern, targets });
  }
  return aliases;
}

/** The app-relative directory a target resolves against (baseUrl or config dir). */
function resolutionBase(
  appRoot: string,
  configFile: string,
  parsed: Record<string, unknown>
): string {
  const baseUrl = compilerOptions(parsed).baseUrl;
  const dir = dirname(resolve(appRoot, configFile));
  const absolute = typeof baseUrl === 'string' && baseUrl !== '' ? resolve(dir, baseUrl) : dir;
  const rel = relative(resolve(appRoot), absolute);
  return rel === '' ? '' : normalizePath(rel);
}

/**
 * Every alias the project declares, in config order. Reading stops at the
 * first config that declares any: the app config names the app's imports, and
 * merging a node-only config's aliases would invent paths no page imports.
 *
 * An over-cap config is NAMED AND SKIPPED, not refused — deliberately exit 0.
 * Path aliases are an OPTIONAL import hint (`@/*` → `src/*`), not part of the
 * design contract: the two files `DESIGN_AUDIT_CONTRACT_TOO_LARGE` refuses are
 * `design/tokens.json` and `design/paved-road.json`, and a tsconfig past the cap
 * is neither. The audit still scores every file it reads directly, so the
 * measured size is pushed onto `gaps` (the caller's report sink) and the alias
 * table stays empty. The report then names the unread config in its runtime
 * state and declares the divergence in its fixed known gaps, so it is never
 * silent. Falling through to the next config would substitute a different
 * contract for the one the project actually ships, so the skip stops the search.
 */
export function readPathAliases(appRoot: string, gaps: string[] = []): PathAlias[] {
  for (const configFile of CONFIG_FILES) {
    if (!existsSync(join(appRoot, configFile))) continue;
    const { value: parsed, oversize } = readJsonc(join(appRoot, configFile));
    if (oversize !== null) {
      gaps.push(`${configFile} (larger than ${MAX_SOURCE_BYTES} bytes; path aliases not read)`);
      return [];
    }
    const declared = declaredAliases(parsed);
    if (declared.length === 0) continue;
    const baseDir = resolutionBase(appRoot, configFile, parsed);
    return declared.map((alias) => ({ ...alias, baseDir }));
  }
  return [];
}

/**
 * The app-relative base path a specifier names, with no extension resolved:
 * `@/components/RowList` under an `@/*` alias targeting the source dir becomes
 * that directory joined with the specifier's tail.
 * Null means "no alias matched" — the caller then treats it as a package.
 */
export function aliasBase(specifier: string, aliases: readonly PathAlias[]): string | null {
  for (const alias of aliases) {
    const star = alias.pattern.indexOf('*');
    if (star === -1) {
      if (specifier !== alias.pattern) continue;
      const target = alias.targets[0];
      return target === undefined ? null : normalizePath(join(alias.baseDir, target));
    }
    const prefix = alias.pattern.slice(0, star);
    const suffix = alias.pattern.slice(star + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    if (specifier.length < prefix.length + suffix.length) continue;
    const rest = specifier.slice(prefix.length, specifier.length - suffix.length);
    const target = alias.targets[0];
    if (target === undefined) continue;
    return normalizePath(join(alias.baseDir, target.replace('*', rest)));
  }
  return null;
}
