/**
 * The inputs of a G1 source scan: the change set, translated to app-relative
 * paths, and the contract files that say what to judge it against.
 *
 * `git diff` reports repository-relative paths while the paved road's
 * `pageRoots` and the scanner are app-relative, so the translation happens
 * once here; a path that does not land under the app root is not this app's UI.
 */

import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { normalizePath } from '../../../shared/path-utils.js';
import { MAX_SOURCE_BYTES, readCappedText } from '../file-cap.js';
import { DEFAULT_DESIGN_RULES, type DesignRuleCode } from '../design-rules.js';
import {
  buildPavedRoad,
  DEFAULT_TOKEN_SCALE,
  markerMap,
  stringList,
  type DesignTokenScale,
  type PavedRoadFile,
  type PavedRoadWarning
} from '../paved-road.js';
import type { DesignTokensFile } from '../token-contract.js';

/**
 * A contract JSON file, read through the byte cap. `oversize` carries the
 * measured size so the caller refuses the contract BY NAME: an over-cap file is
 * not a contract this reader can trust, and substituting an empty one silently
 * would audit the project against a ladder it never declared.
 */
type JsonRead = { value: Record<string, unknown>; oversize: number | null };

function readJson(filePath: string): JsonRead {
  const read = readCappedText(filePath);
  if (read.kind !== 'read') {
    return { value: {}, oversize: read.kind === 'oversize' ? read.bytes : null };
  }
  try {
    const parsed: unknown = JSON.parse(read.text);
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

function oversizeWarning(bytes: number): PavedRoadWarning {
  return {
    code: 'contract-too-large',
    message:
      `design/paved-road.json is ${bytes} bytes, larger than the ${MAX_SOURCE_BYTES}-byte cap; ` +
      'the contract was refused and the built-in defaults were used'
  };
}

function readRules(value: unknown): PavedRoadFile['rules'] {
  const rules: PavedRoadFile['rules'] = { ...DEFAULT_DESIGN_RULES };
  const record =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  for (const code of Object.keys(rules) as DesignRuleCode[]) {
    const severity = record[code];
    if (severity === 'warn' || severity === 'fail') rules[code] = severity;
  }
  return rules;
}

const TOKEN_SCALE_GROUPS = ['space', 'font', 'radius', 'color'] as const;

/** A declared group: a non-empty list of non-blank strings, or it is malformed. */
function isStringScale(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string' && entry.trim() !== '')
  );
}

function cloneScale(scale: DesignTokenScale): DesignTokenScale {
  return {
    space: [...scale.space],
    font: [...scale.font],
    radius: [...scale.radius],
    color: [...scale.color],
    ...(scale.weight === undefined ? {} : { weight: [...scale.weight] })
  };
}

function malformedScale(reason: string): PavedRoadWarning {
  return {
    code: 'token-scale-malformed',
    message: `design/paved-road.json tokenScale ${reason}; the built-in default scale was used`
  };
}

/**
 * The declared token scale, or the built-in default.
 *
 * Absent is the only case that takes the default silently: an older contract
 * that declares no scale is a legitimate older contract. A present-but-malformed
 * value also takes the default, but carries a named warning — a silent
 * substitution would audit the project against a ladder it never declared,
 * which is the exact defect this reader exists to remove.
 */
export function readTokenScale(value: unknown): {
  scale: DesignTokenScale;
  warning: PavedRoadWarning | null;
} {
  if (value === undefined || value === null) {
    return { scale: cloneScale(DEFAULT_TOKEN_SCALE), warning: null };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { scale: cloneScale(DEFAULT_TOKEN_SCALE), warning: malformedScale('is not an object') };
  }
  const record = value as Record<string, unknown>;
  const invalid = TOKEN_SCALE_GROUPS.filter((group) => !isStringScale(record[group]));
  if (invalid.length > 0) {
    return {
      scale: cloneScale(DEFAULT_TOKEN_SCALE),
      warning: malformedScale(`has an invalid group: ${invalid.join(', ')}`)
    };
  }
  const weight = record.weight;
  if (weight !== undefined && !isStringScale(weight)) {
    return {
      scale: cloneScale(DEFAULT_TOKEN_SCALE),
      warning: malformedScale('has an invalid group: weight')
    };
  }
  return {
    scale: {
      space: [...(record.space as string[])],
      font: [...(record.font as string[])],
      radius: [...(record.radius as string[])],
      color: [...(record.color as string[])],
      ...(weight === undefined ? {} : { weight: [...weight] })
    },
    warning: null
  };
}

/** `paved-road.json` is optional by content: every missing key keeps its default. */
export function readPavedRoad(designRoot: string): PavedRoadFile {
  const { value: raw, oversize } = readJson(join(designRoot, 'paved-road.json'));
  const paved = buildPavedRoad({
    pageRoots: stringList(raw.pageRoots),
    componentEntrypoints: stringList(raw.componentEntrypoints),
    exclude: stringList(raw.exclude),
    bannedImportSpecifiers: stringList(raw.bannedImportSpecifiers),
    routeMarkers: markerMap(raw.routeMarkers)
  });
  paved.rules = readRules(raw.rules);
  const tokenScale = readTokenScale(raw.tokenScale);
  paved.tokenScale = tokenScale.scale;
  const warnings: PavedRoadWarning[] = [];
  if (oversize !== null) warnings.push(oversizeWarning(oversize));
  if (tokenScale.warning !== null) warnings.push(tokenScale.warning);
  if (warnings.length > 0) paved.warnings = warnings;
  return paved;
}

const TOKEN_GROUPS = ['color', 'space', 'font', 'radius'] as const;

function isTokenGroup(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(
    (token) =>
      token !== null &&
      typeof token === 'object' &&
      typeof (token as { $value?: unknown }).$value === 'string'
  );
}

/** A missing group or a malformed token means the coverage cannot be measured. */
export function readTokens(designRoot: string): DesignTokensFile | null {
  const { value: raw } = readJson(join(designRoot, 'tokens.json'));
  if (!TOKEN_GROUPS.every((group) => isTokenGroup(raw[group]))) return null;
  return raw as unknown as DesignTokensFile;
}

/** The repository-relative path a change-set entry names, or null when it escapes the root. */
function toRepoRelative(projectRoot: string, file: string): string | null {
  const absolute = isAbsolute(file) ? file : resolve(projectRoot, file);
  const rel = relative(resolve(projectRoot), absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

/**
 * Both spellings reach here: `git diff` reports repository-relative paths, and
 * a hand-supplied `--files` is often written app-relative. A path under the app
 * root is the repository-relative reading and wins; otherwise a relative path
 * that exists under the app root is the app-relative reading. Anything else is
 * not this app's UI.
 */
function toAppRelative(projectRoot: string, appRelPath: string, file: string): string | null {
  const repoPath = toRepoRelative(projectRoot, file);
  if (repoPath === null) return null;
  if (appRelPath === '') return repoPath;
  if (repoPath.startsWith(`${appRelPath}/`)) return repoPath.slice(appRelPath.length + 1);
  if (isAbsolute(file)) return null;
  return existsSync(resolve(projectRoot, appRelPath, file)) ? repoPath : null;
}

/**
 * One comparison form for an exclude entry or a file path: the platform's
 * separators folded to `/` by the locked `normalizePath` rule, any leading
 * `./` (or `.\`) run removed, and no trailing slash. A Windows-style entry
 * (`src\gen`) and a `./src/gen` entry must match the same subtree.
 */
function normalizeEntry(value: string): string {
  return normalizePath(value.trim())
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
}

/** True when `file` is `dir` or sits under it, both already normalized. */
function underDir(file: string, dir: string): boolean {
  return file === dir || file.startsWith(`${dir}/`);
}

/**
 * True when an app-relative path is an exclude entry, or sits under one. An
 * entry may be written repo-relative (`web/src/gen`) for an app under `web/`,
 * so the repo-relative spelling of the file is compared as well.
 */
export function isExcluded(appFile: string, exclude: readonly string[], appRelPath = ''): boolean {
  const file = normalizeEntry(appFile);
  const repoFile = appRelPath === '' ? file : `${normalizeEntry(appRelPath)}/${file}`;
  return exclude.some((entry) => {
    const dir = normalizeEntry(entry);
    return dir !== '' && (underDir(file, dir) || underDir(repoFile, dir));
  });
}

/**
 * The change set as app-relative paths. A change outside the app root is
 * dropped, and so is one under a `paved-road.json` exclude entry (the
 * `--exclude` help promises the source scan skips it).
 */
export function appFiles(
  projectRoot: string,
  appRelPath: string,
  changed: readonly string[],
  exclude: readonly string[] = []
): string[] {
  const files: string[] = [];
  for (const file of changed) {
    const appFile = toAppRelative(projectRoot, appRelPath, file);
    if (appFile !== null && appFile !== '' && !isExcluded(appFile, exclude, appRelPath)) {
      files.push(appFile);
    }
  }
  return files;
}
